//! The HTML a share link answers with.
//!
//! A share URL has two audiences and has to satisfy both in one response.
//!
//! A **crawler** — Slack's unfurler, iMessage, WhatsApp, a Discord bot — issues
//! one GET, reads the `<head>`, and never runs a line of JavaScript. Whatever
//! this file writes into the markup is the whole preview. It does not follow the
//! redirect either, which is the point: a 302 to the app would hand it the app's
//! one generic card and lose the trip.
//!
//! A **person** clicked the link and wants the app. They get a `<meta
//! http-equiv="refresh">` and a `location.replace`, so the trip opens without a
//! second tap, plus a real anchor for the case where both are blocked.
//!
//! `location.replace` rather than assigning `location.href`: the share URL must
//! not sit in the history stack, or Back from the trip lands here and bounces
//! forward again.

use std::fmt::Write as _;

use crate::card_svg::card_alt_text;
use crate::dates::{day_count, format_date_span};
use crate::i18n::Language;
use crate::trip_preview::TripPreview;

// ============================================================================
// Types
// ============================================================================

/// Everything a page needs that is not the trip itself.
#[derive(Debug, Clone)]
pub struct PageContext {
    /// Where this service answers, e.g. `https://share.kikouchou.app`.
    pub share_origin: String,
    /// Where a person is sent, e.g. `https://app.kikouchou.app`.
    pub app_origin: String,
    pub language: Language,
    pub token: String,
}

// ============================================================================
// Internal helpers
// ============================================================================

/// Escapes text for a markup context, attribute values included.
fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(character),
        }
    }
    out
}

