//! api.kikouchou.app: the app's API.
//!
//! Its first route is the assistant's chat, for a signed-in account. The app's
//! cloud presets used to need the user's own OpenRouter key. This route
//! answers with the project's key instead, so somebody with an account
//! and no OpenRouter account can use the assistant. In exchange it verifies the
//! Supabase token, bounds the body, and counts each account against a daily
//! limit before anything reaches the model. See `README.md`.

mod app;
mod auth;
mod config;
mod cors;
mod quota;
mod request;
mod upstream;

use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use tokio::net::TcpListener;

use crate::app::App;
use crate::auth::KeyStore;
use crate::config::Config;
use crate::quota::SupabaseQuota;
use crate::upstream::OpenRouter;

type Service = App<KeyStore, SupabaseQuota, OpenRouter>;

/// Larger than any conversation [`request::MAX_TOTAL_CHARS`] admits, so the
/// bound that answers is the one with a readable error.
const BODY_LIMIT_BYTES: usize = 512 * 1024;

async fn chat(State(app): State<Arc<Service>>, headers: HeaderMap, body: Bytes) -> Response {
    app.chat(&headers, &body).await
}

async fn preflight(State(app): State<Arc<Service>>, headers: HeaderMap) -> Response {
    app.preflight(&headers)
}

async fn healthz() -> &'static str {
    "ok"
}

async fn not_found() -> Response {
    StatusCode::NOT_FOUND.into_response()
}

/// Docker sends SIGTERM and waits before SIGKILL; an answer being streamed
/// gets that time to finish.
async fn shutdown_signal() {
    let interrupt = async {
        tokio::signal::ctrl_c().await.ok();
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = interrupt => println!("SIGINT received, closing"),
        () = terminate => println!("SIGTERM received, closing"),
    }
}

/// The container's health check, run as `kikouchou-api --health-check`, so
/// the image needs no `curl`.
async fn health_check() -> Result<(), Box<dyn std::error::Error>> {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_owned());
    let response = reqwest::get(format!("http://127.0.0.1:{port}/healthz")).await?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("health check returned {}", response.status()).into())
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().any(|argument| argument == "--health-check") {
        return health_check().await;
    }

    let config = Config::from_env()?;
    println!(
        "kikouchou-api listening on {}, model {}, {} assistant requests per account per day",
        config.port, config.openrouter_model, config.daily_limit
    );

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()?;
    let app = Arc::new(App {
        verifier: KeyStore::new(&config.supabase_url, client.clone()),
        quota: SupabaseQuota::new(
            &config.supabase_url,
            &config.service_role_key,
            client.clone(),
        ),
        upstream: OpenRouter::new(&config.openrouter_api_key, &config.app_origin, client),
        config,
    });
    let port = app.config.port;

    let service = axum::Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/chat/completions", post(chat).options(preflight))
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(BODY_LIMIT_BYTES))
        .with_state(app);
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;

    axum::serve(listener, service)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}
