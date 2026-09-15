//! `POST /push/send`: the one write this service accepts.
//!
//! A PostHog workflow, having decided a `reminder_due` event deserves a push,
//! calls back here with the subscription, the kind and the subject from that
//! event. The request is authorised by a shared secret in the `Authorization`
//! header, compared in constant time; the body is a small JSON object and
//! nothing in it is trusted further than its shape.
//!
//! The functions here are pure so the contract is tested without a socket.
//! `main.rs` reads the body and calls [`crate::push_sender::PushSender`].

use serde::Deserialize;

use crate::push_sender::SendOutcome;
use crate::reminders::ReminderKind;
use crate::trip_source::is_uuid_shaped;

// ============================================================================
// Types
// ============================================================================

/// What a workflow asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendRequest {
    pub subscription_id: String,
    pub kind: ReminderKind,
    pub subject: String,
}

#[derive(Debug, Deserialize)]
struct SendRequestJson {
    subscription_id: String,
    kind: String,
    subject: String,
}

// ============================================================================
// Constants
// ============================================================================

/// `reminder_log.subject` is `check (length(subject) between 1 and 64)`.
const MAX_SUBJECT_LENGTH: usize = 64;

/// The most a body may be. A send request is under 200 bytes.
pub const MAX_BODY_BYTES: usize = 16 * 1024;

// ============================================================================
// Public API
// ============================================================================

/// Whether the header carries the secret. Constant time over the secret's
/// length, so a wrong guess costs the same whatever prefix it got right.
pub fn authorized(authorization: Option<&str>, secret: &str) -> bool {
    let Some(header) = authorization else {
        return false;
    };
    let Some(presented) = header.strip_prefix("Bearer ") else {
        return false;
    };
    let presented = presented.trim().as_bytes();
    let expected = secret.as_bytes();

    // Every byte of the secret is read whatever the guess looks like, and a
    // short guess is padded with zeros rather than ending the loop early: the
    // work is a function of the secret's length alone.
    let mut difference = presented.len() ^ expected.len();
    for (index, want) in expected.iter().enumerate() {
        let got = presented.get(index).copied().unwrap_or(0);
        difference |= usize::from(got ^ want);
    }
    !secret.is_empty() && difference == 0
}

/// Reads and checks a request body.
pub fn parse_send_request(body: &[u8]) -> Result<SendRequest, &'static str> {
    let parsed: SendRequestJson = serde_json::from_slice(body)
        .map_err(|_| "body must be JSON with subscription_id, kind and subject")?;
    if !is_uuid_shaped(&parsed.subscription_id) {
        return Err("subscription_id must be a uuid");
    }
    let Some(kind) = ReminderKind::parse(&parsed.kind) else {
        return Err("kind must be trip_start, own_arrival or pickup");
    };
    if parsed.subject.is_empty() || parsed.subject.len() > MAX_SUBJECT_LENGTH {
        return Err("subject must be 1 to 64 characters");
    }
    Ok(SendRequest {
        subscription_id: parsed.subscription_id,
        kind,
        subject: parsed.subject,
    })
}

/// The HTTP status for what the sender did.
///
/// `not_due` and `already_sent` are 200s: the workflow asked, the answer is
/// "nothing to do", and a 4xx would make it retry a send that must not happen.
pub fn status_for(outcome: SendOutcome) -> u16 {
    match outcome {
        SendOutcome::Sent | SendOutcome::AlreadySent | SendOutcome::NotDue => 200,
        SendOutcome::UnknownSubscription | SendOutcome::Gone => 404,
        SendOutcome::Failed => 502,
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "s3cret-s3cret-s3cret";

    #[test]
    fn accepts_the_secret_as_a_bearer_token_and_nothing_else() {
        assert!(authorized(Some("Bearer s3cret-s3cret-s3cret"), SECRET));
        assert!(authorized(Some("Bearer s3cret-s3cret-s3cret "), SECRET));
        assert!(!authorized(Some("Bearer s3cret-s3cret-s3cre"), SECRET));
        assert!(!authorized(Some("Bearer s3cret-s3cret-s3cret!"), SECRET));
        assert!(!authorized(Some("s3cret-s3cret-s3cret"), SECRET));
        assert!(!authorized(Some("Basic s3cret-s3cret-s3cret"), SECRET));
        assert!(!authorized(None, SECRET));
    }

    #[test]
    fn an_empty_secret_authorises_nobody() {
        assert!(!authorized(Some("Bearer "), ""));
        assert!(!authorized(Some("Bearer"), ""));
    }

    #[test]
    fn parses_a_well_formed_request() {
        let request = parse_send_request(
            br#"{"subscription_id":"00000000-0000-4000-8000-000000000001","kind":"pickup","subject":"ride-1"}"#,
        )
        .unwrap();

        assert_eq!(request.kind, ReminderKind::Pickup);
        assert_eq!(request.subject, "ride-1");
    }

    #[test]
    fn refuses_what_could_not_be_a_request() {
        assert!(parse_send_request(b"not json").is_err());
        assert!(
            parse_send_request(br#"{"subscription_id":"x","kind":"pickup","subject":"r"}"#)
                .is_err()
        );
        assert!(parse_send_request(
            br#"{"subscription_id":"00000000-0000-4000-8000-000000000001","kind":"marketing","subject":"r"}"#
        )
        .is_err());
        assert!(parse_send_request(
            br#"{"subscription_id":"00000000-0000-4000-8000-000000000001","kind":"pickup","subject":""}"#
        )
        .is_err());
        let long = "x".repeat(65);
        assert!(parse_send_request(
            format!(r#"{{"subscription_id":"00000000-0000-4000-8000-000000000001","kind":"pickup","subject":"{long}"}}"#)
                .as_bytes()
        )
        .is_err());
    }

    #[test]
    fn nothing_to_do_is_a_success_so_the_workflow_does_not_retry() {
        assert_eq!(status_for(SendOutcome::Sent), 200);
        assert_eq!(status_for(SendOutcome::AlreadySent), 200);
        assert_eq!(status_for(SendOutcome::NotDue), 200);
        assert_eq!(status_for(SendOutcome::UnknownSubscription), 404);
        assert_eq!(status_for(SendOutcome::Gone), 404);
        assert_eq!(status_for(SendOutcome::Failed), 502);
    }
}
