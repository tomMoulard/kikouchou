-- Instant notifications: the kinds a device asks for are logged like the
-- reminders, and the log still refuses a kind nobody sends.
--
-- Run with:  bunx supabase test db

begin;
select plan(5);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

insert into auth.users (id, email, role, aud, instance_id)
values ('66666666-6666-6666-6666-666666666666', 'notify@example.test',
        'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.trips (id, local_id, owner_id, name, start_date, end_date)
values ('66666666-0000-0000-0000-000000000001', 'notify-local',
        '66666666-6666-6666-6666-666666666666', 'Notify', '2026-12-17', '2027-01-05');

-- A store app's device token: no Web Push keys.
insert into public.push_subscriptions (id, trip_id, person_id, endpoint, transport)
values ('66666666-0000-0000-0000-0000000000aa', '66666666-0000-0000-0000-000000000001',
        'guest-bob', 'fcm-token-0123456789abcdefghijklmnopqrstuvwxyz', 'fcm');

-- ===========================================================================
-- The log
-- ===========================================================================

select lives_ok(
  $$insert into public.reminder_log (subscription_id, kind, subject)
    values ('66666666-0000-0000-0000-0000000000aa', 'activity_invite', 'act-1')$$,
  'an activity invitation is logged'
);

select lives_ok(
  $$insert into public.reminder_log (subscription_id, kind, subject)
    values ('66666666-0000-0000-0000-0000000000aa', 'money_line', 'line-1:0123456789abcdef')$$,
  'a version of a money line is logged'
);

select lives_ok(
  $$insert into public.reminder_log (subscription_id, kind, subject)
    values ('66666666-0000-0000-0000-0000000000aa', 'trip_change', 'r:ride-1:0123456789abcdef')$$,
  'a version of a row naming a guest is logged'
);

select lives_ok(
  $$insert into public.reminder_log (subscription_id, kind, subject)
    values ('66666666-0000-0000-0000-0000000000aa', 'pickup', 'ride-1')$$,
  'the swept kinds are still logged'
);

select throws_ok(
  $$insert into public.reminder_log (subscription_id, kind, subject)
    values ('66666666-0000-0000-0000-0000000000aa', 'marketing', 'x')$$,
  '23514', null, 'a kind nobody sends is refused'
);

select * from finish();
rollback;
