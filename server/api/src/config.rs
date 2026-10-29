//! Everything this service reads from its environment.
//!
//! Read once at startup, so a missing value is a container that refuses to
//! start rather than a request that fails later.
//!
//! Two values are secrets, and both arrive at **run time**, never as a build
//! arg, so neither is in the image or in `docker history`:
//!
//! - `OPENROUTER_API_KEY`, the project's own key. Every answer is paid with it,
//!   which is why a request needs an account and counts against a daily limit.
//! - `SUPABASE_SERVICE_ROLE_KEY`, used for one call only: the quota function in
//!   [`crate::quota`]. It is never logged and never sent anywhere but Supabase.

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
    /// Service role key. Reaches the quota function and nothing else.
    pub service_role_key: String,
    /// The project's OpenRouter key. Never leaves this process.
    pub openrouter_api_key: String,
    /// The model every answer is asked of. The client does not choose it.
    pub openrouter_model: String,
    /// Requests one account may make per UTC day.
    pub daily_limit: u32,
    /// Origins a browser may call from (CORS).
    pub allowed_origins: Vec<String>,
    /// Origin of the app, sent to OpenRouter as `HTTP-Referer`.
    pub app_origin: String,
    /// Upper bound on the tokens of one answer.
    pub max_tokens: u32,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ConfigError {
    Missing(&'static str),
    Invalid(&'static str, String),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Missing(name) => write!(f, "{name} is required"),
            Self::Invalid(name, value) => write!(f, "{name} is not valid: {value:?}"),
        }
    }
}

impl std::error::Error for ConfigError {}

// ============================================================================
// Constants
// ============================================================================

/// The web app, and the two origins a store app's web view has (Capacitor on
/// iOS and on Android).
const DEFAULT_ALLOWED_ORIGINS: &str =
    "https://app.kikouchou.app,capacitor://localhost,https://localhost";

/// OpenRouter picks the model per question. Chosen on 2026-10-29.
const DEFAULT_MODEL: &str = "openrouter/auto";

const DEFAULT_DAILY_LIMIT: u32 = 30;

/// The same cap the client sends to OpenRouter when the user brings a key.
const DEFAULT_MAX_TOKENS: u32 = 2048;

// ============================================================================
// Reading
// ============================================================================

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| env::var(name).ok())
    }

    /// Reads through `lookup`, so the tests do not touch the process
    /// environment.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let get = |name: &str| lookup(name).filter(|value| !value.trim().is_empty());
        let required = |name: &'static str| get(name).ok_or(ConfigError::Missing(name));

        let supabase_url = required("SUPABASE_URL")?.trim_end_matches('/').to_owned();
        if !supabase_url.starts_with("https://") && !supabase_url.starts_with("http://") {
            return Err(ConfigError::Invalid("SUPABASE_URL", supabase_url));
        }

        Ok(Self {
            port: parse_or(get("PORT"), "PORT", 8080)?,
            supabase_url,
            service_role_key: required("SUPABASE_SERVICE_ROLE_KEY")?,
            openrouter_api_key: required("OPENROUTER_API_KEY")?,
            openrouter_model: get("OPENROUTER_MODEL").unwrap_or_else(|| DEFAULT_MODEL.to_owned()),
            daily_limit: parse_or(get("DAILY_LIMIT"), "DAILY_LIMIT", DEFAULT_DAILY_LIMIT)?,
            allowed_origins: get("ALLOWED_ORIGINS")
                .unwrap_or_else(|| DEFAULT_ALLOWED_ORIGINS.to_owned())
                .split(',')
                .map(|origin| origin.trim().trim_end_matches('/').to_owned())
                .filter(|origin| !origin.is_empty())
                .collect(),
            app_origin: get("APP_ORIGIN").unwrap_or_else(|| "https://app.kikouchou.app".to_owned()),
            max_tokens: parse_or(get("MAX_TOKENS"), "MAX_TOKENS", DEFAULT_MAX_TOKENS)?,
        })
    }
}

fn parse_or<T: std::str::FromStr>(
    value: Option<String>,
    name: &'static str,
    default: T,
) -> Result<T, ConfigError> {
    match value {
        None => Ok(default),
        Some(raw) => raw
            .trim()
            .parse()
            .map_err(|_| ConfigError::Invalid(name, raw)),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn lookup(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect();
        move |name| map.get(name).cloned()
    }

    const REQUIRED: [(&str, &str); 3] = [
        ("SUPABASE_URL", "https://ref.supabase.co/"),
        ("SUPABASE_SERVICE_ROLE_KEY", "service"),
        ("OPENROUTER_API_KEY", "sk-or"),
    ];

    #[test]
    fn applies_the_defaults() {
        let config = Config::from_lookup(lookup(&REQUIRED)).unwrap();

        assert_eq!(config.port, 8080);
        assert_eq!(config.supabase_url, "https://ref.supabase.co");
        assert_eq!(config.openrouter_model, "openrouter/auto");
        assert_eq!(config.daily_limit, 30);
        assert_eq!(config.max_tokens, 2048);
        assert_eq!(
            config.allowed_origins,
            vec![
                "https://app.kikouchou.app",
                "capacitor://localhost",
                "https://localhost"
            ]
        );
    }

    #[test]
    fn refuses_to_start_without_a_secret() {
        for missing in [
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "OPENROUTER_API_KEY",
        ] {
            let pairs: Vec<_> = REQUIRED
                .iter()
                .copied()
                .filter(|(key, _)| *key != missing)
                .collect();
            assert_eq!(
                Config::from_lookup(lookup(&pairs)).unwrap_err(),
                ConfigError::Missing(missing)
            );
        }
    }

    #[test]
    fn treats_a_blank_value_as_missing() {
        let mut pairs = REQUIRED.to_vec();
        pairs[2] = ("OPENROUTER_API_KEY", "  ");
        assert_eq!(
            Config::from_lookup(lookup(&pairs)).unwrap_err(),
            ConfigError::Missing("OPENROUTER_API_KEY")
        );
    }

    #[test]
    fn rejects_a_limit_that_is_not_a_number() {
        let mut pairs = REQUIRED.to_vec();
        pairs.push(("DAILY_LIMIT", "lots"));
        assert_eq!(
            Config::from_lookup(lookup(&pairs)).unwrap_err(),
            ConfigError::Invalid("DAILY_LIMIT", "lots".to_owned())
        );
    }

    #[test]
    fn reads_the_origins_as_a_list() {
        let mut pairs = REQUIRED.to_vec();
        pairs.push((
            "ALLOWED_ORIGINS",
            "http://localhost:5173/, https://app.kikouchou.app",
        ));
        let config = Config::from_lookup(lookup(&pairs)).unwrap();
        assert_eq!(
            config.allowed_origins,
            vec!["http://localhost:5173", "https://app.kikouchou.app"]
        );
    }
}
