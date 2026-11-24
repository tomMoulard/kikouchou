-- Instant notifications: an activity invitation, and a money line changed.
--
-- The reminders the sender sweeps for (trip start, own arrival, pickup) are
-- joined by two kinds a device asks for the moment it makes the change,
-- through `POST /push/notify` on the share-preview service:
--
-- - `activity_invite`: a guest was invited to an activity. Subject: the
--   activity id. Every device subscribed as that guest is told once.
-- - `money_line`: a money line a guest is on (payer, or one of its shares)
--   was added or changed. Subject: the line's id and a short digest of what
--   it says, so each version is told once and a save that changed nothing
--   is not told again.
--
-- They are logged in `reminder_log` like the others, which is what makes a
-- retried request send nothing twice. The guest who made the change is never
-- told: the document records who did (`invitedBy`, `updatedBy`).

alter table public.reminder_log drop constraint reminder_log_kind_check;

alter table public.reminder_log
  add constraint reminder_log_kind_check
  check (kind in ('trip_start', 'own_arrival', 'pickup', 'activity_invite', 'money_line'));
