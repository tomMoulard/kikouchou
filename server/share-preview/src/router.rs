//! URL shapes this service answers, and what each one returns.
//!
//! ```text
//!   /fr/OMIMwxRIi6TF_KP6            the preview page, in French
//!   /en/OMIMwxRIi6TF_KP6            the same page, in English
//!   /fr/OMIMwxRIi6TF_KP6/card.png   the 1200x630 card that page points at
//!   /OMIMwxRIi6TF_KP6               no language: 302 to the negotiated one
//!   /healthz                        for the container's health check
//!   /robots.txt                     permissive; see `page.rs` on why
//! ```
//!
//! The language lives in the path rather than in a query parameter or a header
//! because a crawler's `Accept-Language` describes a data centre, not the group
//! chat the card lands in. Whoever shares the trip picks the language, and the
//! link carries it.
//!
//! [`route`] is a plain function over a method, a path and a header, returning a
//! status, headers and a body. Nothing here touches a socket, so every route is
//! tested without listening on a port.

use std::future::Future;

use crate::config::Config;
use crate::i18n::{negotiate_language, Language};
use crate::page::{render_preview_page, render_unavailable_page, PageContext};
use crate::trip_preview::TripPreview;
use crate::trip_source::LoadResult;

// ============================================================================
// Types
// ============================================================================

/// What the HTTP layer writes out.
#[derive(Debug, Clone, PartialEq)]
pub struct RouteResponse {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
    /// What the access log records. Never a token, never a trip name.
    pub outcome: &'static str,
}

impl RouteResponse {
    /// The body as text. For the tests, and for nothing else.
    #[cfg(test)]
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    #[cfg(test)]
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.as_str())
    }
}

/// What the router needs from the outside world.
///
/// A trait rather than two closures, so the tests can answer with a fixed trip
/// and count what was asked of them.
pub trait Backend: Sync {
    /// Resolves a token to a trip, or to the reason there is none.
    fn load_trip(&self, token: &str) -> impl Future<Output = LoadResult> + Send;

    /// Renders and rasterises the card, or `None` when rendering failed.
    fn render_card(
        &self,
        preview: &TripPreview,
        language: Language,
        token: &str,
    ) -> impl Future<Output = Option<Vec<u8>>> + Send;
}

// ============================================================================
// Constants
// ============================================================================

const CARD_SEGMENT: &str = "card.png";
const HTML: &str = "text/html; charset=utf-8";
const TEXT: &str = "text/plain; charset=utf-8";

// ============================================================================
// Internal helpers
// ============================================================================

/// Splits a path into its non-empty, percent-decoded segments.
fn segments_of(path: &str) -> Vec<String> {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .map(percent_decode)
        .collect()
}

