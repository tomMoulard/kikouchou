# Server-Backed Trip Sync (Tricount-style)

## Objective

Replace the current peer-to-peer trip sharing with a backend-mediated model:

1. First launch creates a trip with **no account and no network**.
2. Sharing prompts the user to register (OAuth), then yields a share link (QR / instant messaging).
3. The invitee opens the link, registers, and picks **which participant they are**.
4. Edits from either side land in a server-side log and are pushed live to the other's sessions.
5. **The app remains fully usable offline**, and sync resumes automatically on reconnect.

## Non-goals for this migration

- Real-time cursor-level collaboration (field-level convergence is enough).
- Roles/permissions beyond owner vs member.
- Multi-trip organisations, billing, or moderation.
- Retiring the QR changeset codec (kept as an offline fallback; retirement is Phase 8, optional).

---

## 1. Where we are today

The repo already contains **two** independent sharing mechanisms.

| | Mechanism | Code | Transport | Requires |
|---|---|---|---|---|
| A | QR/URL changeset | `src/lib/sharing/`, `proto/changeset.proto`, `TripSyncPage` | Protobuf blob in a QR code | Humans taking turns |
| B | Live P2P CRDT | `src/lib/yjs/`, `relay/server.js` | `y-webrtc` + signaling relay | Both peers online, NAT-traversable |

**Mechanism A** is the "synchronous" pain described: export → other side edits → export back → merge. `merge-engine.ts` even has a conflict-resolution UI, because turn-taking is baked into the model.

**Mechanism B** is closer to the goal but has three hard limits:
- `relay/server.js` is ephemeral and in-memory (`Rooms are ephemeral, in-memory only`). It only introduces peers; it stores nothing.
- WebRTC with no TURN server means it works on the same LAN and often nowhere else.
- If the other peer is offline, there is no one to sync with — edits sit in `yjsUpdates` until both are online at the same moment.

### What is already right and must be kept

- **Dexie is the read model.** `useLiveQuery` throughout the app, `DB_VERSION = 6`. Untouched by this plan.
- **Yjs is already the merge engine.** `yjsUpdates` persists binary updates; the doc rebuilds after reload with no server. This is exactly the primitive that makes offline-first sync possible — the migration keeps it and swaps only the *transport and persistence*.
- **Identity selection already exists.** `/share/:shareId/identity` (`IdentityStepPage`) plus `guest-identity.ts` (`localStorage` `kikouchou_guest_<shareId>` → `{personId, tripId}`). The new flow reuses this UI and makes the claim server-authoritative.
- **The untrusted-input invariants in `AGENTS.md`** (never use a remote id as a write key, never adopt a remote unique-index value, never read `window.location` in `lib/`, bound every remote field). These were learned from real bugs and apply verbatim to a server peer.

### The blocking defect: the CRDT model corrupts data on concurrent edits

`src/lib/yjs/dexie-bridge.ts:462` — `syncDexieToDoc` replaces the whole collection on every change:

```ts
Y.transact(doc, () => {
  array.delete(0, array.length);
  for (const item of nextItems) array.push([item]);
}, ORIGIN_DEXIE_SYNC);
```

Two clients doing this concurrently produce a Y.Array where **both** deletions and **both** insertion sets apply. Verified against the installed `yjs`, starting from two devices that agree on two guests:

- A adds Carol. B renames Bob. They reconnect.
- The merged array holds **5 entries** for 3 guests: `p1=Alice p2=Bobby p1=Alice p2=Bob p3=Carol`.

**Correction to the first draft of this plan.** That duplication never reaches a screen. `syncDocToDexie` writes through `bulkPut`, which is keyed on `id` and collapses the copies, so the user-visible symptoms are quieter — and worse — than duplicated rows:

| Symptom | Determinism | Why |
|---|---|---|
| A concurrent edit is silently lost | ~1 run in 3 | Whichever stale copy of an id lands last wins, and Yjs orders by clientID, which is random per document |
| A deletion is undone | Every run | The other peer's re-push still carries the removed row, so it returns |

Measured over 6 runs against the unfixed bridge: 1 or 2 of the 4 repro cases fail each time, never zero. The deletion case is the deterministic gate.

The docs *converge* (both sides are byte-identical), so no error is ever raised and Yjs is behaving exactly as specified — the model is wrong, not the library. Today this is masked because mechanism A is turn-taking and mechanism B needs both peers online on the same LAN, which keeps the concurrency window tiny.

**Putting a server in the middle removes that mask.** Async, offline, multi-device editing is the entire point of the new system, so this must be fixed *before* the backend lands, or every concurrent edit duplicates entities.

Secondary consequence: a one-character rename emits an update proportional to the whole collection, which becomes write amplification against a server log.

#### The fix — landed

Model each collection as a **root** `Y.Map<entityId, Y.Map<field, value>>` instead of `Y.Array<record>`. Verified with the same scenario:

- 3 guests, correct.
- Both concurrent edits survive: B's rename (`Bobby`) **and** A's recolor (`#abc`) on the same entity.
- A single rename is **33 bytes** on the wire.

Field-level last-writer-wins is the right semantic for this app: two people editing different fields of one guest both win; two people editing the same field resolve deterministically.

Two implementation constraints were measured rather than assumed, and both changed the design:

1. **The collection roots must be new keys.** A root key already holding a `Y.Array` throws if re-read as a `Y.Map` — *"Type with the name guests has already been defined with a different constructor"*. The maps use `…ById` names, and the v1 arrays stay in place for un-upgraded peers to read.
2. **The roots must be flat, never nested.** A nested intermediate map (`entities.set('guests', new Y.Map())`) gets created concurrently by both peers, and one creation replaces the other **along with its children** — a measured silent row loss. Root types are implicit and have no such race.

A third point is a documented limitation rather than a constraint: object and array *values* (`coordinates`, `participantIds`) still merge atomically, so two guests joining one activity while both offline keep only one join. Fixing it needs a `Y.Array` per activity and is out of scope.

`syncDocToDexie` also gains a **schema-version guard**: a v1 peer's `…ById` maps read as legitimately empty, and projecting that would delete every row of an intact trip. The v2 stamp is written only once there is v2 content behind it — stamping unconditionally let a *fresh, empty* document self-certify, reopening the same hole from the other side.

---

## 2. Target architecture

```
┌─ Device A ───────────────────┐        ┌─ Supabase ────────────────┐        ┌─ Device B ───────────────────┐
│  React + Dexie (read model)  │        │                           │        │  React + Dexie (read model)  │
│            ▲                 │        │  auth.users   (OAuth)     │        │            ▲                 │
│            │ project         │        │  trips                    │        │            │ project         │
│      ┌─────┴──────┐          │        │  trip_members             │        │      ┌─────┴──────┐          │
│      │   Y.Doc    │          │        │  trip_invites             │        │      │   Y.Doc    │          │
│      └─────┬──────┘          │        │  trip_doc_updates  ◄──────┼── log ─┼──────┤            │          │
│            │                 │        │  trip_doc_snapshots       │        │      └─────┬──────┘          │
│  yjsUpdates│ yjsOutbox       │◄─ RLS ─┤                           │        │            │                 │
│  (IndexedDB, durable)        │        │  Realtime  ───────────────┼─ push ─┼──────►     │                 │
└──────────────────────────────┘        └───────────────────────────┘        └──────────────────────────────┘
         works with zero network                  always online                    works with zero network
```

