# share-preview

The service behind `share.kikouchou.app`. It answers a share link with a link
preview of that trip, then sends the visitor into the app.

```
https://share.kikouchou.app/fr/OMIMwxRIi6TF_KP6
  -> a page whose og: tags carry this trip's name, dates and occupancy card
  -> a browser is redirected to https://app.kikouchou.app/join/OMIMwxRIi6TF_KP6?lng=fr
```

## Why the service exists

A link crawler does not run JavaScript. A tag that React sets is invisible to
it, so the preview of a link must be in the HTML that a server sends. The app is
a static bundle on GitHub Pages, and it sends the same `index.html` for every
route. Every share link therefore showed the same generic card.

This service is the smallest thing that fixes that: one host, one read, one
card.

## What a request does

1. Read the token out of the path, and refuse anything that is not shaped like
   one.
2. Read `trip_invites` with the service role key. Refuse a link that is revoked,
   expired, or past its use cap.
3. Read `trips` for the name and the dates.
4. Read `trip_doc_snapshots` and `trip_doc_updates`, and rebuild the Yjs
   document. The rooms, the guests and the room assignments live only there.
5. Draw the card, rasterise it to PNG, and write the page.

Steps 2 to 5 are cached in memory for `CACHE_SECONDS`, so one pasted link is one
read.

## Routes

