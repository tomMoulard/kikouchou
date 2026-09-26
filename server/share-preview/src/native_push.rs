//! Pushes a reminder to a store app: APNs for the iPhone app, FCM for Android.
//!
//! A store app's web view has no Web Push, so its subscription is a device
//! token (`push_subscriptions.transport` is `apns` or `fcm`, and `endpoint`
//! holds the token). The reminder itself is the one [`crate::reminders`]
//! computed from the live document, exactly as for a browser: the same title,
//! the same body, the same `kind` for the click report, and no guest name.
//!
//! Both services authenticate with a short-lived JWT this module signs:
//!
//! - APNs takes an ES256 token signed with the team's `.p8` key, reusable for
//!   up to an hour and refused when it is newer than 20 minutes too often, so
//!   one is kept for 50 minutes.
//! - FCM takes an OAuth access token, bought from Google with an RS256
//!   assertion signed by the service account's key.
//!
//! The HTTP round trip is the sender's own `reqwest` client. APNs speaks
//! HTTP/2 only, which is why the crate's `http2` feature is on.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::config::NativeAppsConfig;
use crate::reminders::DueReminder;

// ============================================================================
// Constants
// ============================================================================

const APNS_PRODUCTION: &str = "https://api.push.apple.com";
const APNS_SANDBOX: &str = "https://api.sandbox.push.apple.com";

/// How long an APNs provider token is reused.
const APNS_TOKEN_LIFETIME: Duration = Duration::from_secs(50 * 60);

/// The OAuth scope FCM's v1 API asks for.
const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";

/// The Android notification channel reminders go to. Created by the app
/// (`lib/notifications/native-push.ts`, `REMINDER_CHANNEL_ID`).
pub const REMINDER_CHANNEL_ID: &str = "trip-reminders";

/// `apns-collapse-id` is capped at 64 bytes.
const APNS_COLLAPSE_ID_MAX: usize = 64;

// ============================================================================
// Types
// ============================================================================

/// Why one native push did not land.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeError {
    /// The token will never work again: the app was removed, or the token is
    /// not one this service issued for this app.
    Gone,
    /// Everything else, with a word for the log.
    Failed(&'static str),
}

/// Which APNs host answered, so a token issued for a development build is
/// retried against the sandbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApnsVerdict {
    Delivered,
    /// `BadDeviceToken` on the production host: maybe a sandbox token.
    TrySandbox,
    Failed(NativeError),
}

#[derive(Serialize)]
struct ApnsClaims<'a> {
    iss: &'a str,
    iat: u64,
}

#[derive(Serialize)]
struct GoogleClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    iat: u64,
    exp: u64,
}

#[derive(Deserialize)]
struct ServiceAccount {
    project_id: String,
    client_email: String,
    private_key: String,
    #[serde(default = "ServiceAccount::default_token_uri")]
    token_uri: String,
}

impl ServiceAccount {
    fn default_token_uri() -> String {
        "https://oauth2.googleapis.com/token".to_owned()
    }
}

#[derive(Deserialize)]
struct AccessToken {
    access_token: String,
    expires_in: u64,
}

struct CachedToken {
    value: String,
    until: Instant,
}

struct Apns {
    team_id: String,
    key_id: String,
    key: EncodingKey,
    topic: String,
    token: Mutex<Option<CachedToken>>,
}

struct Fcm {
    account: ServiceAccount,
    key: EncodingKey,
    token: Mutex<Option<CachedToken>>,
}

/// The two native senders, each present only when its credentials are.
pub struct NativePush {
    apns: Option<Apns>,
    fcm: Option<Fcm>,
}

// ============================================================================
// Pure parts
// ============================================================================

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

fn tag(reminder: &DueReminder) -> String {
    format!("reminder:{}:{}", reminder.kind.as_str(), reminder.subject)
}

/// The APNs request body. Custom keys sit beside `aps`, where the app's push
/// plugin hands them to the page as the notification's `data`.
pub fn apns_payload(reminder: &DueReminder, trip_id: &str) -> Value {
    json!({
        "aps": {
            "alert": { "title": reminder.title, "body": reminder.body },
            "sound": "default",
            // Groups a trip's reminders together in Notification Centre.
            "thread-id": trip_id,
        },
        "kind": reminder.kind.as_str(),
        "url": reminder.url,
        "tag": tag(reminder),
    })
}

/// The collapse id: a second reminder with the same tag replaces the first.
pub fn apns_collapse_id(reminder: &DueReminder) -> String {
    let mut id = tag(reminder);
    while id.len() > APNS_COLLAPSE_ID_MAX {
        id.pop();
    }
    id
}

