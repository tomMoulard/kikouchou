-- Row-Level Security tests for server-backed trip sync.
--
-- The publishable key ships inside the client bundle, so these policies are the
-- whole access control story — every claim in the migration's comments is
-- asserted here against a real Postgres rather than taken on trust.
--
-- Run with:  bunx supabase test db
--
-- `set local role authenticated` plus a `request.jwt.claims` sub is exactly how
-- PostgREST presents a signed-in caller, so `auth.uid()` resolves the same way it
-- will in production.

begin;
select plan(36);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

-- Three accounts: an owner, someone who gets invited, and a stranger.
insert into auth.users (id, email, role, aud, instance_id)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test',    'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222', 'invitee@example.test',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('33333333-3333-3333-3333-333333333333', 'stranger@example.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

-- Helpers live in their own schema, created inside the transaction this test
-- rolls back, so nothing survives the run.
create schema if not exists tests;
-- The helpers are called while impersonating the client roles, so those roles
-- need to reach them.
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

-- ===========================================================================
-- The owner creates a trip
-- ===========================================================================

select tests.act_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$insert into public.trips (id, local_id, owner_id, name, start_date, end_date)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'local-trip-1',
            '11111111-1111-1111-1111-111111111111', 'Brittany', '2026-07-15', '2026-07-22')$$,
  'an owner can create a trip'
);

select throws_ok(
  $$insert into public.trips (local_id, owner_id, name, start_date, end_date)
    values ('local-trip-x', '22222222-2222-2222-2222-222222222222', 'Not mine', '2026-07-15', '2026-07-22')$$,
  '42501',
  null,
  'a user cannot create a trip owned by somebody else'
);

select is(
  (select count(*)::int from public.trip_members
   where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'the insert trigger makes the owner a member, so is_trip_member sees them'
);

select is(
  (select count(*)::int from public.trips),
  1,
  'the owner reads their own trip'
);

-- The owner seeds the document, the way a first migration upload does.
select lives_ok(
  $$insert into public.trip_doc_updates (trip_id, "update")
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'AQIDBA==')$$,
  'a member can append to the log'
);

select is(
  (select author_id from public.trip_doc_updates limit 1),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'author_id defaults to the caller'
);

select throws_ok(
  $$insert into public.trip_doc_updates (trip_id, "update", author_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'AQIDBA==',
            '33333333-3333-3333-3333-333333333333')$$,
  '42501',
  null,
  'a member cannot attribute a log entry to somebody else'
);

select throws_ok(
  $$update public.trip_doc_updates set "update" = 'BBBB' where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'the log is append-only: no UPDATE for members'
);

select throws_ok(
  $$delete from public.trip_doc_updates where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'the log is append-only: no DELETE for members'
);

select throws_ok(
  $$insert into public.trip_doc_snapshots (trip_id, state, through_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'AQID', 1)$$,
  '42501',
  null,
  'a member cannot write a snapshot, so trip history cannot be rewritten'
);

-- Bounds on remote-supplied content.
select throws_ok(
  $$insert into public.trip_doc_updates (trip_id, "update")
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'not valid base64!!')$$,
  '23514',
  null,
  'a non-base64 log entry is rejected by the check constraint'
);

select throws_ok(
  $$insert into public.trip_doc_updates (trip_id, "update")
    values ('aaaaaaaa-0000-0000-0000-000000000001', repeat('A', 1048577))$$,
  '23514',
  null,
  'an oversized log entry is rejected'
);

-- ===========================================================================
-- A stranger sees nothing
-- ===========================================================================

select tests.act_as('33333333-3333-3333-3333-333333333333');

select is((select count(*)::int from public.trips), 0,
  'a stranger cannot read a trip they do not belong to');
select is((select count(*)::int from public.trip_doc_updates), 0,
  'a stranger cannot read the log');
select is((select count(*)::int from public.trip_members), 0,
  'a stranger cannot read the roster');

select throws_ok(
  $$insert into public.trip_doc_updates (trip_id, "update")
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'AQIDBA==')$$,
  '42501',
  null,
  'a stranger cannot append to a trip log'
);