The server is **an always-online peer that persists the log**. That single change removes all three P2P limits at once:

| Limit today | Why it disappears |
|---|---|
| Both peers must be online | The server holds the doc; a peer syncs against it whenever it likes |
| Same LAN / NAT traversal | Plain HTTPS + WebSocket, no WebRTC |
| Manual sync-and-sync-back | Every local edit is appended to the log and fanned out automatically |

Offline behaviour is inherent rather than bolted on: local edits go to `yjsUpdates` (durability) and `yjsOutbox` (delivery). On reconnect the outbox flushes and the client pulls everything after its cursor. Yjs updates are commutative and idempotent, so a double-send or an out-of-order arrival is harmless.

---

## 3. Backend selection

### Requirement

0 → 100 users, as free as possible, offline-first client, live push, OAuth.

### Options considered

| Stack | Auth | DB | Live push | Server to operate | Free at 100 users |
|---|---|---|---|---|---|
| **Supabase** | Auth (Google/Apple/magic link) | Postgres + RLS | Realtime | **none** | Yes, with huge headroom |
| Firebase | Auth | Firestore | Native listeners | none | Yes, but two offline layers fight each other |
| Cloudflare Workers + Durable Objects | Bring your own (Clerk/better-auth) | DO storage / D1 | DO WebSockets | none | Verify current free-tier DO limits |
| Y-Sweet / Liveblocks | Bring your own | Managed Yjs | Built-in | none | Free tiers are MAU-capped, purpose-built for Yjs |
| Self-host on the existing VPS | Bring your own | Postgres | `y-websocket` | **yes, stateful** | Marginal cost already paid |
| Clerk + Neon/Turso | Clerk (10k MAU) | Postgres/SQLite | none — write your own WS | yes | Two vendors, most code |

### Recommendation: Supabase for both auth and DB

- **One vendor, one JWT.** Row-Level Security ties authorisation directly to the rows, so there is **no API server to write or operate** — the client talks to Postgres over PostgREST and Realtime.
- **Realtime replaces the relay entirely.** `relay/server.js`, its Dockerfile, its GitHub workflow and its docker-compose service all get deleted.
- **Auth covers the requested UX**: unlimited social providers on the free tier, plus magic-link email as a no-provider-setup fallback.
- **Postgres is a natural Yjs log** — an append-only table plus a snapshot row, with server-side compaction on a cron.

Cloudflare Durable Objects is technically the most elegant Yjs home (one DO per trip = the authoritative doc with WebSocket hibernation), but it needs a separate auth vendor and more custom code. Worth revisiting only if latency becomes a real complaint.

Self-hosting on the existing `kikouchou.cyprin.eu` VPS is the cheapest in cash, since the box already runs traefik and the relay. It is not recommended: you would write your own OAuth and operate a stateful service with backups, to save nothing.

### Free-tier headroom

Sizing for 100 users ≈ 20 trips × ~8 participants, a few hundred edits per trip over its life:

| Resource | Free tier | Projected use | Utilisation |
|---|---|---|---|
| Monthly active users | 50,000 | 100 | 0.2% |
| Postgres storage | 500 MB | ~2 MB of updates + snapshots | <1% |
| Realtime messages / month | 2,000,000 | ~40,000 | 2% |
| Concurrent Realtime connections | 200 | tens | ~10% |
| Edge Function invocations | 500,000 / month | ~30 (daily compaction) | ~0% |

Free-tier limits move — verify the current numbers when you create the project. The conclusion is robust to a lot of drift: at this scale nothing is remotely close to a ceiling.

**The one real free-tier constraint** is that inactive projects are paused after ~7 days. Mitigation: a weekly GitHub Actions cron hitting a trivial endpoint. Annoying during development, irrelevant once there are users.

### Decision: OAuth providers

Start with **Google** (widest coverage, cheapest setup) plus **magic-link email** as the fallback that needs no provider registration. Add Apple later only if there is real iOS demand — it requires a paid Apple Developer account, which would break the "free" constraint.

### Decision: no anonymous session on first launch

Supabase supports `signInAnonymously()` then identity linking, which would let a device-local trip carry a server id from birth. **Do not use it here.** It requires a network call on first launch, which is exactly what must keep working offline. Stay fully local — zero Supabase traffic — until the user shares or joins. This also matches the requested wording ("as the user is not authenticated, it is offered to register").

### Decision: plaintext in Postgres, with E2E kept possible

The doc holds names, stay dates, travel times and pickup locations — mildly sensitive, not secrets. Storing it in plaintext is simpler and enables server-side compaction and any future server feature (push notifications, email digests, exports).

Note the useful property: **the server never needs to understand a Yjs update to store and fan it out.** If you later want end-to-end encryption, encrypt the update bytes client-side with a per-trip key carried in the invite URL fragment. The schema below does not change. The only cost is that compaction moves back to the client, and server-side features become impossible. Starting plaintext keeps both doors open; starting encrypted closes one.

This is the one decision worth confirming explicitly before Phase 3, because reversing it later means re-encrypting the whole log.

---

## 4. Data model

```sql
-- Accounts come from Supabase's auth.users.

create table trips (
  id          uuid primary key default gen_random_uuid(),
  local_id    text not null,              -- the client nanoid TripId; makes migration idempotent
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,              -- denormalised so the trip list renders before the doc loads
  start_date  date not null,
  end_date    date not null,
  created_at  timestamptz not null default now(),
  unique (owner_id, local_id)
);

create table trip_members (
  trip_id    uuid not null references trips(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  person_id  text,                        -- the Person id inside the doc this account claims
  role       text not null default 'member' check (role in ('owner', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (trip_id, user_id),
  unique (trip_id, person_id)             -- two accounts cannot be the same participant
);

create table trip_invites (
  token       text primary key,           -- nanoid(16); the value in the share URL
  trip_id     uuid not null references trips(id) on delete cascade,
  created_by  uuid not null references auth.users(id),
  expires_at  timestamptz,
  max_uses    int,
  uses        int not null default 0,
  revoked_at  timestamptz
);

-- The Yjs log. Append-only: no user may update or delete a row.
create table trip_doc_updates (
  id         bigserial primary key,
  trip_id    uuid not null references trips(id) on delete cascade,
  update     text not null,               -- base64 of the Yjs binary update
  author_id  uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index trip_doc_updates_trip_id_id_idx on trip_doc_updates (trip_id, id);

-- The compacted snapshot, maintained by the compaction job.
create table trip_doc_snapshots (
  trip_id    uuid primary key references trips(id) on delete cascade,
  state      text not null,               -- base64 of Y.encodeStateAsUpdate
  through_id bigint not null,             -- highest trip_doc_updates.id folded in
  updated_at timestamptz not null default now()
);
```