| Route | What it returns |
| --- | --- |
| `/<lang>/<token>` | The preview page, then a redirect into the app |
| `/<lang>/<token>/card.png` | The 1200x630 card |
| `/<token>` | A 302 to the language from `Accept-Language` |
| `/healthz` | `ok`, with no database behind it |
| `/robots.txt` | Permissive |
| `POST /push/send` | Sends one trip reminder; see [Trip reminders](#trip-reminders) |
| anything else | 404, with the English generic card |

A 404 speaks the language its path named, so `/fr/<revoked token>` stays French
and carries the French card. A path that named no language — `/wp-admin`, a
stray `/de/…` — gets English, because whoever followed it is not one of the
app's French-speaking users yet.

`<lang>` is `en` or `fr`. The language is in the path because a crawler unfurls
a link from a data centre: its `Accept-Language` says nothing about the group
chat the card lands in. The person who shares the trip picks the language, and
the app puts it in the link.

## Trip reminders

The same process sends the app's trip reminders over Web Push. Three kinds and
no more: the trip starts tomorrow, your own arrival is tomorrow, a pickup you
drive or ride in is due within the next hours. The rules live in
`src/reminders.rs` and are pure functions of a trip document and a clock.

How a reminder travels:

1. A device turns reminders on from a trip's calendar. The app stores the push
   subscription through `subscribe_trip_reminders()` (a viewer, by invite
   token) or `subscribe_member_reminders()` (a member, by trip id). The
   subscription lands in `push_subscriptions`.
2. Every `REMINDER_INTERVAL_SECONDS`, the service loads every subscription,
   rebuilds each trip's document once, and asks `reminders` what is due for
   each subscriber. For each due reminder it asks PostHog's feature flags
   whether the kind is on (`reminder-trip-start`, `reminder-own-arrival`,
   `reminder-pickup`; a flag that does not exist counts as on), records a row
   in `reminder_log`, and reports a `reminder_due` event to PostHog on the
   subscribing browser's own person.
3. In `direct` mode the service pushes at once. In `workflow` mode it waits for
   a PostHog workflow to decide — delays, conditions, cohorts, A/B tests — and
   call back `POST /push/send` with `{ "subscription_id", "kind", "subject" }`
   and `Authorization: Bearer <PUSH_WEBHOOK_SECRET>`. The send recomputes the
   reminder from the live document, so a ride deleted since the tick is
   `not_due`, and sends once whatever the retries. Replies are JSON:
   `sent`, `already_sent` and `not_due` are 200; `unknown_subscription` and
   `gone` are 404; `failed` is 502.
4. The payload is encrypted to the browser (RFC 8291) and signed with the
   VAPID key (RFC 8292). A push service answering 404 or 410 means the browser
   is gone, and the subscription is deleted. Every send is stamped in
   `reminder_log` and reported as `reminder_sent`.

The service never prints a clock time: it does not know the house's time zone.
"Tomorrow" is decided on the UTC calendar from `REMINDER_EVE_HOUR_UTC` on, and
a pickup is announced as a duration ("in about 2 h").

Generate the key pair once with `node scripts/generate-vapid-keys.mjs`. The
public half is the app's `VITE_VAPID_PUBLIC_KEY`; the private half is this
service's `VAPID_PRIVATE_KEY` and goes nowhere else.

## Database privileges

`service_role` bypasses Row-Level Security, which is not the same as being
granted the tables. It needs `SELECT` on `trips`, `trip_invites`,
`trip_doc_snapshots` and `trip_doc_updates`; without it every read fails with
`42501 permission denied` and every live link renders as no longer valid. The
grants are in
`supabase/migrations/20260907190000_share_preview_service_role_reads.sql`.

For reminders it also needs `SELECT, UPDATE, DELETE` on `push_subscriptions`
and `SELECT, INSERT, UPDATE` on `reminder_log`, granted in
`supabase/migrations/20260910120000_trip_reminders.sql`.

## Configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `SUPABASE_URL` | yes | | Project URL, e.g. `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | | Service role key. Bypasses RLS |
| `SHARE_ORIGIN` | no | `https://share.kikouchou.app` | This service, for absolute `og:` URLs |
| `APP_ORIGIN` | no | `https://app.kikouchou.app` | Where a browser is sent |
| `PORT` | no | `8080` | Listen port |
| `CACHE_SECONDS` | no | `300` | How long a preview is kept |
| `VAPID_PRIVATE_KEY` | no | | Turns reminders on. Base64url, from `scripts/generate-vapid-keys.mjs` |
| `VAPID_SUBJECT` | no | `mailto:admin@kikouchou.app` | The VAPID `sub` claim |
| `PUSH_WEBHOOK_SECRET` | no | | Opens `POST /push/send` to a caller presenting it |
| `PUSH_SEND_MODE` | no | `direct` | `direct` sends at the tick; `workflow` waits for the webhook |
| `POSTHOG_KEY` | no | | Project key, for `reminder_due`, `reminder_sent` and the flags |
| `POSTHOG_HOST` | no | `https://eu.i.posthog.com` | PostHog ingestion host or proxy |
| `REMINDER_INTERVAL_SECONDS` | no | `3600` | Seconds between two passes (at least 60) |
| `REMINDER_EVE_HOUR_UTC` | no | `17` | UTC hour from which "tomorrow" reminders go out |
| `REMINDER_PICKUP_WINDOW_MINUTES` | no | `180` | How far ahead a pickup is announced |

**The service role key bypasses Row-Level Security.** Pass it at run time only.
A build arg is readable with `docker history` by anyone who pulls the image.
Nothing in this service logs it, echoes it, or puts it in a page. The same goes
for `VAPID_PRIVATE_KEY` and `PUSH_WEBHOOK_SECRET`.

## Privacy

The card carries guest **acronyms**, never guest names. Every link scanner that
sees a share URL fetches the card, and chat apps cache what they fetch. `AJ` is
enough for somebody to recognise their own trip and not enough to be a roster.

A revoked link stops rendering within `CACHE_SECONDS`. A dead link, whatever
killed it, gets one page with the app's generic card: a stranger with a guessed
token cannot tell "revoked" from "never existed".

## Running it

```bash
# Tests. None of them need a database or a network.
cargo test

# Locally, against a real project.
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<key> \
SHARE_ORIGIN=http://localhost:8080 \
cargo run

# The image, which is what docker-compose.yml builds.
docker build -t share-preview .
```

To look at the card after changing a coordinate:

```bash
CARD_OUT=/tmp/card.png cargo test render_sample_card -- --ignored
```

## Deployment

`docker-compose.yml` in the repository root builds this directory and puts it
behind Traefik on `share.kikouchou.app`. It needs `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in the shell or in a `.env` beside that file, and it
refuses to start without them.

## Layout

| File | What is in it |
| --- | --- |
| `config.rs` | Environment, read once at startup |
| `trip_source.rs` | The four PostgREST reads, and the invite checks |
| `trip_preview.rs` | The Yjs document reduced to acronyms, colours and stays |
| `card_svg.rs` | The card, as a dynamic `public/og-card.svg` |
| `card_image.rs` | SVG to PNG |
| `page.rs` | The HTML, its `og:` tags and its redirect |
| `router.rs` | The routes, as one pure function |
| `cache.rs` | The TTL cache |
| `main.rs` | Startup, axum, logging, shutdown |
