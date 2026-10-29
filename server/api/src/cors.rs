//! Which pages may call this service from a browser.
//!
//! The token is the authorisation, and CORS is not a security boundary: a
//! script outside a browser ignores it. It still matters, because without it
//! the app's own fetch is refused, and because echoing any `Origin` back would
//! let every site on the web spend a signed-in visitor's allowance.

use axum::http::{HeaderMap, HeaderValue};

// ============================================================================
// Constants
// ============================================================================

const ALLOW_METHODS: &str = "POST, OPTIONS";
const ALLOW_HEADERS: &str = "authorization, content-type";
const MAX_AGE_SECONDS: &str = "600";

// ============================================================================
// Headers
// ============================================================================

/// The `Origin` to echo back, when it is one of `allowed`.
pub fn allowed_origin<'a>(origin: Option<&'a str>, allowed: &[String]) -> Option<&'a str> {
    let origin = origin?;
    allowed
        .iter()
        .any(|candidate| candidate == origin)
        .then_some(origin)
}

/// Adds the CORS headers for an allowed origin. `Vary: Origin` goes on every
/// answer, so a cache never serves one origin's headers to another.
pub fn apply(headers: &mut HeaderMap, origin: Option<&str>, allowed: &[String], preflight: bool) {
    headers.insert("vary", HeaderValue::from_static("Origin"));
    let Some(origin) = allowed_origin(origin, allowed) else {
        return;
    };
    let Ok(value) = HeaderValue::from_str(origin) else {
        return;
    };
    headers.insert("access-control-allow-origin", value);
    if preflight {
        headers.insert(
            "access-control-allow-methods",
            HeaderValue::from_static(ALLOW_METHODS),
        );
        headers.insert(
            "access-control-allow-headers",
            HeaderValue::from_static(ALLOW_HEADERS),
        );
        headers.insert(
            "access-control-max-age",
            HeaderValue::from_static(MAX_AGE_SECONDS),
        );
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed() -> Vec<String> {
        vec![
            "https://app.kikouchou.app".to_owned(),
            "capacitor://localhost".to_owned(),
        ]
    }

    #[test]
    fn echoes_an_allowed_origin() {
        let mut headers = HeaderMap::new();
        apply(
            &mut headers,
            Some("capacitor://localhost"),
            &allowed(),
            true,
        );
        assert_eq!(
            headers["access-control-allow-origin"],
            "capacitor://localhost"
        );
        assert_eq!(headers["access-control-allow-headers"], ALLOW_HEADERS);
        assert_eq!(headers["vary"], "Origin");
    }

    #[test]
    fn says_nothing_to_another_site() {
        let mut headers = HeaderMap::new();
        apply(&mut headers, Some("https://evil.example"), &allowed(), true);
        assert!(headers.get("access-control-allow-origin").is_none());
        assert!(headers.get("access-control-allow-methods").is_none());
        assert_eq!(headers["vary"], "Origin");
    }

    #[test]
    fn matches_the_whole_origin() {
        assert_eq!(
            allowed_origin(Some("https://app.kikouchou.app.evil.example"), &allowed()),
            None
        );
        assert_eq!(allowed_origin(None, &allowed()), None);
    }
}