**Why `text`/base64 rather than `bytea`:** PostgREST and Realtime render `bytea` as hex-escaped `\x…`, which is one more encoding to get right on three paths (REST read, Realtime payload, insert). Base64 costs ~33% more bytes on a budget using under 1% of quota. Not worth the ambiguity.

### What the Supabase advisors were worth

Four rounds of findings during Phases 3–4. The pattern worth remembering: **the advisor is a good detector and an unreliable prescriber.**

| Finding | Verdict |
|---|---|
| `add_owner_as_trip_member` callable by `anon` | **Real defect.** I revoked three functions and missed this one |
| `is_trip_member` callable by `authenticated` | **False positive, and the suggested fix breaks the app.** Revoking EXECUTE makes a plain `select from trips` fail — RLS expressions are privilege-checked against the invoking role |
| `redeem_invite` / `revoke_invite` callable | **Intentional.** They *are* the API, and each authorises its own caller |
| 7× bare `auth.uid()` in policies | **Real**, and led to a bigger unflagged problem (39× on the hot read) |
| 3× unindexed foreign key | **One real** — `trip_members.user_id` backs every RLS check |
| 2× "unused index" | **Noise.** Zero-row tables have no usage statistics |
| Leaked-password protection off | **Not applicable.** No password auth exists |

So: measure every finding before acting on it, and record the triage in the migration so the next run does not re-litigate it. Acting on the `is_trip_member` finding as written would have taken the app down.

### Grants: revoke before granting

Supabase applies `alter default privileges … grant all on tables to anon, authenticated, service_role`, so a newly created table in `public` arrives with SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER already granted to both client roles. **An additive `grant select, insert` on top of that is a no-op that reads like a restriction.**

Measured on the first version of this migration: a member's `update public.trip_doc_updates …` did not raise. RLS merely matched no rows, so it silently affected none — the append-only guarantee rested entirely on the *absence* of a policy, and would have evaporated the day anyone added a permissive one. Two pgTAP cases expecting `42501` caught it by getting no exception at all.

Every table therefore does `revoke all … from anon, authenticated` first, then grants exactly what it needs. `anon` keeps nothing anywhere: the app's local-only mode never talks to this database. `service_role` keeps its defaults, because compaction writes snapshots and prunes the log as that role.

This applies to every table added from here on.

### Row-Level Security

```sql
-- security definer breaks the classic recursion: a policy on trip_members
-- that queries trip_members.
create or replace function is_trip_member(t uuid) returns boolean
  language sql security definer stable set search_path = public as $$
    select exists (
      select 1 from trip_members where trip_id = t and user_id = auth.uid()
    );
  $$;
```

| Table | select | insert | update / delete |
|---|---|---|---|
| `trips` | `is_trip_member(id)` | `owner_id = auth.uid()` | owner only |
| `trip_members` | `is_trip_member(trip_id)` | via `redeem_invite` only | own row (to leave); owner may remove |
| `trip_invites` | members | members, as self | never — RPCs only |
| `trip_doc_updates` | `is_trip_member(trip_id)` | `is_trip_member(trip_id) and author_id = auth.uid()` | **nobody** |
| `trip_doc_snapshots` | `is_trip_member(trip_id)` | service role only | service role only |

**Deviation from the first draft:** invites are readable by members, not by nobody. The share dialog has to be able to re-display a link the user already made rather than minting a new one every time it opens, and a member is already inside the trust boundary. The property that matters — a *stranger* cannot enumerate tokens — is unaffected.

Two consequences worth stating:

- **Invite tokens are usable without being readable by a stranger.** Redemption goes through a `security definer` RPC:
  `redeem_invite(token text) returns uuid` — validates expiry/uses/revocation, inserts the `trip_members` row, increments `uses`, returns the trip id. A token that leaks cannot be enumerated, and it can be revoked.
- **The log is append-only for users**, so compaction needs the service role — hence an Edge Function on a schedule rather than a client doing it.

Compare with today's authorisation, which is "whoever holds `p2pRoomId` + `p2pEncryptionKey` from a URL fragment, forever, unrevocably".

### Realtime

Add `trip_doc_updates` to the `supabase_realtime` publication and subscribe per trip with `filter: trip_id=eq.<uuid>`. Postgres Changes honours RLS, so a client only receives rows it may select.

Latency is DB write → WAL → Realtime → client, roughly 100–500 ms. For "who sleeps in which room" that is invisible. If it ever matters, add a Broadcast channel for the hot path and keep the table as the durable log — but Broadcast authorisation needs RLS policies on `realtime.messages`, so don't take that on in the first pass.

### Client-side (Dexie v7)

| Change | Purpose |
|---|---|
| `trips`: add indexed `remoteTripId` | Links a local trip to its server row; makes migration idempotent |
| new `yjsOutbox: '++id, tripId'` | Durable queue of local updates not yet accepted by the server |
| new `syncCursors: 'tripId'` | `lastSeenUpdateId`, `lastSnapshotThroughId` per trip |
| new `tripMembers: '[tripId+userId], tripId'` | Cached who-is-who, so member names render offline |

`p2pRoomId` / `p2pEncryptionKey` stay on `Trip` for one release so existing installs are not broken mid-migration, then get dropped in Phase 8.

Per the `AGENTS.md` invariant *"A new table joins the cascade and the test reset"*: three new tables must be added to the cascade-delete paths and to the test reset helper.

---

## 5. The offline-first contract

These are testable rules, not aspirations.

1. **First launch with no network fully works.** No Supabase call before the user shares or joins. Creating a trip, rooms, guests, assignments and transports is local-only.
2. **Rendering never waits on auth.** `AuthProvider` resolves to `{session: null}` immediately when offline; it must not gate the router. A session is read from `localStorage` (Supabase persists it) and used optimistically.
3. **Every mutation path is local-first.** A repository write goes to Dexie and the Y.Doc, never to the network synchronously. The network is a background flush.
4. **The outbox is durable and idempotent.** A local update is written to `yjsOutbox` in the same transaction that persists it to `yjsUpdates`. The flush loop deletes a row only after the server accepts it. Yjs idempotency makes a duplicate send a no-op.
5. **Reconnect is automatic.** Trigger a flush + pull on the `online` event (`useOnlineStatus` already exists), on Realtime resubscribe, and on tab focus, with exponential backoff and jitter.
6. **Exactly three operations may require network**, all one-time and all explicit: *share a trip* (needs an account and an invite row), *join a trip* (needs invite redemption), and *sign in* — which sweeps the account (§15). Everything else works offline forever. Signing in was always going to be the third, since Phase 6 specifies the migration as running "on first share or first sign-in"; what matters is that all three are things the user asked for, and that none of them is on the launch path of a device with no account.
7. **The service worker must never cache the Supabase origin.** Add a `NetworkOnly` runtime-caching rule for `*.supabase.co`. A cached auth or data response is a correctness bug, not a performance win.
7b. **`supabase-js` must not be on the cold-launch critical path.** It is 218 kB (58 kB gzipped), and `AuthProvider` mounts eagerly, so a static import taxes every launch — including the majority that never sign in. Import it dynamically and let the client arrive a tick after mount; that is free precisely because rule 2 means nothing waits on the session. Check after any change to the auth graph: the chunk must be absent from `index.html` and from its `modulepreload` list.
8. **Sync state is visible.** The user must be able to tell *Local only* / *Syncing* / *Synced* / *N changes pending* apart. `P2PSyncPresence` becomes a real sync badge instead of a peer counter.

