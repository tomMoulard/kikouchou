//! The two things this service says to PostHog, and the one thing it asks.
//!
//! PostHog owns the reminder campaign. The sender reports every reminder that
//! comes due as a `reminder_due` event and every push it delivered as
//! `reminder_sent`, on the same person the app's own events land on when the
//! subscribing browser passed its distinct id along. A workflow with an event
//! trigger on `reminder_due` can then decide — delay, condition, cohort — and
//! call `POST /push/send` back (see `push_sender`). Before reporting anything,
//! the sender asks the feature flags whether the kind is switched on at all:
//! `reminder-trip-start`, `reminder-own-arrival`, `reminder-pickup`.
//!
//! Both calls use the project's public key, the same one the browser bundle
//! carries. Nothing here needs a personal API key, and a failure to reach
//! PostHog is a missed event, never a missed reminder or a crashed tick.

use std::collections::HashMap;

use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};

// ============================================================================
// Types
// ============================================================================

/// Holds the client and the credentials for the life of the process.
#[derive(Clone)]
pub struct PostHog {
    client: Client,
    host: String,
    key: String,
}

#[derive(Debug, Deserialize)]
struct DecideResponse {
    #[serde(default, rename = "featureFlags")]
    feature_flags: HashMap<String, Value>,
}

// ============================================================================
// Constants
// ============================================================================

const REQUEST_TIMEOUT_SECS: u64 = 5;

// ============================================================================
// Public API
// ============================================================================

impl PostHog {
    /// `None` when no key is configured: analytics is optional, reminders are not.
    pub fn new(host: Option<&str>, key: Option<&str>) -> Option<Self> {
        let key = key?.trim();
        if key.is_empty() {
            return None;
        }
        let host = host
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("https://eu.i.posthog.com")
            .trim_end_matches('/')
            .to_owned();
        Some(Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
                .build()
                .ok()?,
            host,
            key: key.to_owned(),
        })
    }

    /// Records one event on one person. Failures are logged and dropped.
    pub async fn capture(&self, event: &str, distinct_id: &str, mut properties: Value) {
        if let Value::Object(map) = &mut properties {
            // Server events would otherwise create a profile per distinct id
            // that never opened the app; the browser already made the person.
            map.insert("$process_person_profile".to_owned(), json!(false));
            map.insert("$lib".to_owned(), json!("share-preview"));
        }
        let body = json!({
            "api_key": self.key,
            "event": event,
            "distinct_id": distinct_id,
            "properties": properties,
        });
        let sent = self
            .client
            .post(format!("{}/capture/", self.host))
            .json(&body)
            .send()
            .await;
        match sent {
            Ok(response) if response.status().is_success() => {}
            Ok(response) => eprintln!("posthog capture {event} returned {}", response.status()),
            Err(error) => eprintln!("posthog capture {event} failed: {error}"),
        }
    }

    /// The feature flags for one distinct id: `Some(true|false)` for a flag
    /// PostHog knows, `None` for one it does not.
    ///
    /// A flag that does not exist is not a flag that is off. Nothing has been
    /// decided about it, so the caller treats `None` as "on": the reminders
    /// work before anybody has created a flag, and creating one is how they
    /// are switched off.
    pub async fn flags(&self, distinct_id: &str) -> HashMap<String, Option<bool>> {
        let body = json!({ "api_key": self.key, "distinct_id": distinct_id });
        let response = match self
            .client
            .post(format!("{}/decide/?v=3", self.host))
            .json(&body)
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => response,
            Ok(response) => {
                eprintln!("posthog decide returned {}", response.status());
                return HashMap::new();
            }
            Err(error) => {
                eprintln!("posthog decide failed: {error}");
                return HashMap::new();
            }
        };
        let Ok(decided) = response.json::<DecideResponse>().await else {
            return HashMap::new();
        };
        decided
            .feature_flags
            .into_iter()
            .map(|(key, value)| (key, Some(flag_is_on(&value))))
            .collect()
    }
}

/// A multivariate flag reads as on whenever it has a variant; `false` and
/// anything unrecognised read as off.
pub fn flag_is_on(value: &Value) -> bool {
    match value {
        Value::Bool(on) => *on,
        Value::String(variant) => !variant.is_empty() && variant != "false",
        _ => false,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_key_means_no_analytics_rather_than_a_broken_service() {
        assert!(PostHog::new(Some("https://events.kikouchou.app"), None).is_none());
        assert!(PostHog::new(Some("https://events.kikouchou.app"), Some("  ")).is_none());
        assert!(PostHog::new(None, Some("phc_x")).is_some());
    }

    #[test]
    fn trims_the_host_so_every_url_has_one_slash() {
        let posthog = PostHog::new(Some("https://events.kikouchou.app/"), Some("phc_x")).unwrap();
        assert_eq!(posthog.host, "https://events.kikouchou.app");
    }

    #[test]
    fn reads_boolean_and_variant_flags() {
        assert!(flag_is_on(&json!(true)));
        assert!(!flag_is_on(&json!(false)));
        assert!(flag_is_on(&json!("control")));
        assert!(!flag_is_on(&json!("")));
        assert!(!flag_is_on(&json!(null)));
        assert!(!flag_is_on(&json!(3)));
    }

    #[test]
    fn decodes_the_decide_payload_shape() {
        let decided: DecideResponse = serde_json::from_str(
            r#"{"featureFlags":{"reminder-pickup":false,"reminder-trip-start":true,"wizard":"test"},"other":1}"#,
        )
        .unwrap();
        assert_eq!(decided.feature_flags.len(), 3);
        assert!(!flag_is_on(&decided.feature_flags["reminder-pickup"]));
    }
}
