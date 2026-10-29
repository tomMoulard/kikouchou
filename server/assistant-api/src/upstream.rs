//! The call to OpenRouter, on the project's key.
//!
//! The answer is not read here: its body, a server-sent event stream in the
//! OpenAI format, goes back to the browser as it arrives. The client already
//! parses that format for the presets where the user brings a key, so both
//! paths share one parser.

use std::future::Future;
use std::time::Duration;

use axum::body::Body;
use serde_json::Value;

// ============================================================================
// Types
// ============================================================================

pub struct UpstreamReply {
    pub status: u16,
    pub body: Body,
}

pub trait Upstream: Send + Sync + 'static {
    fn complete(&self, body: Value) -> impl Future<Output = Result<UpstreamReply, String>> + Send;
}

pub struct OpenRouter {
    api_key: String,
    app_origin: String,
    client: reqwest::Client,
}

// ============================================================================
// Constants
// ============================================================================

const COMPLETIONS_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

/// The whole answer, stream included. A small model answers in seconds; this
/// only stops a connection that hangs.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(180);

// ============================================================================
// Implementation
// ============================================================================

impl OpenRouter {
    pub fn new(api_key: &str, app_origin: &str, client: reqwest::Client) -> Self {
        Self {
            api_key: api_key.to_owned(),
            app_origin: app_origin.to_owned(),
            client,
        }
    }
}

impl Upstream for OpenRouter {
    async fn complete(&self, body: Value) -> Result<UpstreamReply, String> {
        let response = self
            .client
            .post(COMPLETIONS_URL)
            .bearer_auth(&self.api_key)
            .header("HTTP-Referer", &self.app_origin)
            .header("X-Title", "Kikouchou")
            .json(&body)
            .timeout(ANSWER_TIMEOUT)
            .send()
            .await
            .map_err(|error| format!("openrouter request failed: {error}"))?;

        Ok(UpstreamReply {
            status: response.status().as_u16(),
            body: Body::from_stream(response.bytes_stream()),
        })
    }
}
