-- read_shared_trip(): the one door anon may open.
--
-- The property under test is narrow and load-bearing: a stranger holding a
-- live invite token reads exactly the trip behind it, and a stranger holding
-- anything else — a dead token, no token, the publishable key alone — reads
-- nothing at all. Every table stays closed to anon; only this function opens.
--
-- Run with:  bunx supabase test db

begin;
select plan(22);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

insert into auth.users (id, email, role, aud, instance_id)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
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

-- The owner sets up a trip, writes three log rows, and mints five invites in
-- five states.
select tests.act_as('11111111-1111-1111-1111-111111111111');

insert into public.trips (id, local_id, owner_id, name, start_date, end_date)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'local-1',
        '11111111-1111-1111-1111-111111111111', 'Brittany', '2026-07-15', '2026-07-22');

insert into public.trip_doc_updates (id, trip_id, update)
overriding system value
values
  (101, 'aaaaaaaa-0000-0000-0000-000000000001', 'AAE='),
  (102, 'aaaaaaaa-0000-0000-0000-000000000001', 'AAI='),
  (103, 'aaaaaaaa-0000-0000-0000-000000000001', 'AAM=');

insert into public.trip_invites (token, trip_id, created_by, expires_at, max_uses, uses)
values
  ('token-still-valid-01', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, null, 0),
  ('token-expired-000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', now() - interval '1 hour', null, 0),
  ('token-spent-00000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, 1, 1),
  ('token-to-be-revoked1', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, null, 0);

select public.revoke_invite('token-to-be-revoked1');

-- ===========================================================================
-- anon reads a live token, and nothing else
-- ===========================================================================

select tests.act_as_anon();

select is(
  (public.read_shared_trip('token-still-valid-01')->'trip'->>'name'),
  'Brittany',
  'anon reads the trip behind a live token'
);

select is(
  (public.read_shared_trip('token-still-valid-01')->'trip'->>'start_date'),
  '2026-07-15',
  'the preview carries the dates'
);

select is(
  jsonb_array_length(public.read_shared_trip('token-still-valid-01')->'updates'),
  3,
  'the whole log comes back on a first read'
);

select is(
  (public.read_shared_trip('token-still-valid-01')->'updates'->0->>'id')::bigint,
  101::bigint,
  'log rows arrive in id order'
);

select is(
  public.read_shared_trip('token-still-valid-01')->'has_more',
  'false'::jsonb,
  'three rows are one page'
);

select is(
  public.read_shared_trip('token-still-valid-01')->'snapshot',
  'null'::jsonb,
  'no snapshot yet reads as null, not as a missing key'
);

select is(
  jsonb_array_length(public.read_shared_trip('token-still-valid-01', 102)->'updates'),
  1,
  'after_id is a cursor: only rows past it come back'
);

-- The tables themselves stay shut. This is the whole point of a function.
select throws_ok(
  $$select count(*) from public.trips$$,
  '42501',
  null,
  'anon still has no privilege on trips'
);

select throws_ok(
  $$select count(*) from public.trip_doc_updates$$,
  '42501',
  null,
  'anon still has no privilege on the log'
);

select throws_ok(
  $$select count(*) from public.trip_invites$$,
  '42501',
  null,
  'anon still has no privilege on invites'
);

select throws_ok(
  $$select public.redeem_invite('token-still-valid-01')$$,
  '42501',
  null,
  'anon still cannot redeem: reading never turns into joining'
);

-- ===========================================================================
-- Dead tokens are dead for readers too
-- ===========================================================================

select throws_ok(
  $$select public.read_shared_trip('token-does-not-exist')$$,
  'P0002',
  'invite not found',
  'an unknown token reads nothing'
);

select throws_ok(
  $$select public.read_shared_trip('short')$$,
  'P0002',
  'invite not found',
  'something not shaped like a token is refused the same way'
);

select throws_ok(
  $$select public.read_shared_trip('token-to-be-revoked1')$$,
  'P0001',
  'invite revoked',
  'withdrawing a link stops it being read'
);

select throws_ok(
  $$select public.read_shared_trip('token-expired-000001')$$,
  'P0001',
  'invite expired',
  'an expired link stops being read'
);

select throws_ok(
  $$select public.read_shared_trip('token-spent-00000001')$$,
  'P0001',
  'invite has no uses left',
  'a spent single-use link stops being read'
);

-- ===========================================================================
-- Reading is not joining
-- ===========================================================================

select tests.act_as_postgres();

select is(
  (select uses from public.trip_invites where token = 'token-still-valid-01'),
  0,
  'a read consumes no use'
);

select is(
  (select count(*)::int from public.trip_members
    where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'a read adds nobody to the roster'
);

-- ===========================================================================
-- A snapshot ahead of the cursor is sent, and the log restarts after it
-- ===========================================================================

insert into public.trip_doc_snapshots (trip_id, state, through_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'AAQ=', 102);

select tests.act_as_anon();

select is(
  (public.read_shared_trip('token-still-valid-01')->'snapshot'->>'through_id')::bigint,
  102::bigint,
  'a first read gets the snapshot'
);

select is(
  jsonb_array_length(public.read_shared_trip('token-still-valid-01')->'updates'),
  1,
  'and only the rows the snapshot does not fold'
);

select is(
  public.read_shared_trip('token-still-valid-01', 102)->'snapshot',
  'null'::jsonb,
  'a caller already past through_id is not sent the snapshot again'
);

-- ===========================================================================
-- An account that is not a member reads the same way
-- ===========================================================================

select tests.act_as('22222222-2222-2222-2222-222222222222');

select is(
  (public.read_shared_trip('token-still-valid-01')->'trip'->>'name'),
  'Brittany',
  'a signed-in stranger reads through the token like anyone else'
);

select * from finish();
rollback;