Rule 7 deserves attention: the current `runtimeCaching` covers OSM tiles (`CacheFirst`) and Nominatim (`NetworkFirst`). Adding Supabase without an explicit rule risks it falling under the precache/navigation fallback.

---

## 6. Implementation phases

Ordering matters: Phase 1 is a prerequisite, not a nice-to-have. Landing the backend on top of the current whole-collection-replace model would productise the duplication bug.

### Phase 0 — Decisions and spikes · **DONE**

- Confirm Supabase; confirm plaintext vs E2E (§3); create the project.
- **Google only, decided.** Email signup is off in `config.toml` (`[auth.email] enable_signup = false`) so there is exactly one authentication path rather than a second one nobody tested. Magic link is deferred, not rejected: turning it on means flipping that flag and configuring `[auth.email.smtp]`.
- **Magic link will need custom SMTP when it lands.** `config.toml` confirms the built-in sender's cap at `[auth.rate_limit] email_sent = 2` per hour, and it is explicitly test-only, so magic link is unusable without Resend (or similar) plus a domain verified for the sender address.
- **Auth needs no callback route.** Set `redirectTo` to the app root (`https://tommoulard.github.io/kikouchou/`) and let `detectSessionInUrl` pick the PKCE `?code=` off the root URL. `index.html` is served normally there, so the GitHub Pages deep-link problem never applies to sign-in. Drop the `/auth/callback` route from Phase 2.
- **`public/404.html` is still required**, because `/join/:token` share links are deep links by nature — the entire point of the feature. GitHub Pages serves `404.html` for unknown paths (with a 404 status the browser still renders), preserving path and query, so the SPA router resolves correctly. Ship it as a copy of `index.html`.

### Phase 1 — Fix the CRDT model · **DONE**

- Rewrite the collections in `dexie-bridge.ts` from `Y.Array<record>` to `Y.Map<id, Y.Map<field, value>>`: `populateDocFromDexie`, `syncDexieToDoc`, `syncDocToDexie`, `readCollection`.
- Replace whole-collection replace with per-entity upsert + per-id delete. `sortCollection` moves to the read side (projection), where `(order, id)` tie-breaking already lives.
- Stamp a doc schema version in `meta`. New trips are born v2; old docs convert at migration-upload time (Phase 6) rather than in place.
- **Tests (highest value per line in this plan):** two-`Y.Doc` convergence tests with no server or network — concurrent add vs rename, concurrent edits to different fields of one entity, concurrent delete vs edit, offline divergence then merge. The scenario that currently yields 5 guests from 3 becomes a regression test.
- Keep Dexie-first writes with a per-entity mirror. Making the doc the sole source of truth and Dexie a pure projection is the cleaner end state, but it is a large refactor of every repository and context; defer it. Watch for echo loops in the meantime — `ORIGIN_DEXIE_SYNC` already guards the round trip.

### Phase 2 — Auth · **DONE**

- `src/lib/supabase/client.ts` — singleton, `persistSession: true`, no top-level throw when env vars are absent (local dev and offline must still boot).
- `src/features/auth/` — `AuthProvider` (never blocks render, per rule 2), `SignInSheet`, `AuthCallbackPage`, `useAuth`.
- Route `/auth/callback`; `.env.example`; wire `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` into `deploy.yml`.
- i18n keys in **both** `en` and `fr` (per the `AGENTS.md` invariant that a missing key still renders).
- Account section in `SettingsPage`: signed-in identity, sign out.

### Phase 3 — Schema, RLS and invites · **DONE**

- `supabase/migrations/` — tables, indexes, `is_trip_member`, policies, `redeem_invite`, Realtime publication, daily compaction cron.
- RLS tests: a non-member can read nothing; a member cannot update or delete a log row; an invite row is invisible to everyone; a revoked or expired token fails to redeem; the `(trip_id, person_id)` unique constraint rejects a double claim.

### Phase 4 — The sync provider · **DONE**

- `src/lib/sync/SupabaseYjsProvider.ts`, surface-compatible with `WebrtcProvider` (`connected`, `synced`, `awareness`, `destroy()`) so `useYjsSync` changes minimally:
  - **start** — apply the local doc, fetch snapshot + rows after the cursor, apply, subscribe to Realtime, flush the outbox.
  - **local update** — enqueue in `yjsOutbox`, insert, delete on acceptance, advance cursor.
  - **remote row** — `Y.applyUpdate(doc, decode(row.update), ORIGIN_REMOTE)`, advance cursor.
  - **reconnect** — pull `id > lastSeenUpdateId`, flush, with backoff + jitter.
- `outbox.ts`, `cursors.ts`; presence via Realtime Presence replacing y-webrtc awareness.
- Apply the `AGENTS.md` untrusted-input invariants to the server peer exactly as to a WebRTC peer: resolve the trip locally via `remoteTripId`, reject a doc whose `meta.id` disagrees, never adopt a remote `shareId`, bound every field, drop bad records individually.
- Keep the `y-webrtc` path behind a flag for one release.

### Phase 5 — Share and join UX · **DONE**

- `ShareDialog`: if signed out → `SignInSheet` → ensure the remote trip exists → create an invite → QR + copy link + Web Share API.
- New `/join/:token` → `JoinTripPage`: require sign-in → `redeem_invite` → hydrate the doc → hand off to the existing identity wizard.
- `IdentityStepPage` writes `trip_members.person_id` (server-authoritative) in addition to the existing `localStorage` identity; handle the unique-violation case ("Alice is already taken") and offer *I'm not in the list → add me*, which creates a Person in the doc and claims it.
- Invite management in `SettingsPage`: list, revoke, regenerate.
- Repoint or retire `/trip/:roomId#key` and `extractP2pTripInviteFromScannedPayload`.

### Phase 6 — Migration and the remote trip list · **DONE**

- Dexie v7 (§4), plus cascade paths and the test reset helper.
- `src/lib/sync/migrate-local-trip.ts` — idempotent per trip, keyed on `(owner_id, local_id)`: insert the `trips` row, convert the doc to schema v2, upload the snapshot, insert the owner `trip_members` row, store `remoteTripId`. Run lazily on first share or first sign-in, never as a big-bang.
- `TripListPage`: merge local trips with the signed-in user's server trips; hydrate a doc on first open. Show which trips are local-only.

### Phase 7 — Offline hardening · **DONE**

