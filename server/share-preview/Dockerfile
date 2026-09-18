# share.kikouchou.app — the per-trip link preview.
#
# Two stages: a Rust toolchain that produces one static-ish binary, and a Debian
# slim image that carries the binary, a certificate store and a font. Nothing
# else. The build stage is never shipped.
#
# NOTHING SECRET IS BUILT IN. This service reads Supabase with the service role
# key, which bypasses Row-Level Security, and that key arrives at run time as an
# environment variable. A build arg would be readable in `docker history` by
# anyone who pulls the image.

FROM rust:1.98-slim-bookworm AS build
WORKDIR /build

# The one C dependency in the tree. Reminders encrypt their payload with
# `web-push`, which delegates to `ece`, and `ece` binds to real OpenSSL rather
# than shipping its own crypto — its only backend does, and `web-push` takes it
# with default features on, so there is no pure-Rust path to switch to. Without
# these the build dies in `openssl-sys` with "requires the `pkg-config` utility
# to find OpenSSL but `pkg-config` could not be found".
#
# Everything else here still speaks rustls: `reqwest` is built with
# `rustls-tls`, so this is OpenSSL for payload encryption and not for TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends pkg-config libssl-dev \
 && rm -rf /var/lib/apt/lists/*

# Dependencies first, against a stub `main.rs`, so editing this service's own
# source does not recompile yrs, resvg and reqwest every time. The stub is then
# replaced and only the last crate rebuilds.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
 && cargo build --release \
 && rm -rf src

COPY src ./src
# The stub binary is newer than the real sources otherwise, and cargo would
# happily ship the stub.
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim AS runtime

# `ca-certificates` is what lets the service reach Supabase over TLS at all.
# `fonts-dejavu-core` is what lets resvg draw text: a container has no fonts,
# and a missing font renders as nothing rather than as a fallback. DejaVu is
# also what `public/og-card.png` is rasterised with on the CI runner, so the
# generic card and the per-trip one set type identically.
# `libssl3` is the runtime half of the build stage's `libssl-dev`: the binary
# links OpenSSL dynamically for reminder payload encryption, so without it the
# container dies on start with a missing shared object. `ca-certificates`
# happens to pull it in today; naming it means that staying true is not luck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates fonts-dejavu-core libssl3 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /build/target/release/share-preview /usr/local/bin/share-preview

# Nothing here writes to disk, so the process needs no home and no privileges.
RUN useradd --system --create-home --shell /usr/sbin/nologin preview
USER preview

ENV PORT=8080
EXPOSE 8080

# The health check hits the one route with no database behind it, so a Supabase
# outage does not make Docker restart a container that is answering correctly.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["share-preview", "--health-check"]

CMD ["share-preview"]
