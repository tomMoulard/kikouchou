//! Process entry point: configuration, caches, HTTP, shutdown.
//!
//! The service has six routes and no middleware worth the dependency, so axum
//! is used as a thin socket-to-function adapter: one fallback handler that
//! passes the method, the path and one header to [`router::route`] and writes
//! back what it returns. Everything worth testing lives on the other side of
//! that call.

mod cache;
mod card_image;
mod card_svg;
mod config;
mod dates;
mod i18n;
mod page;
mod router;
mod trip_preview;
mod trip_source;

use std::sync::Arc;
use std::time::Instant;

use axum::extract::{Request, State};
use axum::http::{HeaderName, HeaderValue, StatusCode};
use axum::response::Response;
use time::OffsetDateTime;
use tokio::net::TcpListener;

use crate::cache::TtlCache;
use crate::card_image::rasterise_card;
use crate::card_svg::render_card_svg;
use crate::config::Config;
use crate::i18n::Language;
use crate::router::{route, Backend};
use crate::trip_preview::TripPreview;
use crate::trip_source::{LoadResult, TripSource};

// ============================================================================
// Constants
// ============================================================================

/// Trips and cards held at once. A few hundred links in flight is far more than
/// this service will ever see, and the ceiling is what keeps a long-lived
/// process from growing without one.
const MAX_CACHED: usize = 500;

// ============================================================================
// Application
// ============================================================================

struct App {
    source: TripSource,
    trips: TtlCache<LoadResult>,
    cards: TtlCache<Vec<u8>>,
    config: Config,
}

impl Backend for App {
    async fn load_trip(&self, token: &str) -> LoadResult {
        if let Some(cached) = self.trips.get(token, Instant::now()) {
            return (*cached).clone();
        }

        let result = self
            .source
            .load_shared_trip(token, OffsetDateTime::now_utc())
            .await;

        // A failure is not a result. Remembering one would serve the same error
        // for the whole TTL after the database came back.
        if !matches!(result, LoadResult::Error) {
            self.trips.insert(token, result.clone(), Instant::now());
        }
        result
    }

    async fn render_card(
        &self,
        preview: &TripPreview,
        language: Language,
        token: &str,
    ) -> Option<Vec<u8>> {
        let key = format!("{language}:{token}");
        if let Some(cached) = self.cards.get(&key, Instant::now()) {
            return Some((*cached).clone());
        }

        // Rasterising is tens of milliseconds of pure CPU. On the async runtime
        // that is tens of milliseconds during which this thread answers nothing.
        let svg = render_card_svg(preview, language);
        let rendered = tokio::task::spawn_blocking(move || rasterise_card(&svg))
            .await
            .ok()?;

        match rendered {
            Ok(png) => Some((*self.cards.insert(&key, png, Instant::now())).clone()),
            Err(error) => {
                eprintln!("card render failed: {error}");
                None
            }
        }
    }
}

// ============================================================================
// HTTP
// ============================================================================

/// Logs one line per request: method, path, status, duration, outcome.
///
/// The path holds a token, and a token is a credential — anyone reading it can
/// see the trip. So the token is replaced before the line is written, and
/// nothing here ever logs a trip name or a guest.
fn log_line(method: &str, path: &str, status: u16, started_at: Instant, outcome: &str) {
    let redacted: Vec<String> = path
        .split('/')
        .map(|segment| {
            if trip_source::is_token_shaped(segment) {
                "<token>".to_owned()
            } else {
                segment.to_owned()
            }
        })
        .collect();
    println!(
        "{method} {} {status} {}ms {outcome}",
        redacted.join("/"),
        started_at.elapsed().as_millis()
    );
}

async fn handle(State(app): State<Arc<App>>, request: Request) -> Response {
    let started_at = Instant::now();
    let method = request.method().as_str().to_owned();
    let path = request.uri().path().to_owned();
    let accept_language = request
        .headers()
        .get("accept-language")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);

    let result = route(
        app.as_ref(),
        &app.config,
        &method,
        &path,
        accept_language.as_deref(),
    )
    .await;

    let mut builder = Response::builder()
        .status(StatusCode::from_u16(result.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR));
    for (name, value) in &result.headers {
        // A header that will not encode is dropped rather than fatal: the only
        // values here are ones this service built, and a missing one costs a
        // cache hint, not the response.
        if let (Ok(name), Ok(value)) = (
            HeaderName::from_bytes(name.as_bytes()),
            HeaderValue::from_str(value),
        ) {
            builder = builder.header(name, value);
        }
    }

    // HEAD carries the headers of the GET and none of its body.
    let body = if method == "HEAD" {
        Vec::new()
    } else {
        result.body
    };

    log_line(&method, &path, result.status, started_at, result.outcome);

    builder
        .body(body.into())
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

use axum::response::IntoResponse as _;

/// Docker sends SIGTERM and waits before SIGKILL. Closing gracefully lets an
/// unfurl in flight finish, rather than turning a deploy into a broken preview
/// that a chat app then caches.
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

/// The container's health check, run as `share-preview --health-check`.
///
/// The binary checks itself rather than the image shipping `curl`: one fewer
/// package in a runtime image, and the check then exercises the same TLS stack
/// and the same port the service is actually listening on.
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
    let port = config.port;
    println!(
        "share-preview listening on {port}, serving {} → {}",
        config.share_origin, config.app_origin
    );

    let app = Arc::new(App {
        source: TripSource::new(&config)?,
        trips: TtlCache::new(config.cache_seconds, MAX_CACHED),
        cards: TtlCache::new(config.cache_seconds, MAX_CACHED),
        config,
    });

    let service = axum::Router::new().fallback(handle).with_state(app);
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;

    axum::serve(listener, service)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}