- Service worker rule 7; verify `navigateFallback`.
- Sync badge (rule 8) replacing the peer counter, with pending-change count.
- Reconnect triggers: `online`, tab focus, Realtime resubscribe.
- Playwright E2E with `context.setOffline(true)`: edit offline → reconnect → converge; two browser contexts editing the same trip concurrently → converge without duplicates; cold launch offline.
- Update the assistant per the `AGENTS.md` checklist if account or sync state becomes user-visible data it should be able to answer about.

### Phase 8 — Compaction and retiring the old path · **DONE**

**Compaction is done.** Two things it turned up:

- **Pruning creates a data-loss hazard the provider had to be fixed for.** Compaction deletes the rows it folds, and the provider only fetched the snapshot when its cursor was 0. A device at cursor 50 when rows 1–100 were folded and pruned would ask for `id > 50`, get 101 onwards, and lose 51–100 permanently — they exist nowhere but the snapshot it never fetched. Silent, and worst for the devices offline longest. The provider now applies any snapshot whose `through_id` is ahead of its cursor, reading the marker alone first because the state can be megabytes.
- **The schedule cannot carry the service key.** It reads it from Supabase Vault by name; creating those secrets is a one-time manual step, documented in the migration. Verified: the job is scheduled and active, no-ops with a notice when the vault entries are absent, and `authenticated` cannot execute it.

**Retirement is done**, at the user's explicit instruction, with the hold above overridden. The risk stands as stated: there is no fallback now, and no two-device sync has yet succeeded against the hosted project.

The structural part was not the deletion but the **keying**. Local persistence was keyed on the WebRTC room id, so IndexedDB could not be read without first resolving a credential that existed only because of the transport. Dexie 8 re-keys `yjsUpdates` on `tripId` and migrates existing rows by resolving each room id back to its trip.

That let the trust boundary get simpler without weakening: `syncDocToDexie` now takes the trip id the caller already holds from local state instead of finding it via `p2pRoomId`, and `meta.id` stays a claim to verify. It gained an assertion too — a peer must not be able to set `remoteTripId`, which would redirect a trip's whole sync to a row of the attacker's choosing.

Two behaviours were **removed rather than ported**, because the server made them meaningless: the "keep the shared trip online while its dialog is open" binding (WebRTC needed both peers present simultaneously) and WebRTC awareness with its presence badge (the sync badge answers "is anyone else here" now). Realtime Presence could reinstate a live peer list later; that is new work, not a port.

`vendor-yjs` dropped from 192 kB to 78.75 kB.

**Still not done, and it is the only thing left:** one successful sync between two real devices against the hosted project.
- Delete `relay/`, `.github/workflows/relay-docker.yml`, the `relay` service in `docker-compose.yml`, `y-webrtc`, `VITE_SIGNALING_URL`, `resolveSignalingServer`, `y-webrtc.d.ts`, and the `p2p*` fields on `Trip`.
- Decide the QR changeset codec's fate. Recommendation: keep **export** (backup, and handoff to someone who will not register), retire the merge-back UI and `merge-engine.ts` once server sync has run for a while. That removes a conflict-resolution UI that server sync makes unnecessary.

**Total: roughly 3–4 weeks of part-time work**, with Phase 4 the largest single piece and Phase 1 the one that must not be skipped.

---

## 7. Risks and open decisions

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Concurrent-edit duplication (§1) | **Critical** — silent corruption | Phase 1 before any backend work; convergence tests as the gate |
| 2 | Plaintext trip data on a third-party server | Accepted | Decided in Phase 3; the schema supports E2E later with no change |
| 3 | Free project paused after ~7 days idle | Low | Weekly GitHub Actions ping |
| 4 | GitHub Pages 404s deep links | Medium — blocks `/join/:token`, not sign-in | `public/404.html` copy of `index.html`; auth avoids it by redirecting to the app root |
| 5 | Two accounts claim the same participant | Low | `unique (trip_id, person_id)` + a clear "already taken" path |
| 6 | Log growth between compactions | Low at this scale | Snapshot + `through_id`; daily cron; monitor row counts |
| 7 | RLS recursion on `trip_members` | Low | `security definer is_trip_member` |
| 8 | Vendor lock-in | Low | Postgres is portable; the provider is ~300 lines behind an interface |
| 9 | Realtime latency (100–500 ms) | Low for this app | Add a Broadcast hot path only if users complain |

### Decisions needed before Phase 3

1. ~~**Plaintext or E2E?**~~ **Settled: plaintext.** The schema does not change if the update bytes are encrypted later — only compaction moves back to the client — so the door stays open.
2. ~~**Google only, or Google + Apple?**~~ **Settled: Google only.** Apple needs a paid developer account; magic link needs custom SMTP and a verified sender domain. Both deferred.
3. **Doc-authoritative or keep the Dexie mirror?** Plan assumes the mirror, with doc-authoritative as later cleanup.
4. **Does the QR changeset flow survive?** Plan assumes export-only survives, in Phase 8.

---

## 8. Verification

Reproductions backing §1, run against the installed `yjs`:

- **Current model** — two docs agreeing on `[Alice, Bob]`; A adds Carol while B renames Bob; after merge both docs hold 5 guests (`Alice, Bobby, Alice, Bob, Carol`). Converged and wrong.
- **Proposed model** — same scenario plus a concurrent recolor of the same entity; after merge both docs hold 3 guests, and Bob carries B's name *and* A's color. A single rename is 33 bytes on the wire.

These become the first two tests of Phase 1.

---

## 9. Review round: what a close read of the finished code found

Written after the implementation was complete and the unit suite was green, so
every item below is something 3,000 passing tests did not catch. The pattern is
the same one that produced the bugs users actually hit during this work: each
lived in how two pieces fit together, not inside either piece.

### Data loss

| Finding | Why the tests missed it |
|---|---|
| **The schema 8 migration destroyed every trip's CRDT history.** `Collection.modify` hands its mutator a clone and stores the result, and that round trip loses the `Uint8Array` prototype — the bytes come back as `{0:1, 1:2, …}`. Rows all present, `Y.applyUpdate` unable to read one of them. | The migration had no test at all. It was also untestable by construction: `KikouchouDatabase` hardcoded `super('kikouchou')`, so a v7 fixture under any other name was invisible to the class performing the upgrade. |
| **The provider recorded server state the server did not hold.** A flush sent the queue, found it empty, and recorded the *document's* state vector. An edit made while that flush was in flight, whose queue row never landed, sat inside that vector — so reconciliation computed an empty diff from then on and the edit never left the device. | The existing lost-queue-row test has the push *fail*, so no vector is recorded and the backstop works. Nothing covered a lost row alongside a *successful* push. |
| **An unreadable snapshot was assumed harmless** on the grounds that "the log alone reconstructs the document". True only while the log is intact — and compaction upserts the snapshot then deletes exactly the rows it folded. Past that point the provider reported `synced` over a permanent hole. | The one test that existed kept the log intact, so it asserted the recoverable half of the branch and looked like coverage of both. |
| **An identity claim reported success when it wrote nothing.** `claimParticipant` treated a missing error as a claim, but an UPDATE matching no row succeeds with zero rows and no error — the normal outcome when the roster row is not visible to the account. The page then navigated in, `person_id` stayed null, and an unclaimed participant still looks free, so the next joiner could claim the same name. | Every test asserted the error branch. The double terminated at `eq()`, so it could not express a zero-row update even in principle. |

