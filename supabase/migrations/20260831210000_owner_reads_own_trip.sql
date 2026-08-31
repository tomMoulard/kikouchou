-- Let an owner read their own trip without going through the roster.
--
-- ## The bug
--
-- Sharing a trip failed with:
--
--   new row violates row-level security policy for table "trips"
--
-- which reads like the insert's WITH CHECK rejecting the row. It was not. The
-- WITH CHECK passes: reproduced against a real Postgres, a plain
-- `insert into trips (...)` succeeds, and only `insert ... returning id` fails.
--
-- **RETURNING is subject to the SELECT policy.** The client inserts with
-- PostgREST's `.select('id').single()`, which becomes `INSERT ... RETURNING id`,
-- and the SELECT policy was `id in (select private.my_trip_ids())` — satisfied
-- only once a `trip_members` row exists. That row is created by
-- `trips_add_owner_as_member`, an AFTER INSERT trigger, which has not fired when
-- RETURNING is evaluated. So the owner could create a trip but never read back
-- its id, and the error pointed at the wrong policy.
--
-- ## The fix
--
-- Admit the owner directly, in addition to the roster. This is the right
-- semantics regardless of the bug — ownership implies read access, and making
-- that depend on a separate membership row was always indirection rather than a
-- rule. It also decouples readability from trigger ordering, and leaves an owner
-- able to see their trip if the membership row is ever missing.
--
-- The owner branch is checked first because it is a plain column comparison,
-- so the common case never evaluates the subquery at all.
--
-- Only `trips` needs this. Every other insert either has no RETURNING
-- (`trip_doc_updates`, `trip_members`) or happens when the caller is already on
-- the roster (`trip_invites`).

alter policy "members read their trips" on public.trips
  using (
    owner_id = (select auth.uid())
    or id in (select private.my_trip_ids())
  );

comment on policy "members read their trips" on public.trips is
  'Owner or roster member. The owner branch also makes INSERT ... RETURNING work, since RETURNING is subject to this policy and the owner''s roster row is added by an AFTER INSERT trigger.';
