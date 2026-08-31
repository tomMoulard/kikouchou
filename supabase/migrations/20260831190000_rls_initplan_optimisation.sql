-- Performance: stop the policies doing per-row work.
--
-- Supabase's performance advisor flagged seven policies for re-evaluating
-- `auth.uid()` once per row. Wrapping the call in a scalar subquery —
-- `(select auth.uid())` — lets the planner hoist it into a one-time InitPlan,
-- because a subquery with no outer references is evaluated once per statement
-- rather than once per row.
--
-- Measuring the flagged case turned up a second, unflagged problem that costs
-- considerably more. The advisor's linter only looks for a literal
-- `auth.<fn>()` in the policy body, so it says nothing about
-- `is_trip_member(trip_id)` — which takes a *per-row* argument and therefore
-- genuinely runs once per row, each call doing its own EXISTS query. On a trip
-- with 5,200 log rows:
--
--   Seq Scan on trip_doc_updates (actual rows=5200)
--     Filter: ((trip_id = '…') AND private.is_trip_member(trip_id))
--   Execution Time: 18.616 ms
--
-- Note the Seq Scan: a function call in the filter is opaque to the planner, so
-- `trip_doc_updates_trip_id_id_idx` went unused and the row estimate was out by
-- 3x (1754 vs 5200). Pulling the log is the single hottest read in the sync
-- protocol, so this is the one worth fixing.
--
-- The shape that fixes it: ask "which trips am I in?" once, as a set, and
-- semi-join against it. The subquery has no outer reference, so it is evaluated
-- once and hashed, and `trip_id` is left as a plain indexable predicate.

-- ===========================================================================
-- One question, asked once per statement
-- ===========================================================================

-- `security definer` for the same reason is_trip_member needs it: this reads
-- trip_members from inside trip_members' own policy, and as invoker that
-- re-enters the policy. `stable` lets the planner treat the result as fixed for
-- the statement.
create or replace function private.my_trip_ids()
  returns setof uuid
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select m.trip_id
  from public.trip_members m
  where m.user_id = (select auth.uid());
$$;

revoke all on function private.my_trip_ids() from public, anon;
grant execute on function private.my_trip_ids() to authenticated;

comment on function private.my_trip_ids() is
  'The current user''s trip ids, as a set, for semi-joins in RLS policies. Evaluated once per statement rather than once per row.';

-- is_trip_member() stays: revoke_invite() calls it with a single id, where a
-- set-returning form would buy nothing.

-- ===========================================================================
-- trips
-- ===========================================================================

alter policy "members read their trips" on public.trips
  using (id in (select private.my_trip_ids()));

alter policy "users create their own trips" on public.trips
  with check (owner_id = (select auth.uid()));

alter policy "owners update their trips" on public.trips
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

alter policy "owners delete their trips" on public.trips
  using (owner_id = (select auth.uid()));

-- ===========================================================================
-- trip_members
-- ===========================================================================

alter policy "members read the roster" on public.trip_members
  using (trip_id in (select private.my_trip_ids()));

alter policy "members claim their own identity" on public.trip_members
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy "members may leave, owners may not" on public.trip_members
  using (
    user_id = (select auth.uid())
    and not exists (
      select 1
      from public.trips t
      where t.id = trip_id
        and t.owner_id = (select auth.uid())
    )
  );

-- ===========================================================================
-- trip_invites
-- ===========================================================================

alter policy "members read invites for their trips" on public.trip_invites
  using (trip_id in (select private.my_trip_ids()));

alter policy "members create invites for their trips" on public.trip_invites
  with check (
    trip_id in (select private.my_trip_ids())
    and created_by = (select auth.uid())
  );

-- ===========================================================================
-- trip_doc_updates — the hot path
-- ===========================================================================

alter policy "members read the trip log" on public.trip_doc_updates
  using (trip_id in (select private.my_trip_ids()));

alter policy "members append to the trip log" on public.trip_doc_updates
  with check (
    trip_id in (select private.my_trip_ids())
    and author_id = (select auth.uid())
  );

-- ===========================================================================
-- trip_doc_snapshots
-- ===========================================================================

alter policy "members read the trip snapshot" on public.trip_doc_snapshots
  using (trip_id in (select private.my_trip_ids()));
