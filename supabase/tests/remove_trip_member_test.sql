-- Removing a member: only the organiser may, and the removal holds.
--
-- A removed member must lose the trip, must not get back in with the link they
-- joined through, and must stop receiving its reminders. Nobody else, not even
-- another member, may remove anyone.
--
-- Run with:  bunx supabase test db

begin;
select plan(12);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

insert into auth.users (id, email, role, aud, instance_id)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222', 'member@example.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('33333333-3333-3333-3333-333333333333', 'other@example.test',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

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

grant execute on all functions in schema tests to anon, authenticated;

select tests.act_as('11111111-1111-1111-1111-111111111111');

insert into public.trips (id, local_id, owner_id, name, start_date, end_date)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'local-1',
        '11111111-1111-1111-1111-111111111111', 'Brittany', '2026-07-15', '2026-07-22');

insert into public.trip_invites (token, trip_id, created_by)
values ('token-joined-with-01', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

select tests.act_as('22222222-2222-2222-2222-222222222222');
select public.redeem_invite('token-joined-with-01');
select tests.act_as('33333333-3333-3333-3333-333333333333');
select public.redeem_invite('token-joined-with-01');

-- The member's reminders, written as the server would.
reset role;
insert into public.push_subscriptions (trip_id, user_id, endpoint, p256dh, auth)
values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
        'https://push.example.test/member', repeat('k', 87), repeat('a', 22));

-- ===========================================================================
-- Who may remove
-- ===========================================================================

select tests.act_as('33333333-3333-3333-3333-333333333333');
select throws_ok(
  $$select public.remove_trip_member('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222')$$,
  '42501', 'only the trip organiser can remove a member',
  'a member cannot remove another member'
);

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok(
  $$select public.remove_trip_member('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222')$$,
  '42501', null,
  'anon cannot call it at all'
);
reset role;

select tests.act_as('11111111-1111-1111-1111-111111111111');
select throws_ok(
  $$select public.remove_trip_member('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')$$,
  '22023', 'the trip organiser cannot be removed',
  'the organiser cannot remove themselves'
);
select throws_ok(
  $$select public.remove_trip_member('aaaaaaaa-0000-0000-0000-00000000dead', '22222222-2222-2222-2222-222222222222')$$,
  '42501', 'only the trip organiser can remove a member',
  'an unknown trip answers like somebody else''s'
);

-- ===========================================================================
-- What a removal does
-- ===========================================================================

select lives_ok(
  $$select public.remove_trip_member('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222')$$,
  'the organiser removes a member'
);

select is(
  (select array_agg(user_id::text order by user_id) from public.trip_members
    where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  array['11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333'],
  'only the removed member leaves the roster'
);

select isnt(
  (select revoked_at from public.trip_invites where token = 'token-joined-with-01'),
  null,
  'the trip''s live invites are withdrawn'
);

reset role;
select is(
  (select count(*)::int from public.push_subscriptions
    where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'the removed member''s reminders stop'
);

select tests.act_as('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.trips), 0,
  'the removed member can no longer read the trip');

select throws_ok(
  $$select public.redeem_invite('token-joined-with-01')$$,
  'P0001', 'invite revoked',
  'the link they joined with no longer lets them back in'
);

select tests.act_as('33333333-3333-3333-3333-333333333333');
select is((select count(*)::int from public.trips), 1,
  'the members who stay keep the trip');

select tests.act_as('11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$select public.remove_trip_member('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222')$$,
  'removing somebody who is already gone is quiet'
);

select * from finish();
rollback;
