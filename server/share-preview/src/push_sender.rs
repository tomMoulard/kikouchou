//! Finds the reminders that are due and pushes them to the phones that asked.
//!
//! Two entry points, one loop:
//!
//! - [`PushSender::tick`] runs on a timer (hourly by default). It loads every
//!   subscription, rebuilds each trip's document once, asks `reminders` what is
//!   due for each subscriber, drops what the feature flags switched off or the
//!   log already holds, records the rest as due, and tells PostHog. In `direct`
//!   mode it then sends at once.
//! - [`PushSender::send_by_id`] answers `POST /push/send`: the callback a
//!   PostHog workflow makes after its own delays and conditions. It recomputes
//!   the reminder from the live document — so a ride deleted in the meantime is
//!   `NotDue`, not a stale push — and sends once, whatever the retries.
//!
//! The payload is encrypted to the subscribing browser (RFC 8291) and signed
//! with the VAPID key (RFC 8292) by the `web-push` crate; the HTTP round trip
//! is this service's own `reqwest` client, so the crate's HTTP stacks stay out
//! of the image. A push service answering 404 or 410 means the browser is gone,
//! and the subscription goes with it.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use reqwest::Client;
use serde_json::json;
use time::{Duration, OffsetDateTime};
use web_push::{
    request_builder, ContentEncoding, SubscriptionInfo, Urgency, VapidSignatureBuilder,
    WebPushMessageBuilder,
};

use crate::config::{Config, SendMode};
use crate::posthog::PostHog;
use crate::reminders::{
    due_reminders, read_trip_facts, Clock, DueReminder, ReminderKind, Subscription,
};
use crate::trip_source::TripSource;

// ============================================================================
// Types
// ============================================================================

/// What `POST /push/send` reports back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendOutcome {
    Sent,
    /// The log already holds a `sent_at`: a retry, answered without a second push.
    AlreadySent,
    /// Nothing in the live document makes this reminder due any more.
    NotDue,
    UnknownSubscription,
    /// The push service said the browser is gone; the subscription was removed.
    Gone,
    /// The push service, or the database, could not be reached or refused.
    Failed,
}

impl SendOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sent => "sent",
            Self::AlreadySent => "already_sent",
            Self::NotDue => "not_due",
            Self::UnknownSubscription => "unknown_subscription",
            Self::Gone => "gone",
            Self::Failed => "failed",
        }
    }
}

/// Why one push did not land.
#[derive(Debug)]
enum DeliveryError {
    /// 404 or 410: the endpoint will never work again.
    Gone,
    /// Everything else, with a word for the log.
    Failed(&'static str),
}

pub struct PushSender {
    source: Arc<TripSource>,
    posthog: Option<PostHog>,
    http: Client,
    /// The VAPID private key, base64url without padding — the form
    /// `scripts/generate-vapid-keys.mjs` prints.
    vapid_private_key: String,
    /// The `sub` claim: a `mailto:` the push service can reach on abuse.
    vapid_subject: String,
    mode: SendMode,
    eve_hour_utc: u8,
    pickup_window: Duration,
}

// ============================================================================
// Constants
// ============================================================================

/// How long the push service keeps an undelivered push. A phone off for the
/// night still gets the morning's reminder; one off for a day gets nothing
/// stale.
const PUSH_TTL_SECS: u32 = 12 * 60 * 60;

const PUSH_TIMEOUT_SECS: u64 = 10;

// ============================================================================
// Internal helpers
// ============================================================================

/// The person the events land on: the browser's own PostHog id when it passed
/// one, the subscription id otherwise.
fn distinct_id(subscription: &Subscription) -> &str {
    subscription
        .analytics_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .unwrap_or(&subscription.id)
}

fn event_properties(subscription: &Subscription, reminder: &DueReminder) -> serde_json::Value {
    json!({
        "subscription_id": subscription.id,
        "trip_id": subscription.trip_id,
        "kind": reminder.kind.as_str(),
        "subject": reminder.subject,
        "locale": subscription.locale,
        "has_person": subscription.person_id.is_some(),
    })
}

// ============================================================================
// Public API
// ============================================================================

impl PushSender {
    /// `None` when no VAPID key is configured: the service then previews links
    /// and sends nothing, as before.
    pub fn new(config: &Config, source: Arc<TripSource>, posthog: Option<PostHog>) -> Option<Self> {
        let vapid_private_key = config.vapid_private_key.clone()?;
        Some(Self {
            source,
            posthog,
            http: Client::builder()
                .timeout(std::time::Duration::from_secs(PUSH_TIMEOUT_SECS))
                .build()
                .ok()?,
            vapid_private_key,
            vapid_subject: config.vapid_subject.clone(),
            mode: config.push_send_mode,
            eve_hour_utc: config.reminder_eve_hour_utc,
            pickup_window: Duration::minutes(config.reminder_pickup_window_minutes as i64),
        })
    }

    fn clock(&self, now: OffsetDateTime) -> Clock {
        Clock {
            now,
            eve_hour_utc: self.eve_hour_utc,
            pickup_window: self.pickup_window,
        }
    }