### Stuck states

| Finding | Why the tests missed it |
|---|---|
| **The share dialog restarted itself into a permanent spinner** (user-reported as "stuck in syncing"). Its effect was keyed on the whole `trip` object, which arrives from a Dexie live query — and the sync provider writes to `trips` on every projection. The effect opens by setting `loading`, so each write dropped the dialog back to a spinner and repeated the server work. | No hook test existed. When one was written, passing a fresh object per render — what a live query does — looped until the Vitest worker died of heap exhaustion. |
| **A build with no backend showed the same spinner forever.** `useTripShareLink` still returned `kind: 'legacy'`, meaning "offer the peer-to-peer link", after that transport and its route were deleted. Nothing consumed the state, so it fell through to the loading branch. | Retirement removed the producer's *reason* without removing the state, and the dialog's tests never rendered that state. |
| `useJoinTrip` keyed on the `session` object, which Supabase replaces on every token refresh — including one shortly after sign-in, exactly when someone is on the join page. Harmless server-side (`redeem_invite` is idempotent for a member) but it flashed 'joining' over a finished join. | Same class as the above; the flicker is invisible to a test that awaits a settled state. |

### Smaller

- A multi-page pull kept applying pages after `destroy()`, into a document about to be detached.
- `failures = 0` on a successful pull held a persistently failing push at the first backoff step for as long as reads kept succeeding.
- Five signaling strings survived the WebRTC retirement in both locale files with zero code references.

### Two rules worth keeping

1. **A missing error is not a success.** Postgres reports no error for an UPDATE
   that matches nothing, and PostgREST passes that through. Confirm a write
   against the row it returns — remembering that `RETURNING` is subject to the
   SELECT policy, which is what bit the `trips` insert earlier in this work.
2. **Never key an effect on an object from a live query.** Identity changes for
   reasons unrelated to the effect's subject, and any effect that opens by
   setting a loading state turns that into a permanent one.

---

## 10. Test strategy, settled

Three layers, each testing what only it can:

| Layer | Count | Owns |
|---|---|---|
| Unit (Vitest) | 3,029 | Logic, the CRDT model, the provider's state machine against a fake log |
| pgTAP | 69 | RLS and the server functions, against a real Postgres |
| Playwright | 6 offline + 12 sharing | The journeys, in a real browser |

The browser layer exists because every bug that reached a user during this work
was integration-shaped: boot ordering, an RLS-and-`RETURNING` interaction, a
stale effect dependency. None were visible to the unit suite; all were visible
the moment a browser drove the real flow.

`e2e/support/supabase-stub.ts` implements the REST surface in the Node process
and is installed with `page.route`. Two contexts against one stub are two devices
on one server. It deliberately does **not** enforce RLS — a passing
re-implementation would prove nothing about the policies that ship, which is
pgTAP's job — and it refuses the Realtime socket, so the tests exercise the pull
path that has to work when the socket is down anyway.

