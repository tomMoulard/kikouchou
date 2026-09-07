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
| anything else | 404, with the English generic card |

A 404 speaks the language its path named, so `/fr/<revoked token>` stays French
and carries the French card. A path that named no language — `/wp-admin`, a
stray `/de/…` — gets English, because whoever followed it is not one of the
app's French-speaking users yet.

`<lang>` is `en` or `fr`. The language is in the path because a crawler unfurls
a link from a data centre: its `Accept-Language` says nothing about the group
chat the card lands in. The person who shares the trip picks the language, and
the app puts it in the link.

## Database privileges

`service_role` bypasses Row-Level Security, which is not the same as being
granted the tables. It needs `SELECT` on `trips`, `trip_invites`,
`trip_doc_snapshots` and `trip_doc_updates`; without it every read fails with
`42501 permission denied` and every live link renders as no longer valid. The
grants are in
`supabase/migrations/20260907190000_share_preview_service_role_reads.sql`.

## Configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `SUPABASE_URL` | yes | | Project URL, e.g. `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | | Service role key. Bypasses RLS |
| `SHARE_ORIGIN` | no | `https://share.kikouchou.app` | This service, for absolute `og:` URLs |
| `APP_ORIGIN` | no | `https://app.kikouchou.app` | Where a browser is sent |
| `PORT` | no | `8080` | Listen port |
| `CACHE_SECONDS` | no | `300` | How long a preview is kept |

**The service role key bypasses Row-Level Security.** Pass it at run time only.
A build arg is readable with `docker history` by anyone who pulls the image.
Nothing in this service logs it, echoes it, or puts it in a page.

## Privacy

The card carries guest **acronyms**, never guest names. Every link scanner that
sees a share URL fetches the card, and chat apps cache what they fetch. `AJ` is
enough for somebody to recognise their own trip and not enough to be a roster.

A revoked link stops rendering within `CACHE_SECONDS`. A dead link, whatever
killed it, gets one page with the app's generic card: a stranger with a guessed
token cannot tell "revoked" from "never existed".

## Running it

```bash
# Tests. 73 of them, none of which need a database or a network.
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
