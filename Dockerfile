FROM node:24-alpine AS build
WORKDIR /app
# The repo is a bun project (bun.lock); npm is used here only because the image
# ships it. bun.lock is copied so the intended versions are at least visible in
# the layer — npm resolves from package.json, so this build is not lockfile-exact.
COPY package.json bun.lock ./
RUN npm install

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
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_PUBLISHABLE_KEY=""
ARG VITE_POSTHOG_KEY=""
ARG VITE_POSTHOG_HOST=""
ARG VITE_APP_VERSION=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY \
    VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST \
    VITE_APP_VERSION=$VITE_APP_VERSION

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# SPA fallback
RUN printf 'server {\n  listen 3000;\n  root /usr/share/nginx/html;\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