/// The FCM v1 message. `data` values must be strings.
pub fn fcm_message(token: &str, reminder: &DueReminder, ttl_secs: u32) -> Value {
    let tag = tag(reminder);
    json!({
        "message": {
            "token": token,
            "notification": { "title": reminder.title, "body": reminder.body },
            "data": {
                "kind": reminder.kind.as_str(),
                "url": reminder.url,
                "tag": tag,
            },
            "android": {
                "ttl": format!("{ttl_secs}s"),
                "collapse_key": tag,
                "notification": { "channel_id": REMINDER_CHANNEL_ID, "tag": tag },
            },
        }
    })
}

/// What an APNs answer means. `reason` is the JSON body's `reason`.
pub fn apns_verdict(status: u16, reason: Option<&str>, sandbox: bool) -> ApnsVerdict {
    match (status, reason) {
        (200, _) => ApnsVerdict::Delivered,
        (410, _) | (400, Some("Unregistered")) => ApnsVerdict::Failed(NativeError::Gone),
        (400, Some("BadDeviceToken")) if !sandbox => ApnsVerdict::TrySandbox,
        (400, Some("BadDeviceToken")) => ApnsVerdict::Failed(NativeError::Gone),
        (400, Some("DeviceTokenNotForTopic")) => ApnsVerdict::Failed(NativeError::Gone),
        (403, _) => ApnsVerdict::Failed(NativeError::Failed("apns refused the provider token")),
        (413, _) => ApnsVerdict::Failed(NativeError::Failed("payload too large")),
        (429, _) => ApnsVerdict::Failed(NativeError::Failed("rate limited")),
        (500..=599, _) => ApnsVerdict::Failed(NativeError::Failed("apns error")),
        _ => ApnsVerdict::Failed(NativeError::Failed("unexpected apns status")),
    }
}

/// What an FCM answer means. `code` is the FCM error code, e.g. `UNREGISTERED`,
/// from `error.details[].errorCode`.
pub fn fcm_verdict(status: u16, code: Option<&str>) -> Result<(), NativeError> {
    match (status, code) {
        (200..=299, _) => Ok(()),
        (404, _) | (_, Some("UNREGISTERED")) => Err(NativeError::Gone),
        (400, Some("INVALID_ARGUMENT")) => Err(NativeError::Gone),
        (401 | 403, _) => Err(NativeError::Failed("fcm refused the access token")),
        (429, _) => Err(NativeError::Failed("rate limited")),
        (500..=599, _) => Err(NativeError::Failed("fcm error")),
        _ => Err(NativeError::Failed("unexpected fcm status")),
    }
}

/// Reads FCM's error code out of its error body.
fn fcm_error_code(body: &Value) -> Option<String> {
    body.pointer("/error/details")?
        .as_array()?
        .iter()
        .find_map(|detail| detail.get("errorCode")?.as_str().map(str::to_owned))
}

// ============================================================================
// Public API
// ============================================================================

impl NativePush {
    /// Builds whichever senders the configuration has credentials for. A key
    /// that does not parse is reported by name and leaves that sender off.
    pub fn new(config: &NativeAppsConfig) -> Self {
        let apns = match (
            &config.apple_team_id,
            &config.apns_key_id,
            &config.apns_private_key,
        ) {
            (Some(team_id), Some(key_id), Some(pem)) => {
                match EncodingKey::from_ec_pem(pem.as_bytes()) {
                    Ok(key) => Some(Apns {
                        team_id: team_id.clone(),
                        key_id: key_id.clone(),
                        key,
                        topic: config.ios_bundle_id.clone(),
                        token: Mutex::new(None),
                    }),
                    Err(_) => {
                        eprintln!("APNS_PRIVATE_KEY is not a PEM EC key; iPhone reminders are off");
                        None
                    }
                }
            }
            _ => None,
        };

        let fcm = config.fcm_service_account.as_deref().and_then(|raw| {
            let Ok(account) = serde_json::from_str::<ServiceAccount>(raw) else {
                eprintln!("FCM_SERVICE_ACCOUNT_JSON does not parse; Android reminders are off");
                return None;
            };
            match EncodingKey::from_rsa_pem(account.private_key.as_bytes()) {
                Ok(key) => Some(Fcm {
                    account,
                    key,
                    token: Mutex::new(None),
                }),
                Err(_) => {
                    eprintln!("the FCM service account key is not a PEM RSA key; Android reminders are off");
                    None
                }
            }
        });

        Self { apns, fcm }
    }

    /// Whether any native sender is configured.
    pub fn is_configured(&self) -> bool {
        self.apns.is_some() || self.fcm.is_some()
    }

