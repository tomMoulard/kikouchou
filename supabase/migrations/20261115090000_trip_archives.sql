-- Trip archives: whether one account has put one trip away.
--
-- Archiving is personal. One person puts a finished trip away on the phone and
-- expects the laptop to agree, while a friend who is still planning the same
-- trip keeps it in the active list. So the flag belongs to the pair
-- (account, trip), and it lives here rather than in the trip document, which
-- every member shares, or in trip_members, which every member can read.
--
-- A row is written for both directions. `archived = false` is a real state: it
-- is how "taken back out on the laptop" reaches the phone.
--
-- Row-Level Security is enabled in the same block that creates the table: the
-- publishable key ships inside the client bundle, so RLS is the only thing
-- protecting any of this.

-- ===========================================================================
-- trip_archives
-- ===========================================================================

create table public.trip_archives (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  trip_id    uuid        not null references public.trips (id) on delete cascade,

  archived   boolean     not null,

  -- Written by the client from its own clock, and the sole input to
  -- last-write-wins reconciliation, as public.guest_groups.updated_at is. The
  -- comparison happens on the device, against a local number, so a server
  -- clock on one side of it would make the winner depend on which device asked.
  updated_at timestamptz not null,

  primary key (user_id, trip_id)
);

alter table public.trip_archives enable row level security;

comment on table public.trip_archives is
  'Per-account archived flag for a trip. Private to the account; other members never see it.';

comment on column public.trip_archives.updated_at is
  'Client-authored. Last-write-wins input, compared against the device''s own clock.';

-- The primary key leads with user_id, which is what every client query filters
-- on. This index covers the foreign key to trips, so deleting a trip does not
-- scan the table.
create index trip_archives_trip_id_idx on public.trip_archives (trip_id);

-- ===========================================================================
-- Row-Level Security
-- ===========================================================================
--
--   table         | select | insert              | update              | delete
--   --------------|--------|---------------------|---------------------|-------
--   trip_archives | self   | self, member of trip | self, member of trip | none
--
-- A write also needs membership of the trip. Without it an account could file
-- rows against any trip uuid it learned, which harms nobody but fills the table
-- with rows no client will read.

create policy "accounts read their trip archives"
  on public.trip_archives
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "members archive trips for themselves"
  on public.trip_archives
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_trip_member(trip_id)
  );

-- WITH CHECK repeats the condition, so an UPDATE cannot move a row onto another
-- account or another trip. That is also what makes the client's
-- `on conflict (user_id, trip_id) do update` safe.
create policy "members update their trip archives"
  on public.trip_archives
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and private.is_trip_member(trip_id)
  );

-- ===========================================================================
-- Grants
-- ===========================================================================
--
-- Revoke-first, for the reason in 20260831170000_trip_sync_tables: Supabase's
-- default privileges hand every new table to anon and authenticated with
-- `grant all`. No DELETE: a client takes a trip out of the archive by writing
-- `archived = false`, and the rows go with the trip or the account.

revoke all on public.trip_archives from anon, authenticated;

grant select, insert, update on public.trip_archives to authenticated;
