# syntax=docker/dockerfile:1.7
#
# The image behind the `app` service in docker-compose.yml.
#
# It must stay comparable to the GitHub Pages build in
# .github/workflows/deploy.yml, because both write into one PostHog project and
# a difference between them shows up as an error nobody can attribute. The two
# ways they had drifted, and what fixed each, are noted at the steps below:
# an unpinned dependency install, and source maps that were never uploaded and
# then served to the public.

FROM oven/bun:1-alpine AS build
WORKDIR /app

# Installed from the lockfile, exactly as CI does it.
#
# This was `npm install` against package.json, which resolves `^1.424.0` to
# whatever is newest on the day of the build. The result was a deployment
# running a posthog-js the repository had never seen — events from it reported
# five different library versions between 1.427.3 and 1.434.2 while the Pages
# build reported a steady 1.424.0 — so "does this reproduce on the version we
# ship?" had no answer. `--frozen-lockfile` also fails the build when
# package.json and bun.lock disagree, rather than quietly resolving around it.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build configuration, passed explicitly and never inherited.
#
# `vite build` inlines every VITE_* variable it can see into the JavaScript this
# image serves, and it reads `.env.local` when one is present. `COPY . .` used to
# hand it a developer's real credentials — a real Supabase project and a real
# PostHog key, on a container answering at http://localhost:3000. That is where
# most of the phantom PostHog people came from. `.dockerignore` now keeps `.env*`
# out of the context, and configuration arrives here instead:
#
#   docker build --build-arg VITE_SUPABASE_URL=… --build-arg VITE_POSTHOG_KEY=… .
#
# Empty by default, which builds the local-only offline app: no backend, no
# analytics. Note that a build arg is visible in `docker history`; that is fine
# for these, which are publishable client-side values by design, and is another
# reason no service-role secret may ever be added here.
#
# VITE_APP_VERSION is what tells one deployment from another in PostHog, and an
# image built without it reports its events as `dev`. Pass the commit:
#
#   docker build --build-arg VITE_APP_VERSION="$(git rev-parse HEAD)" .
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_PUBLISHABLE_KEY=""
ARG VITE_POSTHOG_KEY=""
ARG VITE_POSTHOG_HOST=""
ARG VITE_APP_VERSION=""
ARG VITE_SHARE_ORIGIN=""
ARG VITE_VAPID_PUBLIC_KEY=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY \
    VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST \
    VITE_APP_VERSION=$VITE_APP_VERSION \
    VITE_SHARE_ORIGIN=$VITE_SHARE_ORIGIN \
    VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY

COPY . .
RUN bun run build

# Source maps: upload them to PostHog, then make sure none are served.
#
# `vite.config.ts` sets `sourcemap: true` so PostHog can de-minify a production
# stack trace. The Pages workflow uploads the .map files and deletes them; this
# image did neither, so a stack trace from this deployment arrived minified and
# unreadable *and* every .map was copied into the nginx stage and served
# publicly from the same paths as the bundles.
#
# The key is a BuildKit secret, not a build arg: a build arg is recorded in
# `docker history`, and POSTHOG_CLI_API_KEY is a personal API key rather than a
# publishable one. Provide it with
#
#   docker build --secret id=posthog_cli_api_key,env=POSTHOG_CLI_API_KEY .
#
# or let docker-compose.yml pass it. Without it the upload is skipped with a
# warning and the build continues — the same "absent configuration means
# silence" contract src/lib/posthog.ts follows.
#
# `sourcemap process` is inject followed by upload: inject rewrites the bundles
# in place with a chunk ID, which is what PostHog matches a stack trace to its
# map by, so both have to run before the files are copied out. `--delete-after`
# removes the maps it uploaded, and the `find` after it is outside the
# conditional on purpose: a skipped upload must still not leave a source map in
# the image.
RUN --mount=type=secret,id=posthog_cli_api_key \
    if [ -s /run/secrets/posthog_cli_api_key ]; then \
      POSTHOG_CLI_API_KEY="$(cat /run/secrets/posthog_cli_api_key)" \
      POSTHOG_CLI_PROJECT_ID=263292 \
      bunx --bun @posthog/cli@0.18.3 --host https://eu.posthog.com \
        sourcemap process --directory dist --delete-after \
        --release-version "${VITE_APP_VERSION:-dev}"; \
    else \
      echo "warning: no posthog_cli_api_key secret; stack traces from this image will stay minified"; \
    fi; \
    find dist -name '*.map' -type f -print -delete

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# SPA fallback
RUN printf 'server {\n  listen 3000;\n  root /usr/share/nginx/html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
