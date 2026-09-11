//! Reads an invite, its trip, and its document out of Supabase.
//!
//! This is the only module that talks to the database, and it does so with the
//! service role key, which bypasses Row-Level Security. Two consequences shape
//! the code below.
//!
//! First, every query is narrow on purpose: four tables, a handful of columns,
//! one trip at a time, filtered by a token the caller had to already know. A
//! service role key can read every trip in the project; the defence against it
//! doing so is that no code path here takes anything wider than one token.
//!
//! Second, the checks RLS would normally make are made here by hand. An invite
//! that is revoked, expired or used up must stop showing its card: a link you
//! withdrew has to stop telling a group chat what your trip is called. That is
//! why [`load_shared_trip`] returns a reason rather than an `Option` — the
//! caller logs it and shows nothing.
//!
//! Requests go to PostgREST directly rather than through a client library. Four
//! URLs and a bearer token is the whole protocol.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use reqwest::Client;
use serde::Deserialize;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use yrs::updates::decoder::Decode as _;
use yrs::{Doc, Transact as _, Update};

use crate::config::Config;
use crate::reminders::{ReminderKind, Subscription};
use crate::trip_preview::{build_trip_preview, TripPreview, TripRow};

// ============================================================================
// Types
// ============================================================================

/// What a share token resolved to.
#[derive(Debug, Clone, PartialEq)]
pub enum LoadResult {
    Ok(Box<TripPreview>),
    /// No such token, or a token that is not shaped like one.
    NotFound,
    Revoked,
    Expired,
    /// The use cap is reached, so the link no longer admits anybody.
    Exhausted,
    /// The database could not be reached, or answered with something unreadable.
    Error,
}

impl LoadResult {
    /// The word the access log records. Never a token, never a trip name.
    pub fn outcome(&self) -> &'static str {
        match self {
            Self::Ok(_) => "preview",
            Self::NotFound => "not-found",
            Self::Revoked => "revoked",
            Self::Expired => "expired",
            Self::Exhausted => "exhausted",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Deserialize)]