/// Percent-encodes a token for a path segment.
///
/// A token is nanoid's URL-safe alphabet, so in practice nothing is encoded.
/// The escape hatch is here for the day something else reaches this function:
/// a path is being built, and a path built by concatenation is a path somebody
/// eventually escapes out of.
fn encode_segment(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

fn meta(out: &mut String, kind: &str, key: &str, value: &str) {
    let _ = writeln!(
        out,
        r#"    <meta {kind}="{key}" content="{}" />"#,
        escape(value)
    );
}

/// The document shell.
///
/// `robots: noindex` keeps a share link out of a search index. It costs no
/// preview: unfurlers gate on `robots.txt`, which this service serves
/// permissively, and none of them read this tag. A `Disallow: /` in that file
/// is the version that would break Slack.
fn document(
    language: Language,
    title: &str,
    head: &str,
    body: &str,
    redirect_to: Option<&str>,
) -> String {
    let refresh = redirect_to.map_or(String::new(), |target| {
        format!(
            "    <meta http-equiv=\"refresh\" content=\"0; url={}\" />\n",
            escape(target)
        )
    });
    // The target is JSON-encoded rather than pasted in: a quote inside a script
    // element is a different escaping problem from a quote inside an attribute,
    // and only one of the two is solved by `escape`.
    let script = redirect_to.map_or(String::new(), |target| {
        format!(
            "    <script>window.location.replace({});</script>\n",
            serde_json::to_string(target).unwrap_or_else(|_| "\"/\"".to_owned())
        )
    });

    format!(
        r#"<!doctype html>
<html lang="{language}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title}</title>
    <meta name="robots" content="noindex, nofollow" />
{refresh}{head}{script}  </head>
  <body style="margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;background:#f8fafc">
    <main style="max-width:34rem;margin:15vh auto;padding:0 1.5rem;text-align:center">
{body}
    </main>
  </body>
</html>
"#,
        title = escape(title),
    )
}

// ============================================================================
// Public API
// ============================================================================

impl PageContext {
    /// Where a browser is sent once the preview has been written.
    ///
    /// The language rides along as `?lng=`, so a French link opens the app in
    /// French for somebody who has never set a preference. A returning user's
    /// stored choice still wins: see the detection order in `src/lib/i18n`.
    pub fn join_url(&self) -> String {
        format!(
            "{}/join/{}?lng={}",
            self.app_origin,
            encode_segment(&self.token),
            self.language
        )
    }

    /// The canonical share URL, language and all.
    pub fn share_url(&self) -> String {
        format!(
            "{}/{}/{}",
            self.share_origin,
            self.language,
            encode_segment(&self.token)
        )
    }

    /// Where the card for this link lives.
    pub fn card_url(&self) -> String {
        format!("{}/card.png", self.share_url())
    }
}

/// The page for a live invite: this trip's own preview, then the app.
pub fn render_preview_page(preview: &TripPreview, context: &PageContext) -> String {
    let language = context.language;
    let span = format_date_span(&preview.start_date, &preview.end_date, language);
    let nights = day_count(&preview.start_date, &preview.end_date).saturating_sub(1);

    let title = if span.is_empty() {
        preview.name.clone()
    } else {
        format!("{} — {span}", preview.name)
    };
    let description = format!(
        "{} · {} · {}. {}",
        language.nights(nights),
        language.guests(preview.guests.len()),
        language.rooms(preview.room_count),
        language.description()
    );
    let image = context.card_url();
    let canonical = context.share_url();

    let mut head = String::new();
    meta(&mut head, "property", "og:type", "website");
    meta(&mut head, "property", "og:site_name", "Kikouchou");
    meta(&mut head, "property", "og:title", &title);
    meta(&mut head, "property", "og:description", &description);
    meta(&mut head, "property", "og:url", &canonical);
    meta(&mut head, "property", "og:image", &image);
    meta(&mut head, "property", "og:image:type", "image/png");
    meta(&mut head, "property", "og:image:width", "1200");
    meta(&mut head, "property", "og:image:height", "630");
    meta(
        &mut head,
        "property",
        "og:image:alt",
        &card_alt_text(preview, language),
    );
    meta(&mut head, "property", "og:locale", language.og_locale());
    meta(&mut head, "name", "description", &description);
    // Twitter reads its own names and falls back to `og:` for the rest.
    // `summary_large_image` is what renders the 1200x630 card rather than a
    // cropped thumbnail.
    meta(&mut head, "name", "twitter:card", "summary_large_image");
    meta(&mut head, "name", "twitter:title", &title);
    meta(&mut head, "name", "twitter:description", &description);
    meta(&mut head, "name", "twitter:image", &image);
    let _ = writeln!(
        head,
        r#"    <link rel="canonical" href="{}" />"#,
        escape(&canonical)
    );

    let target = context.join_url();
    let body = format!(
        r#"      <h1 style="font-size:1.4rem;margin:0 0 .5rem">{name}</h1>
      <p style="margin:0 0 1.5rem;color:#55637a">{span}</p>
      <p style="margin:0 0 1.5rem;color:#55637a">{opening}</p>
      <p><a href="{target}" style="color:#0f766e;font-weight:600">{open}</a></p>"#,
        name = escape(&preview.name),
        span = escape(&span),
        opening = escape(language.opening()),
        target = escape(&target),
        open = escape(language.open_trip()),
    );

    document(language, &title, &head, &body, Some(&target))
}

/// The page for a token that is unknown, revoked, expired or used up.
///
/// It carries the app's generic card, never the trip's: a withdrawn link must
/// stop telling a group chat what the trip is called, and that is most of the
/// reason an invite can be revoked at all. There is no redirect either — sending
/// somebody to `/join/<dead token>` only moves the same dead end into the app.
pub fn render_unavailable_page(context: &PageContext) -> String {
    let language = context.language;
    let image = format!("{}{}", context.app_origin, language.generic_card_path());

    let mut head = String::new();
    meta(&mut head, "property", "og:type", "website");
    meta(&mut head, "property", "og:site_name", "Kikouchou");
    meta(&mut head, "property", "og:title", language.gone_title());
    meta(
        &mut head,
        "property",
        "og:description",
        language.description(),
    );
    meta(&mut head, "property", "og:url", &context.app_origin);
    meta(&mut head, "property", "og:image", &image);
    meta(&mut head, "property", "og:image:type", "image/png");
    meta(&mut head, "property", "og:image:width", "1200");
    meta(&mut head, "property", "og:image:height", "630");
    meta(&mut head, "property", "og:locale", language.og_locale());
    meta(&mut head, "name", "description", language.description());
    meta(&mut head, "name", "twitter:card", "summary_large_image");
    meta(&mut head, "name", "twitter:title", language.gone_title());
    meta(
        &mut head,
        "name",
        "twitter:description",
        language.description(),
    );
    meta(&mut head, "name", "twitter:image", &image);

    let body = format!(
        r#"      <h1 style="font-size:1.4rem;margin:0 0 .5rem">{title}</h1>
      <p style="margin:0 0 1.5rem;color:#55637a">{explanation}</p>
      <p><a href="{app}" style="color:#0f766e;font-weight:600">{go}</a></p>"#,
        title = escape(language.gone_title()),
        explanation = escape(language.gone_body()),
        app = escape(&context.app_origin),
        go = escape(language.go_to_app()),
    );

    document(language, language.gone_title(), &head, &body, None)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trip_preview::PreviewGuest;

    fn context() -> PageContext {
        PageContext {
            share_origin: "https://share.kikouchou.app".to_owned(),
            app_origin: "https://app.kikouchou.app".to_owned(),
            language: Language::En,
            token: "OMIMwxRIi6TF_KP6".to_owned(),
        }
    }

    fn preview() -> TripPreview {
        TripPreview {
            name: "Summer house".to_owned(),
            start_date: "2026-08-12".to_owned(),
            end_date: "2026-08-18".to_owned(),
            room_count: 3,
            guests: vec![
                PreviewGuest {
                    id: "g1".to_owned(),
                    acronym: "A".to_owned(),
                    color: "#c62828".to_owned(),
                },
                PreviewGuest {
                    id: "g2".to_owned(),
                    acronym: "T".to_owned(),
                    color: "#1d4ed8".to_owned(),
                },
            ],
            stays: Vec::new(),
        }
    }

    #[test]
    fn builds_the_canonical_share_card_and_join_urls() {
        let context = context();

        assert_eq!(
            context.share_url(),
            "https://share.kikouchou.app/en/OMIMwxRIi6TF_KP6"
        );
        assert_eq!(
            context.card_url(),
            "https://share.kikouchou.app/en/OMIMwxRIi6TF_KP6/card.png"
        );
        assert_eq!(
            context.join_url(),
            "https://app.kikouchou.app/join/OMIMwxRIi6TF_KP6?lng=en"
        );
    }

    #[test]
    fn carries_the_language_into_the_app() {
        let french = PageContext {
            language: Language::Fr,
            ..context()
        };

        assert_eq!(
            french.join_url(),
            "https://app.kikouchou.app/join/OMIMwxRIi6TF_KP6?lng=fr"
        );
    }

    #[test]
    fn puts_this_trip_in_the_open_graph_tags() {
        let html = render_preview_page(&preview(), &context());

        assert!(
            html.contains(r#"<meta property="og:title" content="Summer house — 12–18 August" />"#)
        );
        assert!(html.contains("6 nights · 2 guests · 3 rooms"));
        assert!(html.contains(
            r#"<meta property="og:image" content="https://share.kikouchou.app/en/OMIMwxRIi6TF_KP6/card.png" />"#
        ));
        assert!(html.contains(r#"<meta name="twitter:card" content="summary_large_image" />"#));
    }

    #[test]
    fn declares_the_size_a_card_consumer_needs_before_fetching() {
        let html = render_preview_page(&preview(), &context());

        assert!(html.contains(r#"<meta property="og:image:width" content="1200" />"#));
        assert!(html.contains(r#"<meta property="og:image:height" content="630" />"#));
    }

    #[test]
    fn sends_a_browser_on_to_the_app_without_a_history_entry() {
        let html = render_preview_page(&preview(), &context());

        assert!(html.contains(
            r#"content="0; url=https://app.kikouchou.app/join/OMIMwxRIi6TF_KP6?lng=en""#
        ));
        assert!(html.contains("window.location.replace("));
        assert!(!html.contains("location.href"));
    }

    #[test]
    fn keeps_a_search_engine_out_without_touching_the_unfurl() {
        assert!(render_preview_page(&preview(), &context())
            .contains(r#"<meta name="robots" content="noindex, nofollow" />"#));
    }

    #[test]
    fn renders_french_when_asked_tags_and_all() {
        let french = render_preview_page(
            &preview(),
            &PageContext {
                language: Language::Fr,
                ..context()
            },
        );

        assert!(french.contains(r#"<html lang="fr">"#));
        assert!(french.contains(r#"<meta property="og:locale" content="fr_FR" />"#));
        assert!(french.contains("invités"));
        assert!(french.contains("?lng=fr"));
    }

    #[test]
    fn escapes_a_trip_name_that_is_trying_to_close_the_attribute() {
        let nasty = TripPreview {
            name: r#"" /><script>alert(1)</script>"#.to_owned(),
            ..preview()
        };

        let html = render_preview_page(&nasty, &context());

        assert!(!html.contains("<script>alert(1)</script>"));
        assert!(html.contains("&quot;"));
    }

    #[test]
    fn a_dead_link_shows_the_generic_card_and_never_the_trip() {
        let html = render_unavailable_page(&PageContext {
            token: String::new(),
            ..context()
        });

        assert!(html.contains("https://app.kikouchou.app/og-card.png"));
        assert!(!html.contains("Summer house"));
    }

    #[test]
    fn a_dead_link_keeps_the_language_it_was_asked_in() {
        // The trip is gone; the reader's language is not. An English card under
        // French prose was the one place the locale stopped being honoured.
        let french = render_unavailable_page(&PageContext {
            language: Language::Fr,
            ..context()
        });

        assert!(french.contains("https://app.kikouchou.app/og-card.fr.png"));
        assert!(french.contains(r#"<html lang="fr">"#));
        assert!(french.contains(r#"<meta property="og:locale" content="fr_FR" />"#));
        assert!(french.contains("Ce lien n&#39;est plus valable"));
    }

    #[test]
    fn a_dead_link_does_not_bounce_anybody_into_the_app() {
        let html = render_unavailable_page(&context());

        assert!(!html.contains("http-equiv=\"refresh\""));
        assert!(!html.contains("/join/"));
    }
}