select throws_ok(
  $$insert into public.trip_members (trip_id, user_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333')$$,
  '42501',
  null,
  'there is no INSERT policy on trip_members: joining requires an invite'
);

-- ===========================================================================
-- Anonymous callers
-- ===========================================================================

select tests.act_as_anon();

select throws_ok(
  $$select count(*) from public.trips$$,
  '42501',
  null,
  'anon has no privilege on trips at all'
);

-- ===========================================================================
-- Invites
-- ===========================================================================

select tests.act_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$insert into public.trip_invites (token, trip_id, created_by)
    values ('invite-token-0000001', 'aaaaaaaa-0000-0000-0000-000000000001',
            '11111111-1111-1111-1111-111111111111')$$,
  'a member can create an invite for their trip'
);

select is(
  (select count(*)::int from public.trip_invites),
  1,
  'a member can re-read the invite, so the share dialog can show the link again'
);

select throws_ok(
  $$update public.trip_invites set uses = 99 where token = 'invite-token-0000001'$$,
  '42501',
  null,
  'uses is tamper-proof: no UPDATE policy on trip_invites'
);

select tests.act_as('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.trip_invites),
  0,
  'a stranger cannot read invites, so tokens cannot be enumerated'
);

-- ===========================================================================
-- Redeeming
-- ===========================================================================

select tests.act_as('22222222-2222-2222-2222-222222222222');

select is((select count(*)::int from public.trips), 0,
  'the invitee cannot see the trip before redeeming');

select is(
  public.redeem_invite('invite-token-0000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'redeeming an invite returns the trip id'
);

select is((select count(*)::int from public.trips), 1,
  'the invitee can read the trip after redeeming');

select is((select count(*)::int from public.trip_doc_updates), 1,
  'the invitee can read the log after redeeming');

-- Reloading the join page must not burn a seat or fail.
select is(
  public.redeem_invite('invite-token-0000001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'redeeming twice is idempotent'
);

select is(
  (select uses from public.trip_invites where token = 'invite-token-0000001'),
  1,
  'a repeat redemption does not consume another use'
);

select throws_ok(
  $$select public.redeem_invite('no-such-token-000001')$$,
  'P0002',
  null,
  'an unknown token is rejected'
);

-- ===========================================================================
-- Claiming an identity
-- ===========================================================================

select lives_ok(
  $$update public.trip_members set person_id = 'person-alice'
    where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and user_id = '22222222-2222-2222-2222-222222222222'$$,
  'a member can claim which participant they are'
);

select tests.act_as('11111111-1111-1111-1111-111111111111');

select throws_ok(
  $$update public.trip_members set person_id = 'person-alice'
    where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and user_id = '11111111-1111-1111-1111-111111111111'$$,
  '23505',
  null,
  'two accounts cannot claim the same participant'
);

select is(
  (select count(*)::int from public.trip_members
   where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001' and person_id is null),
  1,
  'unclaimed members coexist: nulls are distinct in the unique constraint'
);

-- ===========================================================================
-- Leaving
-- ===========================================================================

select results_eq(
  $$delete from public.trip_members
    where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and user_id = '11111111-1111-1111-1111-111111111111'
    returning 1$$,
  'select 1 where false',
  'the owner cannot leave their own trip, which would lock them out of it'
);

select tests.act_as('22222222-2222-2222-2222-222222222222');

select results_eq(
  $$delete from public.trip_members
    where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and user_id = '22222222-2222-2222-2222-222222222222'
    returning 1$$,
  'select 1',
  'a non-owner member can leave'
);

select is((select count(*)::int from public.trips), 0,
  'after leaving, the trip is no longer readable');

-- ===========================================================================
-- Realtime
-- ===========================================================================

select tests.act_as_postgres();

select is(
  (select count(*)::int from pg_publication_tables
   where pubname = 'supabase_realtime'
     and schemaname = 'public'
     and tablename = 'trip_doc_updates'),
  1,
  'the log is published to Realtime so peers get live updates'
);

select * from finish();
rollback;
