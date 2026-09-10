-- Trip reminders: who may subscribe, what is stored, and what stays shut.
--
-- The properties under test: a live invite token subscribes its holder to the
-- trip behind it and nothing else; a member subscribes to a trip they are on
-- and to no other; the subscription tables stay closed to both client roles;
-- and the endpoint alone is enough to stop the reminders.
--
-- Run with:  bunx supabase test db

begin;
select plan(24);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

insert into auth.users (id, email, role, aud, instance_id)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test',    'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222', 'stranger@example.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

create schema if not exists tests;
grant usage on schema tests to anon, authenticated;

create or replace function tests.act_as(user_id uuid) returns void
  language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$;

create or replace function tests.act_as_anon() returns void
  language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end;
$$;

create or replace function tests.act_as_postgres() returns void
  language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

grant execute on all functions in schema tests to anon, authenticated;

-- A browser's subscription, as PushManager.subscribe().toJSON() shapes it.
create or replace function tests.subscription(endpoint text) returns jsonb
  language sql immutable as $$
  select jsonb_build_object(
    'endpoint', endpoint,
    'expirationTime', null,
    'keys', jsonb_build_object(
      'p256dh', 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
      'auth',   'tBHItJI5svbpez7KI4CCXg'
    )
  );
$$;

grant execute on function tests.subscription(text) to anon, authenticated;

select tests.act_as('11111111-1111-1111-1111-111111111111');

insert into public.trips (id, local_id, owner_id, name, start_date, end_date)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'local-1',
        '11111111-1111-1111-1111-111111111111', 'Brittany', '2026-07-15', '2026-07-22');

insert into public.trip_invites (token, trip_id, created_by, expires_at, max_uses, uses)
values
  ('token-still-valid-01', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, null, 0),
  ('token-expired-000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', now() - interval '1 hour', null, 0),
  ('token-spent-00000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, 1, 1),
  ('token-to-be-revoked1', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, null, 0);

select public.revoke_invite('token-to-be-revoked1');

-- ===========================================================================
-- A viewer subscribes through a live token
-- ===========================================================================

select tests.act_as_anon();

select isnt(
  public.subscribe_trip_reminders(
    'token-still-valid-01',
    tests.subscription('https://push.example.test/send/viewer-1'),
    'person-alice', 'en', 'ph-anon-1'
  ),
  null,
  'anon subscribes through a live token'
);

select tests.act_as_postgres();

select is(
  (select count(*) from public.push_subscriptions where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1::bigint,
  'one subscription row is stored'
);

select is(
  (select person_id from public.push_subscriptions where endpoint = 'https://push.example.test/send/viewer-1'),
  'person-alice',
  'the row carries the guest the device says it is'
);

select is(
  (select locale from public.push_subscriptions where endpoint = 'https://push.example.test/send/viewer-1'),
  'en',
  'the row carries the language the app was showing'
);

select is(
  (select user_id from public.push_subscriptions where endpoint = 'https://push.example.test/send/viewer-1'),
  null,
  'a viewer has no account on the row'
);

select is(
  (select uses from public.trip_invites where token = 'token-still-valid-01'),
  0,
  'subscribing consumes no use of the invite'
);

-- Asking again is an update, not a second row.
select tests.act_as_anon();

select lives_ok(
  $$select public.subscribe_trip_reminders(
      'token-still-valid-01',
      tests.subscription('https://push.example.test/send/viewer-1'),
      'person-bob', 'fr', null)$$,
  'the same endpoint may subscribe again'
);

select tests.act_as_postgres();

select is(
  (select count(*) from public.push_subscriptions where endpoint = 'https://push.example.test/send/viewer-1'),
  1::bigint,
  'a repeat subscription updates the row rather than adding one'
);

select is(
  (select person_id from public.push_subscriptions where endpoint = 'https://push.example.test/send/viewer-1'),
  'person-bob',
  'the repeat carries the new name'
);

select is(
  (select analytics_id from public.push_subscriptions where endpoint = 'https://push.example.test/send/viewer-1'),
  'ph-anon-1',
  'a repeat without an analytics id keeps the one it had'
);

-- ===========================================================================
-- Dead tokens refuse, with the same hints as read_shared_trip
-- ===========================================================================

select tests.act_as_anon();

select throws_ok(
  $$select public.subscribe_trip_reminders('token-does-not-exist', tests.subscription('https://push.example.test/send/x'))$$,
  'P0002', null, 'an unknown token is refused'
);

select throws_ok(
  $$select public.subscribe_trip_reminders('token-to-be-revoked1', tests.subscription('https://push.example.test/send/x'))$$,
  'P0001', null, 'a revoked token is refused'
);

select throws_ok(
  $$select public.subscribe_trip_reminders('token-expired-000001', tests.subscription('https://push.example.test/send/x'))$$,
  'P0001', null, 'an expired token is refused'
);

select throws_ok(
  $$select public.subscribe_trip_reminders('token-spent-00000001', tests.subscription('https://push.example.test/send/x'))$$,
  'P0001', null, 'a spent token is refused'
);

-- A malformed subscription never reaches the table.
select throws_ok(
  $$select public.subscribe_trip_reminders('token-still-valid-01', '{"endpoint": "http://plain.example.test/x"}'::jsonb)$$,
  '22023', null, 'a subscription without https and keys is refused'
);

-- ===========================================================================
-- The tables stay shut
-- ===========================================================================

select throws_ok(
  $$select count(*) from public.push_subscriptions$$,
  '42501', null, 'anon has no privilege on push_subscriptions'
);

select throws_ok(
  $$select count(*) from public.reminder_log$$,
  '42501', null, 'anon has no privilege on reminder_log'
);

select tests.act_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$select count(*) from public.push_subscriptions$$,
  '42501', null, 'a signed-in stranger has no privilege on push_subscriptions either'
);

-- ===========================================================================
-- A member subscribes by trip id; a stranger cannot
-- ===========================================================================

select throws_ok(
  $$select public.subscribe_member_reminders('aaaaaaaa-0000-0000-0000-000000000001', tests.subscription('https://push.example.test/send/stranger'))$$,
  '42501', null, 'a stranger cannot subscribe to a trip they are not on'
);

select tests.act_as('11111111-1111-1111-1111-111111111111');

select isnt(
  public.subscribe_member_reminders(
    'aaaaaaaa-0000-0000-0000-000000000001',
    tests.subscription('https://push.example.test/send/owner-1'),
    'person-owner', 'fr', 'ph-owner'
  ),
  null,
  'the owner subscribes by trip id'
);

select tests.act_as_postgres();

select is(
  (select user_id from public.push_subscriptions where endpoint = 'https://push.example.test/send/owner-1'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'a member row carries the account'
);

-- ===========================================================================
-- Unsubscribing
-- ===========================================================================

select tests.act_as_anon();

select is(
  public.unsubscribe_reminders('https://push.example.test/send/viewer-1'),
  1,
  'the endpoint alone stops the reminders'
);

select is(
  public.unsubscribe_reminders('https://push.example.test/send/viewer-1'),
  0,
  'unsubscribing twice removes nothing more'
);

select tests.act_as_postgres();

select is(
  (select count(*) from public.push_subscriptions),
  1::bigint,
  'only the owner''s subscription remains'
);

select * from finish();
rollback;
