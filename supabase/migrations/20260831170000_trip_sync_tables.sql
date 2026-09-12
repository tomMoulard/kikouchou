-- Server-backed trip sync: tables.
--
-- The document itself is an append-only log of Yjs updates plus a compacted
-- snapshot. The server never needs to understand an update to store it or fan it
-- out, which is why this schema works unchanged whether the bytes are plaintext
-- (the current decision) or client-encrypted later.
--
-- Row-Level Security is enabled on every table in the same statement block that
-- creates it: the publishable key ships inside the client bundle, so RLS is the
-- only thing protecting any of this. No table exists unprotected, even briefly.

-- ===========================================================================
-- trips
-- ===========================================================================

create table public.trips (
  id          uuid primary key default gen_random_uuid(),

  -- The client-side nanoid TripId. Trips are created offline long before an
  -- account exists, so migration is keyed on (owner, local id) to stay
  -- idempotent when a device retries an upload.
  local_id    text        not null check (length(local_id) between 1 and 64),

  owner_id    uuid        not null references auth.users (id) on delete cascade,

  -- Denormalised so the trip list renders before the document is hydrated.
  -- The document remains authoritative; these are a cheap preview.
  name        text        not null check (length(name) between 1 and 200),
  start_date  date        not null,
  end_date    date        not null,

  created_at  timestamptz not null default now(),

  constraint trips_dates_ordered check (end_date >= start_date),
  constraint trips_owner_local_id_unique unique (owner_id, local_id)
);

alter table public.trips enable row level security;

comment on column public.trips.local_id is
  'Client nanoid TripId; makes the first upload idempotent per owner.';

-- ===========================================================================
-- trip_members
-- ===========================================================================

-- Maps an account to the participant it *is* inside the document.
--
-- There is deliberately no `role` column: ownership already lives in
-- trips.owner_id, and a second copy would be both redundant and a privilege
-- escalation surface, since members may update their own row to claim an
-- identity.
create table public.trip_members (
  trip_id    uuid        not null references public.trips (id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,

  -- The Person id inside the document this account claims to be. Null until the
  -- identity step. Postgres treats nulls as distinct in a unique constraint, so
  -- any number of members may be unclaimed while no two claim the same
  -- participant.
  person_id  text        check (person_id is null or length(person_id) between 1 and 64),

  joined_at  timestamptz not null default now(),

  primary key (trip_id, user_id),
  constraint trip_members_person_unique unique (trip_id, person_id)
);

alter table public.trip_members enable row level security;

comment on constraint trip_members_person_unique on public.trip_members is
  'Two accounts cannot both claim to be the same participant.';

-- ===========================================================================
-- trip_invites
-- ===========================================================================

-- The share link. Unlike the WebRTC scheme this replaces — where the room id and
-- encryption key sat in a URL fragment forever, unrevocably — an invite can
-- expire, be capped, and be revoked.
create table public.trip_invites (
  token       text        primary key check (length(token) between 16 and 64),
  trip_id     uuid        not null references public.trips (id) on delete cascade,
  created_by  uuid        not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),

  -- Null means no expiry / no cap. Both are policy the UI chooses per link.
  expires_at  timestamptz,
  max_uses    integer     check (max_uses is null or max_uses > 0),

  -- Only redeem_invite() advances this; there is no UPDATE policy on the table.
  uses        integer     not null default 0 check (uses >= 0),
  revoked_at  timestamptz
);

create index trip_invites_trip_id_idx on public.trip_invites (trip_id);

alter table public.trip_invites enable row level security;

-- ===========================================================================
-- trip_doc_updates — the log
-- ===========================================================================

