-- Guest groups: reusable rosters that belong to an account rather than a trip.
--
-- This is the first table here that is *not* trip-scoped, and that changes the
-- access model completely: there is no roster to consult and no invite to
-- redeem. A group is private to its owner, full stop, so every policy below is
-- `owner_id = auth.uid()` and there is deliberately no sharing path at all.
--
-- The whole group travels as one row. Members are a jsonb array rather than a
-- child table because nothing references a member, a member is only ever read
-- as part of its group, and a child table would need its own policies to say
-- the same thing this row's already say.
--
-- Row-Level Security is enabled in the same statement block that creates the
-- table: the publishable key ships inside the client bundle, so RLS is the only
-- thing protecting any of this.

-- ===========================================================================
-- guest_groups
-- ===========================================================================

create table public.guest_groups (
  id         uuid primary key default gen_random_uuid(),

  -- The client-side nanoid GuestGroupId. Groups are created offline long before
  -- an account exists, so the upsert is keyed on (owner, local id) to stay
  -- idempotent across a retry, a second tab and a reinstall — the same shape
  -- public.trips uses for the same reason.
  local_id   text        not null check (length(local_id) between 1 and 64),

  owner_id   uuid        not null references auth.users (id) on delete cascade,

  name       text        not null check (length(name) between 1 and 100),

  -- One entry per member: {id, name, color, headcount?, notes?}.
  --
  -- Bounded three ways, because a client is not obliged to be reasonable and
  -- this column is echoed back to every one of the owner's devices: it must be
  -- an array, of at most MAX_GUEST_GROUP_MEMBERS entries, within a total size
  -- that a phone can render. The client validates each member field on the way
  -- in; these checks are what stops the row being unusable in the first place.
  members    jsonb       not null default '[]'::jsonb
               check (jsonb_typeof(members) = 'array')
               check (jsonb_array_length(members) <= 50)
               check (octet_length(members::text) <= 65536),

  -- Written by the client from its own `updatedAt`, and the sole input to
  -- last-write-wins reconciliation. Deliberately not `now()`: the comparison
  -- happens on the device, against a local number, and a server clock on one
  -- side of it would make the winner depend on which device asked.
  updated_at timestamptz not null default now(),

  created_at timestamptz not null default now(),

  constraint guest_groups_owner_local_id_unique unique (owner_id, local_id)
);

alter table public.guest_groups enable row level security;

comment on table public.guest_groups is
  'Per-account reusable guest rosters. Private to the owner; never shared with trip members.';

comment on column public.guest_groups.local_id is
  'Client nanoid GuestGroupId; makes the upsert idempotent per owner.';

comment on column public.guest_groups.updated_at is
  'Client-authored. Last-write-wins input, compared against the device''s own clock.';

-- `unique (owner_id, local_id)` already indexes owner_id as its leading column,
-- which is what every query here filters on and what covers the foreign key. No
-- second index.

-- ===========================================================================
-- Row-Level Security
-- ===========================================================================
--
--   table        | select | insert         | update         | delete
--   -------------|--------|----------------|----------------|-------
--   guest_groups | owner  | owner, as self | owner, as self | owner

create policy "owners read their guest groups"
  on public.guest_groups
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

-- `owner_id = auth.uid()` stops a client creating a group owned by somebody
-- else — the only way this table could otherwise be written to by a stranger.
create policy "owners create their own guest groups"
  on public.guest_groups
  for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

-- WITH CHECK repeats the condition so ownership cannot be handed away by an
-- UPDATE that rewrites owner_id — which is also what makes the client's
-- `on conflict (owner_id, local_id) do update` safe.
create policy "owners update their guest groups"
  on public.guest_groups
  for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "owners delete their guest groups"
  on public.guest_groups
  for delete
  to authenticated
  using (owner_id = (select auth.uid()));

-- ===========================================================================
-- Grants
-- ===========================================================================
--
-- Revoke-first, for the reason spelled out in 20260831170000_trip_sync_tables:
-- Supabase's default privileges hand every new table to anon and authenticated
-- with `grant all`, so an additive grant reads like a restriction and enforces
-- nothing. anon is revoked outright — a group is never readable signed out.

revoke all on public.guest_groups from anon, authenticated;

grant select, insert, update, delete on public.guest_groups to authenticated;
