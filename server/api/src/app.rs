//! `POST /v1/chat/completions`: token, body, quota, then the answer.
//!
//! The order is the cost order. A request without a valid account never
//! reaches the quota, and a request over the quota never reaches OpenRouter.
//! The request is counted before the answer, so an answer that fails upstream
//! still counts: the alternative lets a caller retry for free against a
//! provider that is charging for the attempts.
//!
//! An error answer is JSON, `{"error":{"code":…,"message":…}}`, with a status
//! the client maps to what it tells the user:
//!
//! | Status | `code` | Meaning |
//! |---|---|---|
//! | 400 | `invalid_request` | the body broke a bound in [`crate::request`] |
//! | 401 | `unauthorized` | no token, or one that does not verify |
//! | 403 | `sign_in_required` | an anonymous session |
//! | 429 | `daily_limit` | the account's allowance for today is spent |
//! | 502 | `provider` | OpenRouter refused or failed |
//! | 503 | `unavailable` | the keys or the quota could not be reached |

use std::future::Future;
use std::time::Instant;

use axum::body::Body;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use serde_json::json;

use crate::auth::{bearer_token, AuthError, Identity, KeyStore};
use crate::config::Config;
use crate::cors;
use crate::quota::Quota;
use crate::request::{parse, upstream_body};
use crate::upstream::Upstream;

// ============================================================================
// Types
// ============================================================================

pub trait Verifier: Send + Sync + 'static {
    fn verify(&self, token: &str) -> impl Future<Output = Result<Identity, AuthError>> + Send;
}

impl Verifier for KeyStore {
    async fn verify(&self, token: &str) -> Result<Identity, AuthError> {
        KeyStore::verify(self, token).await
    }
}

pub struct App<V, Q, U> {
    pub config: Config,
    pub verifier: V,
    pub quota: Q,
    pub upstream: U,
}

// ============================================================================
// Handlers
// ============================================================================

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    let body = json!({ "error": { "code": code, "message": message } }).to_string();
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

impl<V: Verifier, Q: Quota, U: Upstream> App<V, Q, U> {
    /// The answer to one chat request, CORS headers included.
    pub async fn chat(&self, headers: &HeaderMap, body: &[u8]) -> Response {
        let started_at = Instant::now();
        let origin = headers.get("origin").and_then(|value| value.to_str().ok());

        let (mut response, outcome) = self.answer(headers, body).await;

        cors::apply(
            response.headers_mut(),
            origin,
            &self.config.allowed_origins,
            false,
        );
        // Never the user, the prompt or the answer: a status and a word.
        println!(
            "POST /v1/chat/completions {} {}ms {outcome}",
            response.status().as_u16(),
            started_at.elapsed().as_millis()
        );
        response
    }

    async fn answer(&self, headers: &HeaderMap, body: &[u8]) -> (Response, &'static str) {
        let authorization = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok());
        let token = match bearer_token(authorization) {
            Ok(token) => token,
            Err(_) => {
                return (
                    error(StatusCode::UNAUTHORIZED, "unauthorized", "sign in first"),
                    "no-token",
                )
            }
        };

