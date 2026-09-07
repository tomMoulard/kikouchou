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
}

/// Why the configuration could not be read. Never carries a value, only a name:
/// a startup error is written to a log somebody else may read.
#[derive(Debug)]
pub enum ConfigError {
    Missing(&'static str),
    NotANumber(&'static str),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing(name) => write!(out, "{name} is required"),
            Self::NotANumber(name) => write!(out, "{name} must be a non-negative number"),
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
        })
    }
}