    /// Pushes one reminder to one iPhone.
    pub async fn send_apns(
        &self,
        http: &Client,
        device_token: &str,
        trip_id: &str,
        reminder: &DueReminder,
        ttl_secs: u32,
    ) -> Result<(), NativeError> {
        let Some(apns) = &self.apns else {
            return Err(NativeError::Failed("no apns key configured"));
        };
        let jwt = apns.provider_token()?;
        let body = apns_payload(reminder, trip_id);
        let expiration = unix_now() + u64::from(ttl_secs);

        for (host, sandbox) in [(APNS_PRODUCTION, false), (APNS_SANDBOX, true)] {
            let response = http
                .post(format!("{host}/3/device/{device_token}"))
                .header("authorization", format!("bearer {jwt}"))
                .header("apns-topic", &apns.topic)
                .header("apns-push-type", "alert")
                .header("apns-priority", "10")
                .header("apns-expiration", expiration.to_string())
                .header("apns-collapse-id", apns_collapse_id(reminder))
                .json(&body)
                .send()
                .await
                .map_err(|_| NativeError::Failed("apns unreachable"))?;
            let status = response.status().as_u16();
            let reason = response
                .json::<Value>()
                .await
                .ok()
                .and_then(|value| value.get("reason")?.as_str().map(str::to_owned));
            match apns_verdict(status, reason.as_deref(), sandbox) {
                ApnsVerdict::Delivered => return Ok(()),
                ApnsVerdict::TrySandbox => continue,
                ApnsVerdict::Failed(error) => return Err(error),
            }
        }
        Err(NativeError::Gone)
    }

    /// Pushes one reminder to one Android phone.
    pub async fn send_fcm(
        &self,
        http: &Client,
        device_token: &str,
        reminder: &DueReminder,
        ttl_secs: u32,
    ) -> Result<(), NativeError> {
        let Some(fcm) = &self.fcm else {
            return Err(NativeError::Failed("no fcm service account configured"));
        };
        let access = fcm.access_token(http).await?;
        let response = http
            .post(format!(
                "https://fcm.googleapis.com/v1/projects/{}/messages:send",
                fcm.account.project_id
            ))
            .bearer_auth(access)
            .json(&fcm_message(device_token, reminder, ttl_secs))
            .send()
            .await
            .map_err(|_| NativeError::Failed("fcm unreachable"))?;
        let status = response.status().as_u16();
        let body = response.json::<Value>().await.unwrap_or(Value::Null);
        fcm_verdict(status, fcm_error_code(&body).as_deref())
    }
}

impl Apns {
    fn provider_token(&self) -> Result<String, NativeError> {
        let mut cached = self
            .token
            .lock()
            .map_err(|_| NativeError::Failed("apns token cache poisoned"))?;
        if let Some(token) = cached.as_ref().filter(|token| token.until > Instant::now()) {
            return Ok(token.value.clone());
        }
        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some(self.key_id.clone());
        let value = encode(
            &header,
            &ApnsClaims {
                iss: &self.team_id,
                iat: unix_now(),
            },
            &self.key,
        )
        .map_err(|_| NativeError::Failed("apns token signing"))?;
        *cached = Some(CachedToken {
            value: value.clone(),
            until: Instant::now() + APNS_TOKEN_LIFETIME,
        });
        Ok(value)
    }
}

