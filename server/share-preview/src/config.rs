//! Everything this service reads from its environment.
//!
//! Read once at startup and never again, so a missing value is a container that
//! refuses to start rather than a request that fails at three in the morning.
//!
//! The service role key is the reason this process exists at all: `trip_invites`
//! is protected by Row-Level Security, and no anonymous caller may read a row of
//! it. A crawler has no session, so the only way to answer it is a server
//! holding a key that bypasses the policies. That key therefore:
//!
//! - arrives at **run time**, never as a build arg, so it is not in the image
//!   and not in `docker history`;
//! - is never logged, never echoed into a response, and never handed to the page
//!   this service renders;
//! - reaches nothing but the three reads in [`crate::trip_source`].

use std::env;
use std::fmt;

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone)]
pub struct Config {
    /// Port the HTTP server listens on.
    pub port: u16,
    /// Supabase project URL, e.g. `https://<ref>.supabase.co`.
    pub supabase_url: String,
    /// Service role key. Bypasses RLS. Never leaves this process.
    pub service_role_key: String,
    /// Origin this service answers on, used to build absolute `og:` URLs.
    pub share_origin: String,
    /// Origin of the app a real browser is sent to.
    pub app_origin: String,
    /// Seconds a rendered preview is kept, in memory and in `Cache-Control`.
    pub cache_seconds: u64,

    // ---- Reminders (`push_sender`). All optional: without a VAPID key the
    // ---- service previews links and sends nothing, as it always did.
    /// PostHog ingestion host, e.g. the `events.kikouchou.app` proxy.
    pub posthog_host: Option<String>,
    /// PostHog project key — the public one the browser bundle also carries.
    pub posthog_key: Option<String>,
    /// VAPID private key, base64url without padding. Never logged.
    pub vapid_private_key: Option<String>,
    /// VAPID `sub` claim: a `mailto:` the push services can write to.
    pub vapid_subject: String,
    /// Shared secret a PostHog workflow presents on `POST /push/send`.
    pub push_webhook_secret: Option<String>,
    /// Whether a due reminder is pushed at once or left to the workflow.
    pub push_send_mode: SendMode,
    /// Seconds between two passes over the subscriptions.
    pub reminder_interval_secs: u64,
    /// UTC hour from which "tomorrow" reminders go out.
    pub reminder_eve_hour_utc: u8,
    /// How far ahead a pickup is announced, in minutes.
    pub reminder_pickup_window_minutes: u64,
}

/// Who sends a due reminder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendMode {
    /// This service, at the tick that found it due. The default, and the
    /// fallback when no workflow is set up: the PostHog flags are the control.
    Direct,
    /// Nobody, until a PostHog workflow calls `POST /push/send`.
    Workflow,
}

/// Why the configuration could not be read. Never carries a value, only a name:
/// a startup error is written to a log somebody else may read.
#[derive(Debug)]
pub enum ConfigError {
    Missing(&'static str),
    NotANumber(&'static str),
    /// A value that is not one of the words the variable accepts.
    NotAChoice(&'static str),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing(name) => write!(out, "{name} is required"),
            Self::NotANumber(name) => write!(out, "{name} must be a non-negative number"),
            Self::NotAChoice(name) => write!(out, "{name} has a value this service does not know"),
        }
    }
}

impl std::error::Error for ConfigError {}

// ============================================================================
// Internal helpers
// ============================================================================

fn required(name: &'static str) -> Result<String, ConfigError> {
    match env::var(name) {
        Ok(value) if !value.trim().is_empty() => Ok(value.trim().to_owned()),
        _ => Err(ConfigError::Missing(name)),
    }
}

fn optional(name: &str, fallback: &str) -> String {
    match env::var(name) {
        Ok(value) if !value.trim().is_empty() => value.trim().to_owned(),
        _ => fallback.to_owned(),
    }
}

/// Drops trailing slashes, so every URL this service builds has exactly one.
fn origin(name: &str, fallback: &str) -> String {
    optional(name, fallback).trim_end_matches('/').to_owned()
}

fn number<T: std::str::FromStr>(name: &'static str, fallback: T) -> Result<T, ConfigError> {
    match env::var(name) {
        Ok(value) if !value.trim().is_empty() => value
            .trim()
            .parse()
            .map_err(|_| ConfigError::NotANumber(name)),
        _ => Ok(fallback),
    }
}

/// A value that may be absent, read as `None` when it is blank.
fn maybe(name: &str) -> Option<String> {
    match env::var(name) {
        Ok(value) if !value.trim().is_empty() => Some(value.trim().to_owned()),
        _ => None,
    }
}

fn send_mode(name: &'static str) -> Result<SendMode, ConfigError> {
    match maybe(name).as_deref() {
        None | Some("direct") => Ok(SendMode::Direct),
        Some("workflow") => Ok(SendMode::Workflow),
        Some(_) => Err(ConfigError::NotAChoice(name)),
    }
}

// ============================================================================
// Public API
// ============================================================================

impl Config {
    /// Reads the configuration out of the process environment.
    pub fn from_env() -> Result<Self, ConfigError> {
        Ok(Self {
            port: number("PORT", 8080u16)?,
            supabase_url: required("SUPABASE_URL")?.trim_end_matches('/').to_owned(),
            service_role_key: required("SUPABASE_SERVICE_ROLE_KEY")?,
            share_origin: origin("SHARE_ORIGIN", "https://share.kikouchou.app"),
            app_origin: origin("APP_ORIGIN", "https://app.kikouchou.app"),
            cache_seconds: number("CACHE_SECONDS", 300u64)?,
            posthog_host: maybe("POSTHOG_HOST"),
            posthog_key: maybe("POSTHOG_KEY"),
            vapid_private_key: maybe("VAPID_PRIVATE_KEY"),
            vapid_subject: optional("VAPID_SUBJECT", "mailto:admin@kikouchou.app"),
            push_webhook_secret: maybe("PUSH_WEBHOOK_SECRET"),
            push_send_mode: send_mode("PUSH_SEND_MODE")?,
            reminder_interval_secs: number("REMINDER_INTERVAL_SECONDS", 3600u64)?.max(60),
            reminder_eve_hour_utc: number("REMINDER_EVE_HOUR_UTC", 17u8)?.min(23),
            reminder_pickup_window_minutes: number("REMINDER_PICKUP_WINDOW_MINUTES", 180u64)?,
        })
    }
}