        let identity = match self.verifier.verify(token).await {
            Ok(identity) => identity,
            Err(AuthError::Anonymous) => {
                return (
                    error(
                        StatusCode::FORBIDDEN,
                        "sign_in_required",
                        "an account is required",
                    ),
                    "anonymous",
                )
            }
            Err(AuthError::KeysUnavailable) => {
                return (
                    error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "unavailable",
                        "try again later",
                    ),
                    "no-keys",
                )
            }
            Err(_) => {
                return (
                    error(StatusCode::UNAUTHORIZED, "unauthorized", "sign in again"),
                    "bad-token",
                )
            }
        };

        let messages = match parse(body) {
            Ok(messages) => messages,
            Err(problem) => {
                return (
                    error(
                        StatusCode::BAD_REQUEST,
                        "invalid_request",
                        problem.message(),
                    ),
                    "invalid",
                )
            }
        };

        match self
            .quota
            .consume(&identity.user_id, self.config.daily_limit)
            .await
        {
            Ok(true) => {}
            Ok(false) => {
                return (
                    error(
                        StatusCode::TOO_MANY_REQUESTS,
                        "daily_limit",
                        "the daily limit is reached",
                    ),
                    "over-limit",
                )
            }
            Err(problem) => {
                println!("{problem}");
                return (
                    error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "unavailable",
                        "try again later",
                    ),
                    "no-quota",
                );
            }
        }

        let upstream = upstream_body(
            &messages,
            &self.config.openrouter_model,
            self.config.max_tokens,
        );
        match self.upstream.complete(upstream).await {
            Ok(reply) if reply.status == 200 => {
                let response = Response::builder()
                    .status(StatusCode::OK)
                    .header("content-type", "text/event-stream")
                    .header("cache-control", "no-store")
                    .body(reply.body)
                    .unwrap_or_else(|_| Response::new(Body::empty()));
                (response, "answered")
            }
            Ok(reply) => {
                println!("openrouter answered {}", reply.status);
                (
                    error(
                        StatusCode::BAD_GATEWAY,
                        "provider",
                        "the model did not answer",
                    ),
                    "provider-status",
                )
            }
            Err(problem) => {
                println!("{problem}");
                (
                    error(
                        StatusCode::BAD_GATEWAY,
                        "provider",
                        "the model did not answer",
                    ),
                    "provider-error",
                )
            }
        }
    }

    /// The answer to a CORS preflight.
    pub fn preflight(&self, headers: &HeaderMap) -> Response {
        let origin = headers.get("origin").and_then(|value| value.to_str().ok());
        let mut response = Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Body::empty())
            .unwrap_or_else(|_| Response::new(Body::empty()));
        cors::apply(
            response.headers_mut(),
            origin,
            &self.config.allowed_origins,
            true,
        );
        response
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::tests::{sign, test_keys, user_token, TEST_ISSUER};
    use crate::auth::verify_with;
    use crate::upstream::UpstreamReply;
    use http_body_util::BodyExt;
    use serde_json::Value;
    use std::sync::Mutex;

    struct StaticKeys;

    impl Verifier for StaticKeys {
        async fn verify(&self, token: &str) -> Result<Identity, AuthError> {
            verify_with(&test_keys(), token, TEST_ISSUER)
        }
    }

    #[derive(Default)]
    struct FakeQuota {
        answer: Option<Result<bool, String>>,
        calls: Mutex<Vec<(String, u32)>>,
    }

    impl Quota for FakeQuota {
        async fn consume(&self, user_id: &str, limit: u32) -> Result<bool, String> {
            self.calls.lock().unwrap().push((user_id.to_owned(), limit));
            self.answer.clone().unwrap_or(Ok(true))
        }
    }

    #[derive(Default)]
    struct FakeUpstream {
        status: Option<u16>,
        sent: Mutex<Vec<Value>>,
    }

    impl Upstream for FakeUpstream {
        async fn complete(&self, body: Value) -> Result<UpstreamReply, String> {
            self.sent.lock().unwrap().push(body);
            Ok(UpstreamReply {
                status: self.status.unwrap_or(200),
                body: Body::from(
                    "data: {\"choices\":[{\"delta\":{\"content\":\"Hi\"}}]}\n\ndata: [DONE]\n\n",
                ),
            })
        }
    }

    fn config() -> Config {
        Config::from_lookup(|name| {
            match name {
                "SUPABASE_URL" => Some("https://ref.supabase.co"),
                "SUPABASE_SERVICE_ROLE_KEY" => Some("service"),
                "OPENROUTER_API_KEY" => Some("sk-or"),
                "DAILY_LIMIT" => Some("5"),
                _ => None,
            }
            .map(str::to_owned)
        })
        .unwrap()
    }

    fn app(quota: FakeQuota, upstream: FakeUpstream) -> App<StaticKeys, FakeQuota, FakeUpstream> {
        App {
            config: config(),
            verifier: StaticKeys,
            quota,
            upstream,
        }
    }

    fn headers(token: Option<&str>) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("origin", "https://app.kikouchou.app".parse().unwrap());
        if let Some(token) = token {
            headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
        }
        headers
    }

    fn chat_body() -> Vec<u8> {
        serde_json::to_vec(&json!({
            "messages": [{"role": "user", "content": "Plan a weekend in Lisbon"}]
        }))
        .unwrap()
    }

    async fn read(response: Response) -> (u16, String) {
        let status = response.status().as_u16();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, String::from_utf8(bytes.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn streams_the_answer_for_a_signed_in_user() {
        let app = app(FakeQuota::default(), FakeUpstream::default());

        let response = app
            .chat(&headers(Some(&user_token("user-1"))), &chat_body())
            .await;

        assert_eq!(response.headers()["content-type"], "text/event-stream");
        assert_eq!(
            response.headers()["access-control-allow-origin"],
            "https://app.kikouchou.app"
        );
        let (status, body) = read(response).await;
        assert_eq!(status, 200);
        assert!(body.contains("[DONE]"));
        assert_eq!(
            *app.quota.calls.lock().unwrap(),
            vec![("user-1".to_owned(), 5)]
        );
        assert_eq!(
            app.upstream.sent.lock().unwrap()[0]["model"],
            "openrouter/auto"
        );
    }

    #[tokio::test]
    async fn refuses_a_request_without_a_token_before_counting_it() {
        let app = app(FakeQuota::default(), FakeUpstream::default());

        let (status, body) = read(app.chat(&headers(None), &chat_body()).await).await;

        assert_eq!(status, 401);
        assert!(body.contains("\"unauthorized\""));
        assert!(app.quota.calls.lock().unwrap().is_empty());
        assert!(app.upstream.sent.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn asks_an_anonymous_session_to_sign_in() {
        let app = app(FakeQuota::default(), FakeUpstream::default());
        let token = sign(json!({
            "sub": "anon",
            "aud": "authenticated",
            "iss": TEST_ISSUER,
            "exp": 4_102_444_800u64,
            "is_anonymous": true,
        }));

        let (status, body) = read(app.chat(&headers(Some(&token)), &chat_body()).await).await;

        assert_eq!(status, 403);
        assert!(body.contains("sign_in_required"));
        assert!(app.quota.calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn refuses_a_bad_body_before_counting_it() {
        let app = app(FakeQuota::default(), FakeUpstream::default());

        let (status, _) = read(app.chat(&headers(Some(&user_token("user-1"))), b"{}").await).await;

        assert_eq!(status, 400);
        assert!(app.quota.calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn stops_at_the_daily_limit_without_calling_the_model() {
        let app = app(
            FakeQuota {
                answer: Some(Ok(false)),
                ..FakeQuota::default()
            },
            FakeUpstream::default(),
        );

        let (status, body) = read(
            app.chat(&headers(Some(&user_token("user-1"))), &chat_body())
                .await,
        )
        .await;

        assert_eq!(status, 429);
        assert!(body.contains("daily_limit"));
        assert!(app.upstream.sent.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn refuses_when_the_quota_cannot_be_read() {
        let app = app(
            FakeQuota {
                answer: Some(Err("down".to_owned())),
                ..FakeQuota::default()
            },
            FakeUpstream::default(),
        );

        let (status, _) = read(
            app.chat(&headers(Some(&user_token("user-1"))), &chat_body())
                .await,
        )
        .await;

        assert_eq!(status, 503);
        assert!(app.upstream.sent.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn reports_a_provider_failure_without_relaying_it() {
        let app = app(
            FakeQuota::default(),
            FakeUpstream {
                status: Some(401),
                ..FakeUpstream::default()
            },
        );

        let (status, body) = read(
            app.chat(&headers(Some(&user_token("user-1"))), &chat_body())
                .await,
        )
        .await;

        // The project's key being refused is not the user's session expiring.
        assert_eq!(status, 502);
        assert!(body.contains("\"provider\""));
    }

    #[tokio::test]
    async fn answers_a_preflight_from_the_app_only() {
        let app = app(FakeQuota::default(), FakeUpstream::default());

        let allowed = app.preflight(&headers(None));
        assert_eq!(allowed.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            allowed.headers()["access-control-allow-methods"],
            "POST, OPTIONS"
        );

        let mut other = HeaderMap::new();
        other.insert("origin", "https://evil.example".parse().unwrap());
        let refused = app.preflight(&other);
        assert!(refused
            .headers()
            .get("access-control-allow-origin")
            .is_none());
    }
}
