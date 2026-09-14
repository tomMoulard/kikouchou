//! The two things this service says to PostHog.
//!
//! PostHog owns the reminder campaign. The sender reports every reminder that
//! comes due as a `reminder_due` event and every push it delivered as
//! `reminder_sent`, on the same person the app's own events land on when the
//! subscribing browser passed its distinct id along. A workflow with an event
//! trigger on `reminder_due` can then decide — delay, condition, cohort — and
//! call `POST /push/send` back (see `push_sender`). Every kind is on: a
//! reminder is dropped by the workflow or by the log, never by a flag here.
//!
//! Both calls use the project's public key, the same one the browser bundle
//! carries. Nothing here needs a personal API key, and a failure to reach
//! PostHog is a missed event, never a missed reminder or a crashed tick.

use reqwest::Client;
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
}