/// Decodes `%XX` escapes, leaving anything malformed exactly as it arrived.
///
/// A broken escape is not a token, and passing it through unchanged keeps the
/// 404 path from having to care.
fn percent_decode(segment: &str) -> String {
    let bytes = segment.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(byte) = hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Sent with everything.
///
/// `nosniff` because this service returns HTML built from a trip name somebody
/// typed. Every one of those is escaped on the way out, and a browser that
/// declines to guess a content type is the second lock on the same door.
fn base_headers() -> Vec<(&'static str, String)> {
    vec![
        ("x-content-type-options", "nosniff".to_owned()),
        ("referrer-policy", "no-referrer".to_owned()),
    ]
}

fn respond(
    status: u16,
    content_type: &'static str,
    body: Vec<u8>,
    outcome: &'static str,
    cache_seconds: u64,
) -> RouteResponse {
    let mut headers = base_headers();
    headers.push(("content-type", content_type.to_owned()));
    headers.push(("content-length", body.len().to_string()));
    headers.push((
        "cache-control",
        if cache_seconds > 0 {
            format!("public, max-age={cache_seconds}")
        } else {
            "no-store".to_owned()
        },
    ));
    RouteResponse {
        status,
        headers,
        body,
        outcome,
    }
}

fn redirect(location: String, outcome: &'static str) -> RouteResponse {
    let mut headers = base_headers();
    headers.push(("location", location));
    headers.push(("cache-control", "no-store".to_owned()));
    headers.push(("content-length", "0".to_owned()));
    RouteResponse {
        status: 302,
        headers,
        body: Vec::new(),
        outcome,
    }
}

// ============================================================================
// Public API
// ============================================================================

/// Answers one request.
pub async fn route<B: Backend>(
    backend: &B,
    config: &Config,
    method: &str,
    path: &str,
    accept_language: Option<&str>,
) -> RouteResponse {
    if method != "GET" && method != "HEAD" {
        return respond(
            405,
            TEXT,
            b"Method not allowed".to_vec(),
            "method-not-allowed",
            0,
        );
    }

    let segments = segments_of(path);
    let context_for = |language: Language, token: &str| PageContext {
        share_origin: config.share_origin.clone(),
        app_origin: config.app_origin.clone(),
        language,
        token: token.to_owned(),
    };
    let unavailable = |language: Language, outcome: &'static str, status: u16| {
        respond(
            status,
            HTML,
            render_unavailable_page(&context_for(language, "")).into_bytes(),
            outcome,
            0,
        )
    };

    let Some(first) = segments.first() else {
        return redirect(config.app_origin.clone(), "root");
    };
    if segments.len() == 1 && first == "healthz" {
        return respond(200, TEXT, b"ok".to_vec(), "healthz", 0);
    }
    if segments.len() == 1 && first == "robots.txt" {
        return respond(
            200,
            TEXT,
            b"User-agent: *\nAllow: /\n".to_vec(),
            "robots",
            0,
        );
    }

    // `/<token>` and `/<token>/card.png`: the language is missing, so it is
    // negotiated once and the caller is sent to the canonical URL. One canonical
    // form per language is what stops a chat app caching the same trip twice.
    let Some(language) = Language::parse(first) else {
        let language = negotiate_language(accept_language);
        let rest = segments.join("/");
        return redirect(format!("/{language}/{rest}"), "negotiate-language");
    };

    let Some(token) = segments.get(1) else {
        return redirect(config.app_origin.clone(), "language-only");
    };

    let wants_card = segments.len() == 3 && segments[2] == CARD_SEGMENT;
    if segments.len() > 2 && !wants_card {
        return unavailable(language, "unknown-path", 404);
    }

    let result = backend.load_trip(token).await;
    let LoadResult::Ok(preview) = result else {
        // Every dead invite gets the same page and the same status. The reason
        // is logged; it is not told to the caller, because "revoked" and "never
        // existed" are different facts about somebody else's trip, and a
        // stranger with a guessed token learns neither.
        //
        // A read that *failed* is the one exception, and only in its status
        // code. 404 means gone, and a chat app caches gone: a Supabase blip, or
        // a missing grant, would otherwise leave every live link in every chat
        // showing "no longer valid" long after the service recovered. 503 says
        // "ask again later", which is what a transient failure is. The body
        // stays identical, so it still says nothing about the token.
        let status = if matches!(result, LoadResult::Error) {
            503
        } else {
            404
        };
        return unavailable(language, result.outcome(), status);
    };

    if wants_card {
        return match backend.render_card(&preview, language, token).await {
            Some(png) => {
                let mut headers = base_headers();
                headers.push(("content-type", "image/png".to_owned()));
                headers.push(("content-length", png.len().to_string()));
                headers.push((
                    "cache-control",
                    format!("public, max-age={}", config.cache_seconds),
                ));
                RouteResponse {
                    status: 200,
                    headers,
                    body: png,
                    outcome: "card",
                }
            }
            // The page still has its `og:` tags; only the picture is missing,
            // and a chat app that gets a 500 for the image shows the text card.
            None => respond(500, TEXT, b"Card unavailable".to_vec(), "card-failed", 0),
        };
    }

    respond(
        200,
        HTML,
        render_preview_page(&preview, &context_for(language, token)).into_bytes(),
        "preview",
        config.cache_seconds,
    )
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trip_preview::PreviewGuest;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const TOKEN: &str = "OMIMwxRIi6TF_KP6";

    fn config() -> Config {
        Config {
            port: 8080,
            supabase_url: "https://ref.supabase.co".to_owned(),
            service_role_key: "never-logged".to_owned(),
            share_origin: "https://share.kikouchou.app".to_owned(),
            app_origin: "https://app.kikouchou.app".to_owned(),
            cache_seconds: 300,
        }
    }

    fn preview() -> TripPreview {
        TripPreview {
            name: "Summer house".to_owned(),
            start_date: "2026-08-12".to_owned(),
            end_date: "2026-08-18".to_owned(),
            room_count: 2,
            guests: vec![PreviewGuest {
                id: "g1".to_owned(),
                acronym: "A".to_owned(),
                color: "#c62828".to_owned(),
            }],
            stays: Vec::new(),
        }
    }

    struct Stub {
        result: LoadResult,
        loads: AtomicUsize,
        renders: AtomicUsize,
    }

    impl Stub {
        fn answering(result: LoadResult) -> Self {
            Self {
                result,
                loads: AtomicUsize::new(0),
                renders: AtomicUsize::new(0),
            }
        }

        fn live() -> Self {
            Self::answering(LoadResult::Ok(Box::new(preview())))
        }
    }

    impl Backend for Stub {
        async fn load_trip(&self, _token: &str) -> LoadResult {
            self.loads.fetch_add(1, Ordering::Relaxed);
            self.result.clone()
        }

        async fn render_card(
            &self,
            _preview: &TripPreview,
            _language: Language,
            _token: &str,
        ) -> Option<Vec<u8>> {
            self.renders.fetch_add(1, Ordering::Relaxed);
            Some(b"png-bytes".to_vec())
        }
    }

    async fn get(stub: &Stub, path: &str) -> RouteResponse {
        route(stub, &config(), "GET", path, None).await
    }

    #[tokio::test]
    async fn answers_the_health_check_without_touching_the_database() {
        let stub = Stub::live();

        let reply = get(&stub, "/healthz").await;

        assert_eq!(reply.status, 200);
        assert_eq!(reply.text(), "ok");
        assert_eq!(stub.loads.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn lets_crawlers_in_through_robots_txt() {
        assert!(get(&Stub::live(), "/robots.txt")
            .await
            .text()
            .contains("Allow: /"));
    }

    #[tokio::test]
    async fn sends_the_bare_origin_to_the_app() {
        let reply = get(&Stub::live(), "/").await;

        assert_eq!(reply.status, 302);
        assert_eq!(reply.header("location"), Some("https://app.kikouchou.app"));
    }

    #[tokio::test]
    async fn refuses_a_write() {
        let reply = route(
            &Stub::live(),
            &config(),
            "POST",
            &format!("/en/{TOKEN}"),
            None,
        )
        .await;

        assert_eq!(reply.status, 405);
    }

    #[tokio::test]
    async fn renders_the_preview_page_for_the_language_in_the_path() {
        let stub = Stub::live();

        let reply = get(&stub, &format!("/fr/{TOKEN}")).await;

        assert_eq!(reply.status, 200);
        assert_eq!(reply.header("content-type"), Some(HTML));
        assert_eq!(reply.header("cache-control"), Some("public, max-age=300"));
        assert!(reply.text().contains(r#"<html lang="fr">"#));
        assert_eq!(stub.loads.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn serves_the_card_as_a_png() {
        let stub = Stub::live();

        let reply = get(&stub, &format!("/en/{TOKEN}/card.png")).await;

        assert_eq!(reply.status, 200);
        assert_eq!(reply.header("content-type"), Some("image/png"));
        assert_eq!(reply.header("content-length"), Some("9"));
        assert_eq!(stub.renders.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn sends_a_link_with_no_language_to_the_negotiated_one() {
        let stub = Stub::live();

        let reply = route(
            &stub,
            &config(),
            "GET",
            &format!("/{TOKEN}"),
            Some("en-GB,en;q=0.9"),
        )
        .await;

        assert_eq!(reply.status, 302);
        assert_eq!(
            reply.header("location"),
            Some(format!("/en/{TOKEN}").as_str())
        );
        assert_eq!(stub.loads.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn keeps_the_card_path_when_it_redirects_for_a_language() {
        let reply = get(&Stub::live(), &format!("/{TOKEN}/card.png")).await;

        assert_eq!(
            reply.header("location"),
            Some(format!("/fr/{TOKEN}/card.png").as_str())
        );
    }

    #[tokio::test]
    async fn does_not_treat_an_unknown_sub_path_as_a_card() {
        let stub = Stub::live();

        let reply = get(&stub, &format!("/en/{TOKEN}/card.jpg")).await;

        assert_eq!(reply.status, 404);
        assert_eq!(stub.renders.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn a_dead_invite_gets_the_generic_page_and_the_reason_goes_to_the_log() {
        for result in [
            LoadResult::NotFound,
            LoadResult::Revoked,
            LoadResult::Expired,
            LoadResult::Exhausted,
        ] {
            let expected = result.outcome();

            let reply = get(&Stub::answering(result), &format!("/en/{TOKEN}")).await;

            assert_eq!(reply.status, 404);
            assert_eq!(reply.outcome, expected);
            assert!(reply.text().contains("no longer valid"));
            assert_eq!(reply.header("cache-control"), Some("no-store"));
        }
    }

    #[tokio::test]
    async fn every_dead_reason_gives_the_same_body_byte_for_byte() {
        // A stranger with a guessed token must not learn whether it ever
        // existed, so the four reasons are indistinguishable from outside.
        let mut bodies = Vec::new();
        for result in [
            LoadResult::NotFound,
            LoadResult::Revoked,
            LoadResult::Expired,
            LoadResult::Exhausted,
        ] {
            bodies.push(
                get(&Stub::answering(result), &format!("/en/{TOKEN}"))
                    .await
                    .body,
            );
        }

        assert!(bodies.windows(2).all(|pair| pair[0] == pair[1]));
    }

    #[tokio::test]
    async fn a_failed_read_is_transient_rather_than_gone() {
        // 404 is cached by chat apps. A blip, or a missing grant, must not leave
        // every live link showing "no longer valid" after the service recovers.
        let reply = get(&Stub::answering(LoadResult::Error), &format!("/en/{TOKEN}")).await;

        assert_eq!(reply.status, 503);
        assert_eq!(reply.outcome, "error");
        assert_eq!(reply.header("cache-control"), Some("no-store"));
    }

    #[tokio::test]
    async fn a_failed_read_still_says_nothing_about_the_token() {
        let broken = get(&Stub::answering(LoadResult::Error), &format!("/en/{TOKEN}")).await;
        let dead = get(
            &Stub::answering(LoadResult::NotFound),
            &format!("/en/{TOKEN}"),
        )
        .await;

        assert_eq!(broken.body, dead.body);
    }

    #[test]
    fn decodes_a_path_and_survives_a_broken_escape() {
        assert_eq!(segments_of("/en/a%2Db"), ["en", "a-b"]);
        assert_eq!(segments_of("/en/a%zzb"), ["en", "a%zzb"]);
        assert_eq!(segments_of("///"), Vec::<String>::new());
    }
}