    /// One pass over every subscription. Never fails: a trip that will not load
    /// or a push that will not send is logged and the pass moves on.
    pub async fn tick(&self, now: OffsetDateTime) {
        let Some(subscriptions) = self.source.list_subscriptions().await else {
            eprintln!("reminders: could not list subscriptions");
            return;
        };

        let mut by_trip: BTreeMap<String, Vec<Subscription>> = BTreeMap::new();
        for subscription in subscriptions {
            by_trip
                .entry(subscription.trip_id.clone())
                .or_default()
                .push(subscription);
        }

        let clock = self.clock(now);
        let mut reported = 0usize;
        let mut sent = 0usize;

        for (trip_id, subscriptions) in by_trip {
            let Some(trip) = self.source.load_trip_row(&trip_id).await else {
                continue;
            };
            let doc = self.source.load_document(&trip_id).await;
            let facts = read_trip_facts(doc.as_ref(), &trip);

            for subscription in subscriptions {
                let due = due_reminders(
                    &facts,
                    subscription.person_id.as_deref(),
                    subscription.language(),
                    &clock,
                );
                if due.is_empty() {
                    continue;
                }

                let Some(log) = self.source.reminder_log_for(&subscription.id).await else {
                    continue;
                };
                let logged: HashMap<(String, String), Option<String>> = log
                    .into_iter()
                    .map(|row| ((row.kind, row.subject), row.sent_at))
                    .collect();

                let flags = match &self.posthog {
                    Some(posthog) => posthog.flags(distinct_id(&subscription)).await,
                    None => HashMap::new(),
                };

                for reminder in due {
                    if flags.get(reminder.kind.flag_key()) == Some(&Some(false)) {
                        continue;
                    }
                    let key = (reminder.kind.as_str().to_owned(), reminder.subject.clone());
                    if logged.contains_key(&key) {
                        continue;
                    }
                    if !self
                        .source
                        .record_due(&subscription.id, reminder.kind, &reminder.subject)
                        .await
                    {
                        continue;
                    }
                    reported += 1;
                    if let Some(posthog) = &self.posthog {
                        posthog
                            .capture(
                                "reminder_due",
                                distinct_id(&subscription),
                                event_properties(&subscription, &reminder),
                            )
                            .await;
                    }
                    if self.mode == SendMode::Direct
                        && self.deliver_and_record(&subscription, &reminder, now).await
                            == SendOutcome::Sent
                    {
                        sent += 1;
                    }
                }
            }
        }

        println!("reminders tick: {reported} due, {sent} sent");
    }

    /// Sends one reminder on request, once.
    pub async fn send_by_id(
        &self,
        subscription_id: &str,
        kind: ReminderKind,
        subject: &str,
        now: OffsetDateTime,
    ) -> SendOutcome {
        let Some(subscription) = self.source.load_subscription(subscription_id).await else {
            return SendOutcome::UnknownSubscription;
        };

        let Some(log) = self.source.reminder_log_for(&subscription.id).await else {
            return SendOutcome::Failed;
        };
        if log
            .iter()
            .any(|row| row.kind == kind.as_str() && row.subject == subject && row.sent_at.is_some())
        {
            return SendOutcome::AlreadySent;
        }

        // From the live document, not from the event: a ride moved or deleted
        // since the tick must not produce a push about where it used to be.
        let Some(trip) = self.source.load_trip_row(&subscription.trip_id).await else {
            return SendOutcome::Failed;
        };
        let doc = self.source.load_document(&subscription.trip_id).await;
        let facts = read_trip_facts(doc.as_ref(), &trip);
        let Some(reminder) = due_reminders(
            &facts,
            subscription.person_id.as_deref(),
            subscription.language(),
            &self.clock(now),
        )
        .into_iter()
        .find(|candidate| candidate.kind == kind && candidate.subject == subject) else {
            return SendOutcome::NotDue;
        };

        // A workflow can be fed a due event this service never logged (a
        // replay, a test run); the row has to exist before it is stamped.
        self.source
            .record_due(&subscription.id, kind, subject)
            .await;

        self.deliver_and_record(&subscription, &reminder, now).await
    }

    /// Pushes, stamps the log, tells PostHog, prunes a dead subscription.
    async fn deliver_and_record(
        &self,
        subscription: &Subscription,
        reminder: &DueReminder,
        now: OffsetDateTime,
    ) -> SendOutcome {
        match self.deliver(subscription, reminder).await {
            Ok(()) => {
                self.source
                    .mark_sent(&subscription.id, reminder.kind, &reminder.subject, now)
                    .await;
                if let Some(posthog) = &self.posthog {
                    posthog
                        .capture(
                            "reminder_sent",
                            distinct_id(subscription),
                            event_properties(subscription, reminder),
                        )
                        .await;
                }
                SendOutcome::Sent
            }
            Err(DeliveryError::Gone) => {
                self.source.delete_subscription(&subscription.id).await;
                if let Some(posthog) = &self.posthog {
                    posthog
                        .capture(
                            "reminder_subscription_gone",
                            distinct_id(subscription),
                            json!({ "subscription_id": subscription.id, "trip_id": subscription.trip_id }),
                        )
                        .await;
                }
                SendOutcome::Gone
            }
            Err(DeliveryError::Failed(reason)) => {
                eprintln!("push to subscription {} failed: {reason}", subscription.id);
                SendOutcome::Failed
            }
        }
    }

