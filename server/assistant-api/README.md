# assistant-api

The service behind `api.kikouchou.app`. It answers the assistant's chat for a
signed-in Kikouchou account, on the project's own OpenRouter key.

```
POST https://api.kikouchou.app/v1/chat/completions
Authorization: Bearer <Supabase access token>
{"messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}]}
  -> text/event-stream, OpenRouter's stream relayed as it arrives
```

## Why the service exists

The app's cloud presets need the user's own OpenRouter account, which most
people do not have. The models that run in the browser need WebGPU and a
download of 1 to 5 GB. A visitor with neither cannot use the assistant at all.
This service lets an account use it with nothing to set up. The project pays
for each answer, so the service identifies the account and counts its requests
before anything reaches the model.

The client is the `kikouchou` engine and the `cloud-kikouchou` preset
(`src/features/assistant/kikouchou-api/client.ts`).

## What a request does

1. Read the bearer token. Compare its signature with the public keys of the
   Supabase project (ES256, `/auth/v1/.well-known/jwks.json`). Then compare its
   issuer, its audience (`authenticated`) and its expiry. An anonymous session
   is refused.
2. Read the body and bound it: 1 to 64 messages, 120,000 characters in all, a
   system message only first, the user's message last. Every other field is
   ignored.
3. Take one request from the account's allowance for the current UTC day,
   through `consume_assistant_quota` (migration `20261029120000`).
4. Send the messages to OpenRouter with the model and the token cap from the
   environment, and relay the stream.

The order is the cost order. A request without an account never reaches the
quota, and a request over the quota never reaches OpenRouter. A request is
counted before the answer, so an answer that fails upstream still counts.

The service logs a status, a duration and one word per request. It never logs
the user, the prompt or the answer.

## Routes

| Route | What it returns |
| --- | --- |
| `POST /v1/chat/completions` | The answer as a stream, or a JSON error |
| `OPTIONS /v1/chat/completions` | The CORS preflight |
| `/healthz` | `ok`, with nothing behind it |
| anything else | 404 |

## Errors

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | The body broke a bound |
| 401 | `unauthorized` | No token, or one that does not verify |
| 403 | `sign_in_required` | An anonymous session |
| 429 | `daily_limit` | The account spent today's allowance |
| 502 | `provider` | OpenRouter refused or failed |
| 503 | `unavailable` | The keys or the quota were not reachable |

## Configuration

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `SUPABASE_URL` | yes | | The project: its keys and the quota function |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | | Calls the quota function, nothing else |
| `OPENROUTER_API_KEY` | yes | | The project's key. Pays for every answer |
| `OPENROUTER_MODEL` | no | `openrouter/auto` | The model every answer is asked of |
| `DAILY_LIMIT` | no | `30` | Requests per account per UTC day |
| `MAX_TOKENS` | no | `2048` | Upper bound on one answer |
| `ALLOWED_ORIGINS` | no | the web app and the two store app origins | Comma-separated CORS origins |
| `APP_ORIGIN` | no | `https://app.kikouchou.app` | Sent to OpenRouter as `HTTP-Referer` |
| `PORT` | no | `8080` | |

The two keys arrive at run time, never as a build arg, so neither is in the
image. The service refuses to start without them.

To call it from a dev server, add the dev origin to `ALLOWED_ORIGINS`, for
example `http://localhost:5173`, and point the app at it with
`VITE_ASSISTANT_API_URL`.

## Development

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test

# The image, which is what docker-compose.yml builds.
docker build -t assistant-api .
```

The tests need no network. The token tests use a throwaway key, and fakes
replace the quota and OpenRouter.

## Deployment

`docker-compose.yml` in the repository root builds this directory and puts it
behind Traefik on `api.kikouchou.app`. Before the first deploy:

1. Add a DNS record for `api.kikouchou.app` that points at the server.
2. Apply the migration (`bunx supabase db push`), which creates the counter
   table and the quota function.
3. Set `OPENROUTER_API_KEY` in the shell or the `.env` beside the compose file.
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are the ones share-preview
   already reads. `ASSISTANT_DAILY_LIMIT` sets `DAILY_LIMIT`.
4. Run `docker compose up -d assistant-api`, then check
   `curl https://api.kikouchou.app/healthz`.

## Layout

| File | What is in it |
| --- | --- |
| `config.rs` | Environment, read once at startup |
| `auth.rs` | The token check and the cached project keys |
| `request.rs` | The body's bounds, and the body sent upstream |
| `quota.rs` | The daily limit, through the Postgres function |
| `upstream.rs` | The call to OpenRouter |
| `cors.rs` | Which origins a browser may call from |
| `app.rs` | The request, in cost order, and its tests |
| `main.rs` | Startup, axum, shutdown |
