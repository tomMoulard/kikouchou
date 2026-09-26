-- delete_my_account(): a shared trip stays with its other members, a trip
-- nobody else is on goes with the account, and nothing another member relies
-- on (their edits, the invite links) goes with it.
begin;
select plan(14);

insert into auth.users (id, email, role, aud, instance_id)
values
  ('11111111-1111-1111-1111-111111111111', 'leaving@example.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222', 'staying@example.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('33333333-3333-3333-3333-333333333333', 'host@example.test',    'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

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

-- ---------------------------------------------------------------------------
-- Fixtures, written as postgres so RLS does not shape them
-- ---------------------------------------------------------------------------

-- The leaving user owns a trip shared with one other member, owns a trip
-- nobody else is on, and is a member of somebody else's trip.
insert into public.trips (id, local_id, owner_id, name, start_date, end_date)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'shared-local', '11111111-1111-1111-1111-111111111111', 'Shared', '2026-07-15', '2026-07-22'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'alone-local',  '11111111-1111-1111-1111-111111111111', 'Alone',  '2026-08-01', '2026-08-03'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'hosted-local', '33333333-3333-3333-3333-333333333333', 'Hosted', '2026-09-01', '2026-09-05'),
  -- The staying member already owns a trip under the same local id, which the
  -- hand-over must not collide with.
  ('aaaaaaaa-0000-0000-0000-000000000004', 'shared-local', '22222222-2222-2222-2222-222222222222', 'Theirs', '2026-10-01', '2026-10-02');

insert into public.trip_members (trip_id, user_id, joined_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', now()),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', now());

insert into public.trip_invites (token, trip_id, created_by)
values ('invite-by-leaver-01', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

insert into public.trip_doc_updates (trip_id, "update", author_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'AAEC', '11111111-1111-1111-1111-111111111111');

insert into public.guest_groups (local_id, owner_id, name)
values ('group-local', '11111111-1111-1111-1111-111111111111', 'Family');

-- ---------------------------------------------------------------------------
-- Who may call it
-- ---------------------------------------------------------------------------

select tests.act_as_anon();

select throws_ok(
  'select public.delete_my_account()',
  '42501',
  null,
  'anon holds no EXECUTE on delete_my_account'
);

select tests.act_as_postgres();

select is(
  has_function_privilege('authenticated', 'public.delete_my_account()', 'execute'),
  true,
  'a signed-in account may delete itself'
);

-- ---------------------------------------------------------------------------
-- The deletion
-- ---------------------------------------------------------------------------

select tests.act_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  'select public.delete_my_account()',
  'the account deletes itself'
);

select tests.act_as_postgres();

select is(
  (select count(*) from auth.users where id = '11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'the auth row is gone'
);

select is(
  (select owner_id from public.trips where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '22222222-2222-2222-2222-222222222222'::uuid,
  'a shared trip is handed to the other member'
);

select is(
  (select local_id from public.trips where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'aaaaaaaa-0000-0000-0000-000000000001',
  'the hand-over steps around a local id the new owner already uses'
);

select is(
  (select count(*) from public.trip_members where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1::bigint,
  'the other member is still on the shared trip, alone'
);

select is(
  (select count(*) from public.trips where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0::bigint,
  'a trip nobody else is on goes with the account'
);

select is(
  (select owner_id from public.trips where id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  '33333333-3333-3333-3333-333333333333'::uuid,
  'somebody else''s trip keeps its owner'
);

select is(
  (select count(*) from public.trip_members
   where trip_id = 'aaaaaaaa-0000-0000-0000-000000000003'
     and user_id = '11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'and loses the leaving member'
);

select is(
  (select created_by from public.trip_invites where token = 'invite-by-leaver-01'),
  null,
  'an invite the leaving member handed out keeps working'
);

select is(
  (select count(*) from public.trip_doc_updates
   where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001' and author_id is null),
  1::bigint,
  'the leaving member''s edits stay in the shared trip''s log'
);

select is(
  (select count(*) from public.guest_groups where local_id = 'group-local'),
  0::bigint,
  'the account''s guest groups go with it'
);

-- ---------------------------------------------------------------------------
-- Without a session
-- ---------------------------------------------------------------------------

select tests.act_as('00000000-0000-0000-0000-000000000000');
select set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);

select throws_ok(
  'select public.delete_my_account()',
  '28000',
  'authentication required',
  'a call with no user id is refused'
);

select * from finish();
rollback;
