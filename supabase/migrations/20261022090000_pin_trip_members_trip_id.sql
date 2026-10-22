-- A roster row's trip is not the member's to change, and the grant now says so.
--
-- `20260831170000_trip_sync_tables.sql` granted `update` on `trip_members` to
-- `authenticated` with no column list, and the UPDATE policy "members claim
-- their own identity" pins `user_id` alone: USING on the old row, WITH CHECK
-- on the new one. Read on their own, grant and policy let a member PATCH the
-- `trip_id` of their own row onto any trip whose uuid they knew, and
-- `read_shared_trip` hands that uuid to anyone with a link.
--
-- Measured on a fresh local stack before this migration, the move is refused
-- all the same: Postgres also checks the updated row against the table's
-- SELECT policy, and "members read the roster" admits only a trip the caller
-- is already a member of, where the primary key then collides. So nothing was
-- open. What was true is that the only thing keeping it closed was a rule of
-- the engine nobody here had written down, applied to a policy written for
-- reading. A later edit to the SELECT policy, or a Postgres that stops
-- applying it to updated rows, would have opened the roster without a line of
-- this schema changing.
--
-- The only UPDATE a client makes is the identity claim (`person_id`), so that
-- is the only column it may update. Column grants are checked before any
-- policy, so a PATCH naming `trip_id`, `user_id` or `joined_at` fails with
-- 42501 whatever the policies say. `supabase/tests/trip_sync_rls_test.sql`
-- asserts it, and `function_exposure_test.sql` now pins the function
-- catalogue for `authenticated` as it did for `anon`.

revoke update on public.trip_members from authenticated;
grant update (person_id) on public.trip_members to authenticated;

comment on column public.trip_members.person_id is
  'The Person id inside the document this account claims to be. The only column a client may update: the row''s trip and account are set by redeem_invite() and the owner trigger, never by the member.';