impl Fcm {
    async fn access_token(&self, http: &Client) -> Result<String, NativeError> {
        if let Ok(cached) = self.token.lock() {
            if let Some(token) = cached.as_ref().filter(|token| token.until > Instant::now()) {
                return Ok(token.value.clone());
            }
        }
        let iat = unix_now();
        let assertion = encode(
            &Header::new(Algorithm::RS256),
            &GoogleClaims {
                iss: &self.account.client_email,
                scope: FCM_SCOPE,
                aud: &self.account.token_uri,
                iat,
                exp: iat + 3600,
            },
            &self.key,
        )
        .map_err(|_| NativeError::Failed("fcm assertion signing"))?;

        let response = http
            .post(&self.account.token_uri)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .send()
            .await
            .map_err(|_| NativeError::Failed("google oauth unreachable"))?;
        if !response.status().is_success() {
            return Err(NativeError::Failed(
                "google oauth refused the service account",
            ));
        }
        let token = response
            .json::<AccessToken>()
            .await
            .map_err(|_| NativeError::Failed("google oauth answer unreadable"))?;

        // Renewed a minute early, so a token never expires mid-request.
        let lifetime = Duration::from_secs(token.expires_in.saturating_sub(60));
        if let Ok(mut cached) = self.token.lock() {
            *cached = Some(CachedToken {
                value: token.access_token.clone(),
                until: Instant::now() + lifetime,
            });
        }
        Ok(token.access_token)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reminders::ReminderKind;

    fn reminder() -> DueReminder {
        DueReminder {
            kind: ReminderKind::Pickup,
            subject: "ride-1".to_owned(),
            title: "Pickup soon".to_owned(),
            body: "The station, in about 2 h".to_owned(),
            url: String::new(),
        }
    }

    #[test]
    fn the_apns_payload_carries_the_click_report_beside_aps() {
        let payload = apns_payload(&reminder(), "trip-1");
        assert_eq!(payload["aps"]["alert"]["title"], "Pickup soon");
        assert_eq!(payload["aps"]["thread-id"], "trip-1");
        assert_eq!(payload["kind"], "pickup");
        assert_eq!(payload["tag"], "reminder:pickup:ride-1");
    }

    #[test]
    fn the_collapse_id_fits_the_apns_limit() {
        let mut long = reminder();
        long.subject = "x".repeat(200);
        assert!(apns_collapse_id(&long).len() <= APNS_COLLAPSE_ID_MAX);
        assert_eq!(apns_collapse_id(&reminder()), "reminder:pickup:ride-1");
    }

    #[test]
    fn the_fcm_message_names_the_reminder_channel_and_keeps_data_strings() {
        let message = fcm_message("token-1", &reminder(), 43_200);
        assert_eq!(message["message"]["token"], "token-1");
        assert_eq!(message["message"]["android"]["ttl"], "43200s");
        assert_eq!(
            message["message"]["android"]["notification"]["channel_id"],
            REMINDER_CHANNEL_ID
        );
        for value in message["message"]["data"].as_object().unwrap().values() {
            assert!(
                value.is_string(),
                "FCM refuses a data value that is not a string"
            );
        }
    }

    #[test]
    fn a_production_bad_token_is_retried_in_the_sandbox_and_then_dropped() {
        assert_eq!(
            apns_verdict(400, Some("BadDeviceToken"), false),
            ApnsVerdict::TrySandbox
        );
        assert_eq!(
            apns_verdict(400, Some("BadDeviceToken"), true),
            ApnsVerdict::Failed(NativeError::Gone)
        );
    }

    #[test]
    fn apns_answers_map_to_outcomes() {
        assert_eq!(apns_verdict(200, None, false), ApnsVerdict::Delivered);
        assert_eq!(
            apns_verdict(410, Some("Unregistered"), false),
            ApnsVerdict::Failed(NativeError::Gone)
        );
        assert!(matches!(
            apns_verdict(403, Some("InvalidProviderToken"), false),
            ApnsVerdict::Failed(NativeError::Failed(_))
        ));
        assert!(matches!(
            apns_verdict(503, None, false),
            ApnsVerdict::Failed(NativeError::Failed(_))
        ));
    }

    #[test]
    fn fcm_answers_map_to_outcomes() {
        assert_eq!(fcm_verdict(200, None), Ok(()));
        assert_eq!(
            fcm_verdict(404, Some("UNREGISTERED")),
            Err(NativeError::Gone)
        );
        assert_eq!(
            fcm_verdict(400, Some("UNREGISTERED")),
            Err(NativeError::Gone)
        );
        assert!(matches!(
            fcm_verdict(401, None),
            Err(NativeError::Failed(_))
        ));
        assert!(matches!(
            fcm_verdict(500, None),
            Err(NativeError::Failed(_))
        ));
    }

    #[test]
    fn the_fcm_error_code_is_read_from_the_details() {
        let body = json!({
            "error": {
                "code": 404,
                "status": "NOT_FOUND",
                "details": [
                    { "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", "errorCode": "UNREGISTERED" }
                ]
            }
        });
        assert_eq!(fcm_error_code(&body).as_deref(), Some("UNREGISTERED"));
        assert_eq!(fcm_error_code(&Value::Null), None);
    }

    #[test]
    fn no_credentials_means_no_native_sender() {
        assert!(!NativePush::new(&NativeAppsConfig::default()).is_configured());
    }

    #[test]
    fn a_key_that_does_not_parse_leaves_the_sender_off() {
        let config = NativeAppsConfig {
            apple_team_id: Some("ABCDE12345".to_owned()),
            apns_key_id: Some("KEY1234567".to_owned()),
            apns_private_key: Some("not a key".to_owned()),
            fcm_service_account: Some("{}".to_owned()),
            ..NativeAppsConfig::default()
        };
        assert!(!NativePush::new(&config).is_configured());
    }
}