create table public.trip_doc_updates (
  id         bigint      generated always as identity primary key,
  trip_id    uuid        not null references public.trips (id) on delete cascade,

  -- Base64 of one Yjs binary update.
  --
  -- text rather than bytea because PostgREST and Realtime render bytea as
  -- hex-escaped `\x…`, which is a third encoding to get right across the REST
  -- read, the Realtime payload and the insert. Base64 costs ~33% more bytes on a
  -- budget using well under 1% of the free tier.
  --
  -- The bound is generous: an ordinary field edit is tens of bytes, and the
  -- largest legitimate write is a whole document uploaded as a single update
  -- when a local trip is first migrated to the server.
  "update"   text        not null
               check (octet_length("update") between 1 and 1048576)
               check ("update" ~ '^[A-Za-z0-9+/]+={0,2}$'),

  -- Defaulted *and* enforced by the insert policy, so a client cannot attribute
  -- its writes to somebody else.
  author_id  uuid        not null default auth.uid()
               references auth.users (id) on delete cascade,

  created_at timestamptz not null default now()
);

-- Every read is "this trip's updates after cursor N", in order.
create index trip_doc_updates_trip_id_id_idx
  on public.trip_doc_updates (trip_id, id);

alter table public.trip_doc_updates enable row level security;

comment on table public.trip_doc_updates is
  'Append-only Yjs log. No user may UPDATE or DELETE; compaction runs as the service role.';

-- ===========================================================================
-- trip_doc_snapshots — the compacted head
-- ===========================================================================

-- Lets a joining device skip the whole log. Written only by the compaction job
-- running as the service role, so a member cannot rewrite trip history by
-- replacing the snapshot.
create table public.trip_doc_snapshots (
  trip_id    uuid        primary key references public.trips (id) on delete cascade,

  -- Base64 of Y.encodeStateAsUpdate(doc).
  state      text        not null
               check (octet_length(state) between 1 and 8388608)
               check (state ~ '^[A-Za-z0-9+/]+={0,2}$'),

  -- Highest trip_doc_updates.id folded in. A client applies the snapshot, then
  -- everything after this id.
  through_id bigint      not null,

  updated_at timestamptz not null default now()
);

alter table public.trip_doc_snapshots enable row level security;

-- ===========================================================================
-- Grants
-- ===========================================================================

-- RLS decides *which rows*; grants decide whether the role may attempt the
-- statement at all. Both are required, and they are not interchangeable.
--
-- Every grant here is written revoke-first, and that is not stylistic. Supabase
-- ships `alter default privileges ... grant all on tables to anon, authenticated,
-- service_role`, so a newly created table arrives with SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES and TRIGGER already granted to both client roles.
-- An additive `grant select, insert` on top of that is a no-op that reads like a
-- restriction.
--
-- The practical difference, measured: with the additive form, a member's
-- `update public.trip_doc_updates ...` did not raise — RLS merely matched no
-- rows, so it silently affected none. The append-only guarantee rested entirely
-- on the absence of a policy, and would have quietly evaporated the day anyone
-- added a permissive one. Revoking first makes it a privilege error instead.
--
-- anon is revoked outright: an unauthenticated caller must reach nothing. The
-- app's local-only mode never talks to this database at all.
--
-- service_role keeps its defaults: compaction writes snapshots and prunes the
-- log as that role.

revoke all on public.trips              from anon, authenticated;
revoke all on public.trip_members       from anon, authenticated;
revoke all on public.trip_invites       from anon, authenticated;
revoke all on public.trip_doc_updates   from anon, authenticated;
revoke all on public.trip_doc_snapshots from anon, authenticated;

-- Trips: full CRUD, narrowed to the caller's own trips by policy.
grant select, insert, update, delete on public.trips to authenticated;

-- Roster: no INSERT — joining goes through redeem_invite(). UPDATE is the
-- identity claim; DELETE is leaving.
grant select, update, delete on public.trip_members to authenticated;

-- Invites: created and re-read by members. `uses` and `revoked_at` move only
-- through redeem_invite() / revoke_invite(), so no UPDATE.
grant select, insert on public.trip_invites to authenticated;

-- The log is append-only for users. No UPDATE, no DELETE, no TRUNCATE.
grant select, insert on public.trip_doc_updates to authenticated;

-- The compacted head is read-only for users; only the service role writes it.
grant select on public.trip_doc_snapshots to authenticated;

-- Identity columns need their sequence usable by whoever may INSERT.
grant usage, select on sequence public.trip_doc_updates_id_seq to authenticated;
