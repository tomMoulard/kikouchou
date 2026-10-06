-- Index the foreign keys the advisor flagged.
--
-- Three findings, and one of them is on the hottest path in the schema.
--
-- ## trip_members.user_id — the one that matters
--
-- `private.my_trip_ids()` filters on `user_id` alone, and it runs for **every**
-- RLS check on **every** table. The primary key is `(trip_id, user_id)`, whose
-- leading column is trip_id, so it cannot serve that lookup at all. Measured on
-- a roster of 2,406 rows across 400 trips:
--
--   Seq Scan on trip_members (actual rows=400)
--     Filter: (user_id = (InitPlan 1).col1)
--     Rows Removed by Filter: 2006
--
-- 0.176 ms today, which is nothing — but this table grows with the total number
-- of memberships across all users, not per trip, and the scan is repeated on
-- every policy evaluation. It is the one index here worth having before there is
-- any data rather than after.
--
-- ## The other two
--
-- `trip_doc_updates.author_id` and `trip_invites.created_by` both reference
-- `auth.users` with `on delete cascade`. Without a covering index, deleting an
-- account forces a full scan of each table to find the rows to cascade. Neither
-- is on a hot read path; they are cheap insurance against a slow account
-- deletion.

create index trip_members_user_id_idx
  on public.trip_members (user_id);

comment on index public.trip_members_user_id_idx is
  'Serves private.my_trip_ids(), which every RLS policy calls. The (trip_id, user_id) primary key cannot: wrong leading column.';

create index trip_doc_updates_author_id_idx
  on public.trip_doc_updates (author_id);

create index trip_invites_created_by_idx
  on public.trip_invites (created_by);

-- ===========================================================================
-- On the "unused index" findings
-- ===========================================================================

-- The advisor also reports `trip_invites_trip_id_idx` and
-- `trip_doc_updates_trip_id_id_idx` as never used. Both are kept deliberately:
-- the database is new and empty, so *no* index has been used yet, and usage
-- statistics from a table with no rows say nothing about whether an index earns
-- its keep.
--
-- `trip_doc_updates_trip_id_id_idx` in particular is the index for the sync
-- provider's only hot read — "this trip's rows after cursor N". A local
-- measurement picked the primary key instead, but only because the test data had
-- a single trip; with several, `(trip_id, id)` is the correct access path.
--
-- Worth revisiting once there is real traffic, not before.
