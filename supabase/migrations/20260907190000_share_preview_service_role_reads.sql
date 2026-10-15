-- Reads for the link preview service (`server/share-preview`).
--
-- share.kikouchou.app answers a share link with that trip's own name, dates and
-- occupancy card. It has no session — a link crawler is not signed in and never
-- will be — so it reads with the service role key, which bypasses Row-Level
-- Security.
--
-- Bypassing RLS is not the same as being allowed to touch the table. RLS decides
-- *which rows*; a GRANT decides whether the role may attempt the statement at
-- all. `20260831170000_trip_sync_tables.sql` left service_role alone on the
-- grounds that it "keeps its defaults", which is true of a project where
-- `alter default privileges … grant all on tables to … service_role` still
-- applies to a newly created table. It does not apply to this one. Every read
-- the preview service made came back:
--
--   42501  permission denied for table trip_invites
--   hint:  Grant the required privileges to the current role with:
--          GRANT SELECT ON public.trip_invites TO service_role;
--
-- and the service — which deliberately cannot tell a caller the difference
-- between "no such invite" and "the read failed", because the first is a fact
-- about somebody else's trip — rendered every live link as no longer valid.
--
-- SELECT only, and only the four tables a preview is drawn from:
--
--   trip_invites        the token, and whether it is still usable
--   trips               the name and the dates
--   trip_doc_snapshots  the compacted document
--   trip_doc_updates    the log written after that snapshot
--
-- No INSERT, no UPDATE, no DELETE. Drawing a card is a read, and the writes
-- that do run as this role — compaction — go through `security definer`
-- functions that need no table grant of their own. The append-only guarantee on
-- `trip_doc_updates` is unchanged for every role that can reach it from a
-- browser.
--
-- The key that carries these privileges is never in the client bundle: it is
-- set on the container at run time, and nothing in `server/share-preview` logs
-- it, echoes it, or puts it in a page.

grant select on public.trips              to service_role;
grant select on public.trip_invites       to service_role;
grant select on public.trip_doc_snapshots to service_role;
grant select on public.trip_doc_updates   to service_role;
