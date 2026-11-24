-- Instant notifications for every change that involves a guest.
--
-- `activity_invite` and `money_line` are joined by `trip_change`: any other
-- row naming a guest (their stay, a room night, a journey, a ride, a car, an
-- activity they are in or run, a meal they cook, a shopping item they buy)
-- was added or changed. The device that made the change asks for it through
-- `POST /push/notify` on the share-preview service, naming the collection.
-- Subject: a short collection tag, the row's id and a digest of what the row
-- says, so each version is told once and a save that changed nothing is not
-- told again. The guest who made the change (`updatedBy`) is never told.

alter table public.reminder_log drop constraint reminder_log_kind_check;

alter table public.reminder_log
  add constraint reminder_log_kind_check
  check (kind in ('trip_start', 'own_arrival', 'pickup', 'activity_invite', 'money_line',
                  'trip_change'));
