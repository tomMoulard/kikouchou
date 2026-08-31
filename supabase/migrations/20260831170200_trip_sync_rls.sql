-- Server-backed trip sync: Row-Level Security policies and Realtime.
--
-- The publishable key ships inside the client bundle, so these policies are the
-- entire access control story. Read them as the security model, not as a
-- formality.
--
-- Summary of who can do what:
--
--   table                | select        | insert            | update    | delete
--   ---------------------|---------------|-------------------|-----------|--------
--   trips                | members       | owner, as self    | owner     | owner
--   trip_members         | members       | redeem_invite only| own row   | own row, not owner
--   trip_invites         | members       | members, as self  | never     | never
--   trip_doc_updates     | members       | members, as self  | never     | never
--   trip_doc_snapshots   | members       | service role      | service   | service

-- ===========================================================================
-- trips
-- ===========================================================================

create policy "members read their trips"
  on public.trips
  for select
  to authenticated
  using (public.is_trip_member(id));

-- `owner_id = auth.uid()` stops a client creating a trip owned by somebody else.
create policy "users create their own trips"
  on public.trips
  for insert
  to authenticated
  with check (owner_id = auth.uid());

-- WITH CHECK repeats the condition so ownership cannot be handed away by an
-- UPDATE that rewrites owner_id.
create policy "owners update their trips"
  on public.trips
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "owners delete their trips"
  on public.trips
  for delete
  to authenticated
  using (owner_id = auth.uid());

-- ===========================================================================
-- trip_members
-- ===========================================================================

-- Members see each other: the app has to show who is on the trip and which
-- participant each account claims to be.
create policy "members read the roster"
  on public.trip_members
  for select
  to authenticated
  using (public.is_trip_member(trip_id));

-- No INSERT policy on purpose. Joining goes through redeem_invite(), and the
-- owner's row is created by the trips insert trigger. Without a token there is
-- no way in.

-- Claiming an identity. Safe as a direct UPDATE only because this table has no
-- `role` column — there is nothing here to escalate to. The unique constraint on
-- (trip_id, person_id) is what rejects claiming a participant someone else has.
create policy "members claim their own identity"
  on public.trip_members
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Leaving. The owner cannot leave — is_trip_member() would then refuse them
-- their own trip's document. They delete the trip instead.
create policy "members may leave, owners may not"
  on public.trip_members
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    and not exists (
      select 1
      from public.trips t
      where t.id = trip_id
        and t.owner_id = auth.uid()
    )
  );

-- ===========================================================================
-- trip_invites
-- ===========================================================================

-- Members can read the trip's invites, which is what lets the share dialog
-- re-display a link the user already created rather than minting a new one every
-- time it opens. A non-member reads nothing, so tokens cannot be enumerated.
create policy "members read invites for their trips"
  on public.trip_invites
  for select
  to authenticated
  using (public.is_trip_member(trip_id));

-- Anyone on the trip may share it, which is the product behaviour. `created_by`
-- is pinned to the caller so an invite always has honest provenance.
create policy "members create invites for their trips"
  on public.trip_invites
  for insert
  to authenticated
  with check (
    public.is_trip_member(trip_id)
    and created_by = auth.uid()
  );

-- No UPDATE or DELETE policy. `uses` is advanced only by redeem_invite() and
-- `revoked_at` set only by revoke_invite(), so neither can be forged by a
-- member editing the row directly.

-- ===========================================================================
-- trip_doc_updates
-- ===========================================================================

create policy "members read the trip log"
  on public.trip_doc_updates
  for select
  to authenticated
  using (public.is_trip_member(trip_id));

create policy "members append to the trip log"
  on public.trip_doc_updates
  for insert
  to authenticated
  with check (
    public.is_trip_member(trip_id)
    and author_id = auth.uid()
  );

-- No UPDATE or DELETE policy: the log is append-only for users. History cannot
-- be rewritten, and pruning is the compaction job's business, running as the
-- service role.

-- ===========================================================================
-- trip_doc_snapshots
-- ===========================================================================

create policy "members read the trip snapshot"
  on public.trip_doc_snapshots
  for select
  to authenticated
  using (public.is_trip_member(trip_id));

-- No write policy at any level. Only the service role writes snapshots, so a
-- member cannot rewrite a trip's history by replacing its compacted head. A
-- client that wants to seed a trip appends its whole document to
-- trip_doc_updates as a single update instead.

-- ===========================================================================
-- Realtime
-- ===========================================================================

-- Postgres Changes honours RLS, so a subscriber receives only the rows its
-- select policy admits. Clients subscribe per trip with
-- `filter: trip_id=eq.<uuid>`.
--
-- Guarded because the publication is shared and may already carry the table on
-- a re-run or a partially applied migration.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_doc_updates'
  ) then
    alter publication supabase_realtime add table public.trip_doc_updates;
  end if;
end;
$$;