struct InviteRow {
    trip_id: String,
    expires_at: Option<String>,
    max_uses: Option<i64>,
    uses: i64,
    revoked_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TripJson {
    name: String,
    start_date: String,
    end_date: String,
}

#[derive(Debug, Deserialize)]
struct SnapshotJson {
    state: String,
    through_id: i64,
}

#[derive(Debug, Deserialize)]
struct UpdateJson {
    update: String,
}

/// One row of `reminder_log`, as the sender reads it back.
#[derive(Debug, Clone, Deserialize)]
pub struct ReminderLogRow {
    pub kind: String,
    pub subject: String,
    pub sent_at: Option<String>,
}

/// Holds the HTTP client and the credentials for the life of the process.
pub struct TripSource {
    client: Client,
    rest_url: String,
    service_role_key: String,
}

// ============================================================================
// Constants
// ============================================================================

/// Longest a database round trip may take before the preview gives up. A
/// crawler will not wait, and a request that hangs holds a connection.
const REQUEST_TIMEOUT_SECS: u64 = 5;

/// Ceiling on the log rows folded in after a snapshot.
///
/// Compaction keeps the tail short, so a healthy trip has tens. The cap is what
/// stops a trip compaction has not reached from making one crawler request pull
/// megabytes. Past it the preview is drawn from the snapshot alone, which is
/// stale by minutes rather than wrong.
const MAX_UPDATES: usize = 2000;

// ============================================================================
// Public API — pure parts
// ============================================================================

/// Whether a string is shaped like the `uuid` Postgres writes.
///
/// Every id this service interpolates into a PostgREST filter passes through
/// here first, so a value from a webhook body can never carry `&select=` or a
/// second filter into the query string.
pub fn is_uuid_shaped(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
}

/// Whether a path segment could be a token at all.
///
/// This is what `lib/sync/invites.ts` mints and what the table's check
/// constraint accepts. Applied before the query, so a scan for
/// `/../../etc/passwd` costs no round trip.
pub fn is_token_shaped(token: &str) -> bool {
    (16..=64).contains(&token.len())
        && token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// Rebuilds a document from a snapshot and the log written after it.
///
/// Returns `None` when nothing applied. A document that will not apply is not
/// an error: the card falls back to the trip's name and dates, which is a worse
/// card and still a card. One malformed update is skipped rather than losing
/// the rest of the document with it.
pub fn rebuild_doc(state: Option<&str>, updates: &[String]) -> Option<Doc> {
    let doc = Doc::new();
    let mut applied = 0usize;

    for encoded in state.into_iter().chain(updates.iter().map(String::as_str)) {
        let Ok(bytes) = BASE64.decode(encoded) else {
            continue;
        };
        let Ok(update) = Update::decode_v1(&bytes) else {
            continue;
        };
        if doc.transact_mut().apply_update(update).is_ok() {
            applied += 1;
        }
    }

    (applied > 0).then_some(doc)
}

/// The reason an invite may not be shown, or `None` when it is live.
fn rejection(invite: &InviteRow, now: OffsetDateTime) -> Option<LoadResult> {
    if invite.revoked_at.is_some() {
        return Some(LoadResult::Revoked);
    }
    if let Some(expires_at) = invite.expires_at.as_deref() {
        match OffsetDateTime::parse(expires_at, &Rfc3339) {
            Ok(deadline) if deadline <= now => return Some(LoadResult::Expired),
            // A timestamp this service cannot read is treated as expired. The
            // column is written by Postgres, so this cannot happen; if it ever
            // does, the safe reading of "unknown expiry" is "do not show it".
            Err(_) => return Some(LoadResult::Expired),
            Ok(_) => {}
        }
    }
    if let Some(max_uses) = invite.max_uses {
        if invite.uses >= max_uses {
            return Some(LoadResult::Exhausted);
        }
    }
    None
}

// ============================================================================
// Public API — the reads
// ============================================================================

impl TripSource {
    pub fn new(config: &Config) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
                .build()?,
            rest_url: format!("{}/rest/v1", config.supabase_url),
            service_role_key: config.service_role_key.clone(),
        })
    }

    /// The headers every PostgREST call carries.
    fn authed(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        request
            .header("apikey", &self.service_role_key)
            .header("authorization", format!("Bearer {}", self.service_role_key))
            .header("accept", "application/json")
    }

    /// One PostgREST GET, deserialised into a row list.
    ///
    /// Every failure says so on stderr, and none of them says what it was
    /// reading. `table` names the table for the log; the query string carries a
    /// token, which is a credential, so it never reaches a log line — and
    /// neither does a `reqwest::Error`'s own message until `without_url` has
    /// taken the URL, and the token in it, back out.
    async fn get<T: for<'de> Deserialize<'de>>(
        &self,
        table: &'static str,
        path_and_query: &str,
    ) -> Option<Vec<T>> {
        let response = match self
            .authed(
                self.client
                    .get(format!("{}/{path_and_query}", self.rest_url)),
            )
            .send()
            .await
        {
            Ok(response) => response,
            // Never reached the server at all: DNS, TLS, a refused connection,
            // or the timeout. This used to return None in silence, which left a
            // 503 with nothing in the log to say why.
            Err(error) => {
                eprintln!("supabase {table} request failed: {}", error.without_url());
                return None;
            }
        };

        if !response.status().is_success() {
            // The body may name a column or a policy. It is not logged and it is
            // certainly not returned; the status is all the caller needs. 401 is
            // the wrong key, 403 a missing grant, 404 a wrong SUPABASE_URL.
            eprintln!(
                "supabase {table} read failed with status {}",
                response.status()
            );
            return None;
        }

        match response.json::<Vec<T>>().await {
            Ok(rows) => Some(rows),
            Err(error) => {
                eprintln!(
                    "supabase {table} response did not parse: {}",
                    error.without_url()
                );
                None
            }
        }
    }

    /// One PostgREST write with a JSON body, returning whether it landed.
    async fn write(
        &self,
        method: reqwest::Method,
        path_and_query: &str,
        prefer: &str,
        body: &serde_json::Value,
    ) -> bool {
        let response = self
            .authed(
                self.client
                    .request(method, format!("{}/{path_and_query}", self.rest_url)),
            )
            .header("prefer", prefer)
            .json(body)
            .send()
            .await;
        match response {
            Ok(response) if response.status().is_success() => true,
            Ok(response) => {
                eprintln!("supabase write failed with status {}", response.status());
                false
            }
            Err(error) => {
                eprintln!("supabase write failed: {error}");
                false
            }
        }
    }

    /// Resolves a share token to the preview of the trip behind it.
    pub async fn load_shared_trip(&self, token: &str, now: OffsetDateTime) -> LoadResult {
        if !is_token_shaped(token) {
            return LoadResult::NotFound;
        }

        let Some(invites) = self
            .get::<InviteRow>(
                "trip_invites",
                &format!(
                    "trip_invites?token=eq.{token}\
                 &select=trip_id,expires_at,max_uses,uses,revoked_at&limit=1"
                ),
            )
            .await
        else {
            return LoadResult::Error;
        };
        let Some(invite) = invites.into_iter().next() else {
            return LoadResult::NotFound;
        };
        if let Some(reason) = rejection(&invite, now) {
            return reason;
        }

        let trip_id = &invite.trip_id;
        let Some(trips) = self
            .get::<TripJson>(
                "trips",
                &format!("trips?id=eq.{trip_id}&select=name,start_date,end_date&limit=1"),
            )
            .await
        else {
            return LoadResult::Error;
        };
        let Some(trip) = trips.into_iter().next() else {
            // The invite outlived its trip. `on delete cascade` makes this a
            // race rather than a state, but a deleted trip must not render.
            return LoadResult::NotFound;
        };

        let doc = self.load_document(trip_id).await;
        LoadResult::Ok(Box::new(build_trip_preview(
            doc.as_ref(),
            &TripRow {
                name: trip.name,
                start_date: trip.start_date,
                end_date: trip.end_date,
            },
        )))
    }

    /// The `trips` row behind a server id, for the sender.
    pub async fn load_trip_row(&self, trip_id: &str) -> Option<TripRow> {
        if !is_uuid_shaped(trip_id) {
            return None;
        }
        self.get::<TripJson>(
            "trips",
            &format!("trips?id=eq.{trip_id}&select=name,start_date,end_date&limit=1"),
        )
        .await?
        .into_iter()
        .next()
        .map(|trip| TripRow {
            name: trip.name,
            start_date: trip.start_date,
            end_date: trip.end_date,
        })
    }

    /// Every push subscription there is, ordered by trip so the sender loads
    /// each document once.
    pub async fn list_subscriptions(&self) -> Option<Vec<Subscription>> {
        self.get::<Subscription>(
            "push_subscriptions",
            "push_subscriptions\
             ?select=id,trip_id,person_id,endpoint,p256dh,auth,locale,analytics_id\
             &order=trip_id.asc,id.asc",
        )
        .await
    }

    /// One push subscription by id, for the webhook.
    pub async fn load_subscription(&self, subscription_id: &str) -> Option<Subscription> {
        if !is_uuid_shaped(subscription_id) {
            return None;
        }
        self.get::<Subscription>(
            "push_subscriptions",
            &format!(
                "push_subscriptions?id=eq.{subscription_id}\
                 &select=id,trip_id,person_id,endpoint,p256dh,auth,locale,analytics_id&limit=1"
            ),
        )
        .await?
        .into_iter()
        .next()
    }

    /// Drops a subscription the push service says is gone.
    pub async fn delete_subscription(&self, subscription_id: &str) -> bool {
        if !is_uuid_shaped(subscription_id) {
            return false;
        }
        self.write(
            reqwest::Method::DELETE,
            &format!("push_subscriptions?id=eq.{subscription_id}"),
            "return=minimal",
            &serde_json::Value::Null,
        )
        .await
    }

    /// What has already been reported, and sent, for one subscription.
    pub async fn reminder_log_for(&self, subscription_id: &str) -> Option<Vec<ReminderLogRow>> {
        if !is_uuid_shaped(subscription_id) {
            return None;
        }
        self.get::<ReminderLogRow>(
            "reminder_log",
            &format!(
                "reminder_log?subscription_id=eq.{subscription_id}&select=kind,subject,sent_at"
            ),
        )
        .await
    }

    /// Records that a reminder came due. A row already there is left alone, so
    /// two ticks racing on the same reminder cannot both think they were first.
    pub async fn record_due(
        &self,
        subscription_id: &str,
        kind: ReminderKind,
        subject: &str,
    ) -> bool {
        if !is_uuid_shaped(subscription_id) {
            return false;
        }
        self.write(
            reqwest::Method::POST,
            "reminder_log?on_conflict=subscription_id,kind,subject",
            "resolution=ignore-duplicates,return=minimal",
            &serde_json::json!({
                "subscription_id": subscription_id,
                "kind": kind.as_str(),
                "subject": subject,
            }),
        )
        .await
    }

    /// Stamps a reminder as sent.
    pub async fn mark_sent(
        &self,
        subscription_id: &str,
        kind: ReminderKind,
        subject: &str,
        sent_at: OffsetDateTime,
    ) -> bool {
        if !is_uuid_shaped(subscription_id) {
            return false;
        }
        let Ok(stamp) = sent_at.format(&Rfc3339) else {
            return false;
        };
        // `subject` is a document id or an ISO date, both from this service's
        // own reads, but the filter is percent-encoded all the same.
        let encoded_subject: String = subject
            .bytes()
            .map(|byte| match byte {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' => {
                    (byte as char).to_string()
                }
                other => format!("%{other:02X}"),
            })
            .collect();
        self.write(
            reqwest::Method::PATCH,
            &format!(
                "reminder_log?subscription_id=eq.{subscription_id}\
                 &kind=eq.{}&subject=eq.{encoded_subject}",
                kind.as_str()
            ),
            "return=minimal",
            &serde_json::json!({ "sent_at": stamp }),
        )
        .await
    }

    /// The compacted snapshot plus every update after it, folded into one doc.
    pub async fn load_document(&self, trip_id: &str) -> Option<Doc> {
        let snapshot = self
            .get::<SnapshotJson>(
                "trip_doc_snapshots",
                &format!("trip_doc_snapshots?trip_id=eq.{trip_id}&select=state,through_id&limit=1"),
            )
            .await
            .and_then(|rows| rows.into_iter().next());

        let through_id = snapshot.as_ref().map_or(0, |row| row.through_id);
        let updates = self
            .get::<UpdateJson>(
                "trip_doc_updates",
                &format!(
                    "trip_doc_updates?trip_id=eq.{trip_id}&id=gt.{through_id}\
                 &select=update&order=id.asc&limit={MAX_UPDATES}"
                ),
            )
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|row| row.update)
            .collect::<Vec<_>>();

        rebuild_doc(snapshot.as_ref().map(|row| row.state.as_str()), &updates)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{Map as _, MapPrelim, ReadTxn as _};

    fn invite() -> InviteRow {
        InviteRow {
            trip_id: "11111111-1111-1111-1111-111111111111".to_owned(),
            expires_at: None,
            max_uses: None,
            uses: 0,
            revoked_at: None,
        }
    }

    fn now() -> OffsetDateTime {
        OffsetDateTime::parse("2026-09-07T12:00:00Z", &Rfc3339).expect("a fixed instant")
    }

    #[test]
    fn recognises_a_uuid_and_nothing_that_could_smuggle_a_filter() {
        assert!(is_uuid_shaped("aaaaaaaa-0000-0000-0000-000000000001"));
        assert!(is_uuid_shaped("00000000-0000-4000-8000-00000000000A"));
        assert!(!is_uuid_shaped("aaaaaaaa-0000-0000-0000-00000000000"));
        assert!(!is_uuid_shaped(
            "aaaaaaaa-0000-0000-0000-000000000001&select=*"
        ));
        assert!(!is_uuid_shaped("aaaaaaaa00000000000000000000000000001"));
    }

    #[test]
    fn accepts_a_token_and_refuses_anything_else() {
        assert!(is_token_shaped("OMIMwxRIi6TF_KP6"));
        assert!(is_token_shaped("aB-dEfGhIjKl_456"));
        assert!(!is_token_shaped("short"));
        assert!(!is_token_shaped("../../etc/passwd"));
        assert!(!is_token_shaped(&"x".repeat(65)));
    }

    #[test]
    fn a_live_invite_has_no_reason_to_be_hidden() {
        assert_eq!(rejection(&invite(), now()), None);
    }

    #[test]
    fn a_revoked_invite_stops_rendering() {
        let revoked = InviteRow {
            revoked_at: Some("2026-09-01T00:00:00Z".to_owned()),
            ..invite()
        };

        assert_eq!(rejection(&revoked, now()), Some(LoadResult::Revoked));
    }

    #[test]
    fn expiry_is_compared_against_the_clock_it_is_given() {
        let expires = |stamp: &str| InviteRow {
            expires_at: Some(stamp.to_owned()),
            ..invite()
        };

        assert_eq!(
            rejection(&expires("2026-09-07T11:59:59Z"), now()),
            Some(LoadResult::Expired)
        );
        assert_eq!(rejection(&expires("2026-09-07T12:00:01Z"), now()), None);
        // An offset that is not UTC still compares as an instant.
        assert_eq!(
            rejection(&expires("2026-09-07T14:00:01+02:00"), now()),
            None
        );
    }

    #[test]
    fn an_unreadable_expiry_is_treated_as_expired() {
        let broken = InviteRow {
            expires_at: Some("whenever".to_owned()),
            ..invite()
        };

        assert_eq!(rejection(&broken, now()), Some(LoadResult::Expired));
    }

    #[test]
    fn a_used_up_invite_stops_rendering() {
        let capped = |uses| InviteRow {
            max_uses: Some(2),
            uses,
            ..invite()
        };

        assert_eq!(rejection(&capped(1), now()), None);
        assert_eq!(rejection(&capped(2), now()), Some(LoadResult::Exhausted));
        assert_eq!(rejection(&capped(9), now()), Some(LoadResult::Exhausted));
    }

    #[test]
    fn rebuilds_a_document_from_base64_the_way_the_column_stores_it() {
        let source = Doc::new();
        {
            let map = source.get_or_insert_map("guestsById");
            let mut txn = source.transact_mut();
            map.insert(&mut txn, "g1", MapPrelim::default());
        }
        let encoded = BASE64.encode(
            source
                .transact()
                .encode_state_as_update_v1(&yrs::StateVector::default()),
        );

        let rebuilt = rebuild_doc(Some(&encoded), &[]).expect("a document");

        assert!(rebuilt.transact().get_map("guestsById").is_some());
    }

    #[test]
    fn skips_what_it_cannot_decode_and_keeps_the_rest() {
        let source = Doc::new();
        {
            let map = source.get_or_insert_map("roomsById");
            let mut txn = source.transact_mut();
            map.insert(&mut txn, "r1", MapPrelim::default());
        }
        let encoded = BASE64.encode(
            source
                .transact()
                .encode_state_as_update_v1(&yrs::StateVector::default()),
        );

        let rebuilt = rebuild_doc(
            Some("not base64 at all!!"),
            &[BASE64.encode([1u8, 2, 3]), encoded],
        )
        .expect("a document");

        assert!(rebuilt.transact().get_map("roomsById").is_some());
    }

    #[test]
    fn gives_up_when_nothing_applies() {
        assert!(rebuild_doc(None, &[]).is_none());
        assert!(rebuild_doc(Some("!!!"), &["also not base64".to_owned()]).is_none());
    }
}