    /// One encrypted, signed push to one browser.
    async fn deliver(
        &self,
        subscription: &Subscription,
        reminder: &DueReminder,
    ) -> Result<(), DeliveryError> {
        let info = SubscriptionInfo::new(
            subscription.endpoint.clone(),
            subscription.p256dh.clone(),
            subscription.auth.clone(),
        );

        let mut signature = VapidSignatureBuilder::from_base64(&self.vapid_private_key, &info)
            .map_err(|_| DeliveryError::Failed("vapid key unusable"))?;
        signature.add_claim("sub", self.vapid_subject.clone());
        let signature = signature
            .build()
            .map_err(|_| DeliveryError::Failed("vapid signature"))?;

        let payload = serde_json::to_vec(&json!({
            "title": reminder.title,
            "body": reminder.body,
            "url": reminder.url,
            "tag": format!("reminder:{}:{}", reminder.kind.as_str(), reminder.subject),
            "kind": reminder.kind.as_str(),
        }))
        .map_err(|_| DeliveryError::Failed("payload"))?;

        let mut builder = WebPushMessageBuilder::new(&info);
        builder.set_payload(ContentEncoding::Aes128Gcm, &payload);
        builder.set_vapid_signature(signature);
        builder.set_ttl(PUSH_TTL_SECS);
        builder.set_urgency(Urgency::Normal);
        let message = builder
            .build()
            .map_err(|_| DeliveryError::Failed("encryption"))?;

        // The crate builds an `http` 0.2 request; reqwest speaks `http` 1. The
        // parts are copied across rather than converted.
        let request = request_builder::build_request::<Vec<u8>>(message);
        let mut outgoing = self.http.post(request.uri().to_string());
        for (name, value) in request.headers() {
            outgoing = outgoing.header(name.as_str(), value.as_bytes());
        }
        let response = outgoing
            .body(request.into_body())
            .send()
            .await
            .map_err(|_| DeliveryError::Failed("push service unreachable"))?;

        match response.status().as_u16() {
            200..=299 => Ok(()),
            404 | 410 => Err(DeliveryError::Gone),
            401 | 403 => Err(DeliveryError::Failed("push service refused the VAPID key")),
            413 => Err(DeliveryError::Failed("payload too large")),
            429 => Err(DeliveryError::Failed("rate limited")),
            500..=599 => Err(DeliveryError::Failed("push service error")),
            _ => Err(DeliveryError::Failed("unexpected status")),
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn subscription(analytics_id: Option<&str>) -> Subscription {
        Subscription {
            id: "00000000-0000-4000-8000-000000000001".to_owned(),
            trip_id: "aaaaaaaa-0000-0000-0000-000000000001".to_owned(),
            person_id: Some("alice".to_owned()),
            endpoint: "https://push.example.test/send/abc".to_owned(),
            p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM"
                .to_owned(),
            auth: "tBHItJI5svbpez7KI4CCXg".to_owned(),
            locale: "fr".to_owned(),
            analytics_id: analytics_id.map(str::to_owned),
        }
    }

    #[test]
    fn events_land_on_the_browsers_own_person_when_it_gave_one() {
        assert_eq!(distinct_id(&subscription(Some("ph-123"))), "ph-123");
        assert_eq!(
            distinct_id(&subscription(None)),
            "00000000-0000-4000-8000-000000000001"
        );
        assert_eq!(
            distinct_id(&subscription(Some(""))),
            "00000000-0000-4000-8000-000000000001"
        );
    }

    #[test]
    fn outcomes_have_stable_names_for_the_webhook_reply() {
        assert_eq!(SendOutcome::Sent.as_str(), "sent");
        assert_eq!(SendOutcome::AlreadySent.as_str(), "already_sent");
        assert_eq!(SendOutcome::NotDue.as_str(), "not_due");
        assert_eq!(SendOutcome::Gone.as_str(), "gone");
    }

    #[test]
    fn event_properties_carry_the_key_and_never_the_endpoint() {
        let reminder = DueReminder {
            kind: ReminderKind::Pickup,
            subject: "ride-1".to_owned(),
            title: String::new(),
            body: String::new(),
            url: String::new(),
        };

        let properties = event_properties(&subscription(None), &reminder);

        assert_eq!(properties["kind"], "pickup");
        assert_eq!(properties["subject"], "ride-1");
        assert_eq!(properties["has_person"], true);
        // The endpoint is a capability to send to that phone. It goes nowhere.
        assert!(!properties.to_string().contains("push.example.test"));
    }
}
