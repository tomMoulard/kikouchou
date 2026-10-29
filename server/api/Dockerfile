# api.kikouchou.app: the app's API. Today it answers the assistant's chat, on
# the project's OpenRouter key.
#
# Two stages: a Rust toolchain that produces one binary, and a Debian slim
# image that carries it and a certificate store. The build stage is never
# shipped.
#
# NOTHING SECRET IS BUILT IN. The OpenRouter key pays for every answer and the
# service role key bypasses Row-Level Security; both arrive at run time as
# environment variables. A build arg would be readable in `docker history` by
# anyone who pulls the image.

FROM rust:1.98-slim-bookworm AS build
WORKDIR /build

# Dependencies first, against a stub `main.rs`, so editing this service's own
# source does not recompile reqwest and axum every time.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
 && cargo build --release \
 && rm -rf src

COPY src ./src
# The stub binary is newer than the real sources otherwise, and cargo would
# ship the stub.
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim AS runtime

# `ca-certificates` lets the service reach Supabase and OpenRouter over TLS.
# Nothing here links OpenSSL: reqwest is built with rustls.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /build/target/release/kikouchou-api /usr/local/bin/kikouchou-api

RUN useradd --system --create-home --shell /usr/sbin/nologin api
USER api

ENV PORT=8080
EXPOSE 8080

# `/healthz` has nothing behind it, so an OpenRouter or Supabase outage does
# not make Docker restart a container that is answering correctly.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["kikouchou-api", "--health-check"]

CMD ["kikouchou-api"]