One safety note found while wiring it: Vite loads `.env.local`, so the existing
Playwright dev server was configured with the developer's **production** project,
and any test that reached a share would have written to it. Process env vars beat
`.env.local` (verified against Vite's own `loadEnv`), so the projects now set
those keys explicitly — blank for the local-only projects, the stub host for the
sharing one.

---

## 11. What the browser tests found that nothing else could

The E2E suite was written to cover the journey. It paid for itself before it was
even green: two of its "flakes" were real defects, and both were invisible to
3,032 unit tests because both live in the gap between devices.

### `meta.id` made joined trips a coin flip — **critical**

`syncDocToDexie` refused any document whose `meta.id` did not equal the local
trip id. Local trip ids are per-device nanoids, so an invitee's
`materialiseJoinedTrip` mints a new one and a document authored by the owner
carries an id that can *never* equal it.

Worse than a clean refusal: both devices wrote `meta.id` while populating the
document from Dexie, so two different ids contended over one key by
last-writer-wins — and that contention was pushed to the server as a real edit.
Whichever device lost silently stopped projecting. An invitee could sit in front
of an empty trip indefinitely, or watch it work and then stop.

The security property the comparison appeared to give is given by the write key,
which was already the locally-resolved trip: nothing in the payload is an
address. The incidental constraint it also gave — that a document cannot conjure
a trip row under an arbitrary id — is now explicit and device-independent:
projection updates a trip that already exists and never creates one. `meta.id`
is neither written nor read.

### A cold join could outrun the first upload — **high**

An invitee's provider starts, pulls, and finds nothing because the owner's first
upload has not landed. Nothing asked again: the backoff schedule covers
*failures*, and a pull that correctly returns zero rows is not one. The invitee
sat on "Getting the trip…" until the page was reloaded.

Realtime would ordinarily cover this, which is exactly why it must not be the
only thing that does — a blocked WebSocket is ordinary on hotel, café and
corporate networks, which is where this app gets used. Now a bounded retry
(750 ms, 1.5 s, 3 s, 6 s, 12 s) that stops at the first content, on teardown, or
when the schedule runs out; bounded because a genuinely empty trip is legitimate
and must not be polled forever.

### A note on flaky tests

Both were first seen as *which test fails moves between runs*. The temptation
was to stabilise the test. Three of the four corrections that run did need were
genuine test bugs — a locator matching "Import a **shared** trip", an assertion
listing four words the copy does not use, a gate on row count where the first row
up is the trip's own metadata, and contexts closed only on the happy path so a
failure cascaded — but the residue was the product. Worth remembering next time
the instinct says "add a wait".

### Test-suite state, measured

| Suite | Result |
|---|---|
| Unit (Vitest) | 3,032 passed |
| `sync` project (13 browser tests) | 13 passed, three consecutive full runs |
| `sharing.spec.ts` (5, local-only) | 5 passed, after repairing drift |
| `chromium` project (110) | 42 passed, 66 failed — **pre-existing** |

The 66 are the same class of copy drift as `sharing.spec.ts` had: assertions
written against wording and flows the app has since changed. Confirmed
pre-existing by running one against a server that *does* have a backend
configured and watching it fail identically, so blanking `VITE_SUPABASE_*` for
those projects is not the cause. They deserve their own pass, and until they get
one this project's signal is close to worthless — which is presumably how the
sharing tests came to be unfalsifiable in the first place.

---

## 12. Compaction moved to the clients

The Edge Function reconstructed each trip's document by downloading and applying
every log row, purely to compute a value a connected client already holds:
`Y.encodeStateAsUpdate(doc)` is free in the browser and costs a full replay on
the server. The deployment, the service key in Vault, pg_cron and pg_net all
existed only to put a Yjs runtime somewhere it could do that replay — and two of
this project's production incidents came from that scaffolding rather than from
the work it was scaffolding (a Vault secret created with the wrong value, and
`extensions.http_post` instead of `net.http_post`).

Compaction also wants to happen when a trip is being used, which is exactly when
a client is connected. A schedule sweeping every busy trip is a worse fit than
devices doing their own as they go.

### What the clients are and are not trusted with

Clients get **no** new table privileges. `trip_doc_updates` still grants them no
DELETE and `trip_doc_snapshots` still grants them no write. Everything goes
through `public.publish_trip_snapshot(uuid, text, bigint)`, `security definer`,
which does the whole thing in one transaction in the only safe order and gives
the client no way to express anything else:

| Guard | Why |
|---|---|
| Caller is a member | The function bypasses the policies that would otherwise say no |
| `through_id` monotonic, enforced on the upsert itself | Two devices both finding no snapshot row would otherwise both write, and the one with the *older* cursor could land last and move the head below rows the other had already pruned |
| `through_id` ≤ the log's max id | A device cannot claim rows that do not exist |
| Prune only `id <= through_id - 50` | A margin of recent rows survives, so a device that publishes a snapshot its document had got wrong does not take the newest history with it |
| Snapshot written before the prune, same transaction | The one ordering that loses data outright is pruning first |

The client sends `through_id = its own cursor`, so a snapshot only ever claims
rows that device has actually applied. Nothing server-side can verify that, which
is why the margin exists.

### The principle this reverses, stated plainly

The Edge Function's own comment read: *"a member must not be able to rewrite a
trip's history by replacing its compacted head."* That is now exactly what a
member does. Accepted because:

- A member can already write any value into the document — the log takes
  arbitrary updates and the CRDT has no per-field authorization, so "delete every
  guest" is available today and propagates to every device. Publishing a thin
  snapshot is **weaker**: devices that applied the real updates keep them, and
  only a device joining later sees less.
- History was never durable. Compaction deletes the log either way; the only
  question was who triggered it.

The genuinely worse case is a buggy client rather than a malicious one, and the
retention margin is what bounds it.

### Trigger

Traffic-counted — rows applied plus rows sent, threshold 200 — rather than the
log's true length, which would need a `count(*)` round trip the client does not
otherwise make. It over-triggers for a device joining a long-established trip and
under-triggers for one that mostly watches; both are fine, because the server's
monotonic guard makes a redundant attempt a no-op and any member's device will
reach the threshold too. Published at the end of a successful pull, the one point
where the document is known to hold everything up to the cursor — which is
precisely what the snapshot claims.

### Manual steps this leaves

The migration unschedules the cron job and drops the invoker. Two things it
deliberately does not touch:

1. The deployed function itself — `bunx supabase functions delete compact-trip-docs`.
2. The Vault secrets `compaction_service_key` and `compaction_function_url`,
   which nothing reads any more. Deleting somebody's secrets from a migration is
   not a migration's business; a secret nothing reads is inert.

---

## 13. Advisor round after client-side compaction

Same pattern as the earlier four rounds, and worth recording because these two
findings will recur on every run.

### `authenticated_security_definer_function_executable` — WARN, accepted

Flags `publish_trip_snapshot`, `redeem_invite` and `revoke_invite` as
`SECURITY DEFINER` functions the `authenticated` role can call, and suggests
revoking EXECUTE, switching to `SECURITY INVOKER`, or moving them out of the API
schema.

All three prescriptions would break the app, and the reason is the same in each
case: definer rights plus a grant to `authenticated` **is** the design. Each
function exists precisely to perform one privileged write that no policy grants,
under conditions it checks itself:

| Function | Why definer | Its own check |
|---|---|---|
| `redeem_invite` | writes `trip_members`, which has no INSERT policy — joining requires a token, and that is the security property | `auth.uid()` null → `28000`, then token validity |
| `revoke_invite` | updates `trip_invites`, which has no UPDATE policy — that is what keeps `uses` tamper-proof | `private.is_trip_member` → `42501` |
| `publish_trip_snapshot` | deletes from `trip_doc_updates`, where clients deliberately hold no DELETE | `auth.uid()` null → `28000`, membership → `42501` |

`SECURITY INVOKER` would put each one back under the policy it exists to bypass.
Revoking EXECUTE would make joining, un-sharing and compaction impossible. The
finding is a correct description of the shape and a wrong inference about the
risk — exactly the `is_trip_member` round again, where following the advice
produced `permission denied for function is_trip_member` on every `select` from
`trips`.

The check that *is* worth doing each time this appears: confirm every definer
function still authorizes itself as its first act. Done, for all three.

### `unused_index` — INFO, keep both

`trip_doc_updates_author_id_idx` and `trip_invites_created_by_idx` are reported
as never used. Both were added in `20260831200000` because an **earlier advisor
round** flagged them as unindexed foreign keys, so the tool is now contradicting
its own previous advice.

Keep them. An index on a foreign key column is not there to serve queries — it is
there so the *referenced* side's cascade can find the rows. Both columns
reference `auth.users(id) on delete cascade`, and without the index deleting an
account is a sequential scan of the whole table. They read as unused because no
account has been deleted yet, which is the good case, not evidence of waste.

Separately: usage statistics from a project with almost no traffic cannot support
dropping anything. "Never used" here mostly means "never exercised".

### `auth_leaked_password_protection` — WARN, moot

Google SSO is the only provider, so there are no passwords in the system to
check against HaveIBeenPwned. Enabling it costs nothing and protects nothing
until a password provider is added — at which point it should go on.

---

## 14. The reported bugs, and what they were actually about

Four rounds of "the invitee is stuck", all reported from the running app. Worth
recording as a set, because the shape repeats and because two of the four fixes
were for real bugs that were not the reported one.

| Reported | Cause | Where it lived |
|---|---|---|
| Invitee stuck on "récupération du séjour", trip present but empty | `IdentityStep` read participants from `PersonContext`, scoped to the *currently open* trip, while being handed the joined trip's id as a prop it ignored | One line, in the component |
| Same screen, now offering people from a *different* trip | Same bug. When the open trip had people they were offered for the wrong trip; when it had none the screen said there were no participants | — |
| Sharing a trip fails with an RLS error on `trip_doc_updates` | The local `remoteTripId` pointed at a `trips` row deleted in the dashboard. Its `trip_members` row cascaded away, so the insert policy correctly refused a non-member | `ensureRemoteTrip` trusting a cached pointer |
| The shared trip blinks | Sync state republished on every quiet pull, and `publishStatus()` ran before `pulling` was cleared so each pull flipped `syncing` → `synced`. That state feeds a context wrapping the whole app | `setState` and `pull` |

Found on the way, and real, but not what was reported:

- A trip shared while a *different* trip was open never uploaded its document,
  because sync is mounted for the open trip only.
- The gate added for that then made the state unrepairable: it skipped the upload
  whenever a server state vector had been recorded, and reconciliation records
  one even when it has nothing to send.
- `syncDocToDexie` refused every remote update for a joined trip, because it
  compared the document's `meta.id` against the local trip id — per-device
  nanoids that can never match.
- A cold join could outrun the owner's first upload with nothing to ask again.

### What actually found them

One SQL row and one console dump. Reasoning from the code produced three
confident wrong answers first; the query that returned `log_rows = 12,
members = 2` eliminated the entire upload path in one step, and the console dump
showing `lastSeenUpdateId: 220` with `persons: 1` eliminated the pull path.

The inference error worth remembering: `persons: 1` across four trips was read as
"the trips are empty" when it equally meant "projection is failing". Both
readings fit; nothing was done to distinguish them, and two fixes went to the
wrong half of the problem.

### Three spinners with no terminal state

The share dialog on a retired `legacy` branch, the share dialog keyed on a
live-query object, and the identity step with no participants. Same failure mode
three times in one flow, which makes it a pattern rather than a coincidence:
**every waiting state needs a reason to stop waiting**, and a bounded one, since
the condition it waits for may never arrive.

### A note on the test doubles

Three bugs this round were invisible to the unit suite because the double was
kinder than reality: `react-leaflet` is mocked wherever `MapView` is tested, so
the Leaflet container error cannot be reached; the channel fake stored every
handler in one slot, so adding presence silently broke row delivery; and the
PostgREST fake terminated at `eq()`, so a zero-row update could not be expressed.
A fake that cannot express the failure guarantees the test suite cannot see it.

---

## 15. pgTAP, finally executed

The snapshot suite had been written but never run — the one part of the
client-side compaction work with no execution behind it. Running it found three
defects, all in the test file and none in the function:

1. `log_ids` is a temp table created while privileged and read while acting as a
   member, so it needed `grant select ... to authenticated`. Without it ten
   assertions died with `permission denied` and the file aborted after four.
2. The last assertion read the snapshot head as the *stranger*, who cannot see
   it — `trip_doc_snapshots` restricts SELECT to members — so it returned NULL
   and was asserting the policy rather than the head.
3. Deriving row ids instead of assuming they start at 1 mattered in practice: the
   first run saw ids near 226, the post-reset run saw them from 1.

**83 tests across 5 files, passing, and passing again from a freshly reset
database** — which also proves all ten migrations apply to a virgin database,
including the guarded `cron.unschedule` in the compaction migration.

Every suite now has execution behind it:

| Suite | Result |
|---|---|
| Unit (Vitest) | 3,129 across 161 files |
| pgTAP | 83 across 5 files, incl. from a clean database |
| Playwright `sync` | 15 |
| Playwright `sharing.spec.ts` | 5 |

Run pgTAP with `bunx supabase start` then `bunx supabase test db`.

---

## 15. The account sweep: signing in as the third network moment

Everything above gets a trip from one person to another. Nothing above gets a
trip from a person to *themselves* on a second device, and that is what an
account is assumed to be for: sign in on the phone and on the laptop, see the
same trips.

The gap was narrow and total. A trip reached the server only through the share
dialog, and a trip reached a device only through the *Download* button in
`RemoteTripsSection`. Both are the right shape for handing a trip to a friend.
Neither fires when there is no friend — so a signed-in user with a trip on their
phone and a signed-in laptop saw nothing on the laptop, and had no action
available that would have changed it short of sending themselves an invite link.

Phase 6 specified the fix and it was never built: *"run lazily on first share or
first sign-in, never as a big-bang"*. `lib/sync/account-sync.ts` is the sign-in
half, and `lib/sync/AccountTripSync.tsx` decides when it runs.

### What it does

Up, then down, sequentially, for the signed-in account:

- every local trip with no `remoteTripId` gets one via `ensureRemoteTrip`, then
  its document via `uploadTripDocument` — the same two calls sharing makes;
- every trip in `listRemoteTripsMissingLocally` is materialised, which is the
  same call the *Download* button makes.

Nothing new on the server, no new migration, no new RLS. The sweep is a
composition of four functions that already existed and were already tested; what
it adds is that nobody has to press anything.

### The three refusals, which are the whole design

Making this automatic changes the risk profile of code that used to run once,
attended, on one trip. Three things that were safe under those conditions are not
safe under these:

1. **It never re-creates a server row.** `ensureRemoteTrip` treats a row it
   cannot read as deleted and makes a fresh one — correct at share time, when
   the owner is watching and the alternative is a share that fails. Unattended it
   is a data fork: a device with a second account signed in cannot see the first
   account's rows, and "repairing" them would hand duplicates to the wrong owner.
   So the sweep skips any trip that already has a `remoteTripId`, and sharing
   remains the only place reconciliation happens.
2. **It never uploads a document it did not link.** A joined trip that has not
   been opened on this device holds a placeholder Dexie row — the preview, or
   `trips.untitled` — and no document. Pushing that as CRDT state would write the
   placeholder over the owner's real name for every member. Only a trip whose row
   this sweep created is uploaded, and for that trip this device is by definition
   the only source that has ever existed.
3. **It is additive.** Absent from the server means local-only; absent locally
   means fetch. Neither means delete, and signing out changes nothing on the
   device.

### Concurrency, which is new here

`materialiseJoinedTrip` was a check-then-act — look the trip up by
`remoteTripId`, add it if absent — and that was fine while a person had to click
*Download*. The sweep runs it for every trip, in every open tab, the moment a
session appears. Two tabs interleaved between the read and the write each see
nothing and each add a row: one server trip, two local copies, two documents.

The pair now runs inside one `db.transaction('rw', db.trips, …)`. IndexedDB
serialises readwrite transactions over a store across connections, so that is a
real lock between tabs rather than a tidier spelling of the same race. The
network fetch stays outside it — holding a Dexie transaction open across a round
trip would block every other writer for as long as the server takes.

Within a tab, `AccountTripSync` chains sweeps rather than flagging one as busy: a
flag drops the work it refuses, so a trip created while a sweep ran would be
skipped and never re-queued.

One knock-on for tests: Dexie's transaction zone assumes its continuation runs in
the same microtask tick, and vitest's default `useFakeTimers` fakes
`queueMicrotask`, which defers it to the fake clock. The transaction then aborts
with *"Transaction committed too early"*. Tests that only need a fake clock must
say so — `vi.useFakeTimers({ toFake: ['Date'] })`.

### What it deliberately leaves alone

- **`RemoteTripsSection` stays.** It is empty in the steady state, which is
  right, and it is the only way in for what the sweep could not do: a download
  that failed, a trip that appeared while this device was offline, a trip another
  member added between sweeps.
- **Sync is still mounted for the open trip only.** A trip that arrives on the
  laptop shows its preview name and dates and fills in when opened. Mounting a
  provider per trip is the trade Phase 4 already refused, and nothing here
  changes it.

### The trade-off worth stating out loud

A local trip on a device now belongs to whoever signs in on that device. On a
shared or borrowed computer that means one person's local trips are uploaded to
another person's account. Nothing is lost — the trips stay on the device and keep
working — but they are copied somewhere their author did not choose. The device
has no notion of a trip's author to check against, so there is no cheap guard to
add: closing it properly means either recording the account a trip was created
under, or asking at sign-in which trips to bring. Both are worth doing before
this is offered to people who share a machine.
