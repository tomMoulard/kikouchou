//! The two files that let a tap on a share link open the store app.
//!
//! - `/.well-known/apple-app-site-association` tells iOS that the Kikouchou
//!   app may open links on this host (universal links).
//! - `/.well-known/assetlinks.json` tells Android the same (verified app links).
//!
//! Both are read by the operating system when the app is installed, and again
//! from time to time, never by a person. Without them a tap opens the browser,
//! which shows the preview page and redirects to the website: slower, and the
//! installed app never learns about the invite.
//!
//! Every path of this host is claimed except the few that are not links a
//! person taps: the health check, `robots.txt` and the card images. The app
//! maps what it receives onto its own routes (`src/lib/native/deep-links.ts`),
//! the same mapping [`crate::page`] does with a redirect.
//!
//! The website serves its own pair from `public/.well-known/`, generated at
//! build time from the same variables (`vite.config.ts`).

use serde_json::{json, Value};

use crate::config::NativeAppsConfig;

/// Paths iOS must not hand to the app, in the order iOS evaluates them.
const EXCLUDED_PATHS: [&str; 4] = ["/healthz", "/robots.txt", "*/card.png", "/.well-known/*"];

/// The `apple-app-site-association` document, or `None` without a team id.
pub fn apple_app_site_association(config: &NativeAppsConfig) -> Option<Value> {
    let team_id = config.apple_team_id.as_deref()?;
    let mut components: Vec<Value> = EXCLUDED_PATHS
        .iter()
        .map(|path| json!({ "/": path, "exclude": true }))
        .collect();
    components.push(json!({ "/": "/*" }));
    Some(json!({
        "applinks": {
            "details": [{
                "appIDs": [format!("{team_id}.{}", config.ios_bundle_id)],
                "components": components,
            }]
        }
    }))
}

/// The `assetlinks.json` document, or `None` without a certificate.
pub fn asset_links(config: &NativeAppsConfig) -> Option<Value> {
    if config.android_cert_sha256.is_empty() {
        return None;
    }
    Some(json!([{
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
            "namespace": "android_app",
            "package_name": config.android_package,
            "sha256_cert_fingerprints": config.android_cert_sha256,
        }
    }]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn configured() -> NativeAppsConfig {
        NativeAppsConfig {
            apple_team_id: Some("ABCDE12345".to_owned()),
            ios_bundle_id: "app.kikouchou".to_owned(),
            android_package: "app.kikouchou".to_owned(),
            android_cert_sha256: vec!["AA:BB".to_owned(), "CC:DD".to_owned()],
            ..NativeAppsConfig::default()
        }
    }

    #[test]
    fn the_association_names_the_app_and_claims_every_link() {
        let document = apple_app_site_association(&configured()).unwrap();
        let details = &document["applinks"]["details"][0];
        assert_eq!(details["appIDs"][0], "ABCDE12345.app.kikouchou");
        let components = details["components"].as_array().unwrap();
        assert_eq!(components.last().unwrap()["/"], "/*");
        assert!(components
            .iter()
            .any(|component| component["/"] == "*/card.png" && component["exclude"] == true));
    }

    #[test]
    fn the_asset_links_carry_every_signing_key() {
        let document = asset_links(&configured()).unwrap();
        assert_eq!(document[0]["target"]["package_name"], "app.kikouchou");
        assert_eq!(
            document[0]["target"]["sha256_cert_fingerprints"],
            json!(["AA:BB", "CC:DD"])
        );
    }

    #[test]
    fn nothing_is_answered_without_the_ids() {
        assert!(apple_app_site_association(&NativeAppsConfig::default()).is_none());
        assert!(asset_links(&NativeAppsConfig::default()).is_none());
    }
}
