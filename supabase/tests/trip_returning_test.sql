-- INSERT ... RETURNING under RLS.
--
-- Its own file, with its own fixtures, because these inserts add rows and the
-- other suites assert on exact counts — an additive test should not shift an
-- existing expectation.
--
-- ## Why this file exists
--
-- Sharing a trip failed in a browser with:
--
--   new row violates row-level security policy for table "trips"
--
-- which reads like the insert's WITH CHECK rejecting the row. It was not: a
-- plain insert succeeded and only `insert ... returning id` failed.
--
-- **RETURNING is subject to the SELECT policy.** PostgREST's
-- `.insert(...).select('id').single()` becomes `INSERT ... RETURNING id`, and the
-- SELECT policy on `trips` required a `trip_members` row — which is created by
-- an AFTER INSERT trigger that has not fired when RETURNING is evaluated. So the
-- owner could create a trip and never read back its id.
--
-- Nothing covered RETURNING, so it reached a browser. Every insert the client
-- makes with `.select()` is asserted here.
--
-- Run with:  bunx supabase test db

begin;
select plan(6);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

insert into auth.users (id, email, role, aud, instance_id)
values
  ('aaaa0001-0000-0000-0000-000000000001', 'returning-owner@example.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('aaaa0002-0000-0000-0000-000000000002', 'returning-other@example.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

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

select tests.act_as('aaaa0001-0000-0000-0000-000000000001');

-- ===========================================================================
-- trips — the one that broke
-- ===========================================================================

-- The exact shape of ensureRemoteTrip's write.
select lives_ok(
  $$insert into public.trips (id, local_id, owner_id, name, start_date, end_date)
    values ('bbbb0001-0000-0000-0000-000000000001', 'returning-1',
            'aaaa0001-0000-0000-0000-000000000001', 'Returning', '2026-07-15', '2026-07-22')
    returning id$$,
  'an owner inserts a trip and reads its id back in the same statement'
);

select is(
  (select count(*)::int from public.trips where id = 'bbbb0001-0000-0000-0000-000000000001'),
  1,
  'and the trip is readable afterwards'
);

-- The owner branch of the policy must not leak other people's trips.
select tests.act_as('aaaa0002-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.trips where id = 'bbbb0001-0000-0000-0000-000000000001'),
  0,
  'admitting the owner directly does not expose the trip to anybody else'
);

-- ===========================================================================
-- The other client inserts that use .select()
-- ===========================================================================

select tests.act_as('aaaa0001-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into public.trip_invites (token, trip_id, created_by)
    values ('returning-invite-0001', 'bbbb0001-0000-0000-0000-000000000001',
            'aaaa0001-0000-0000-0000-000000000001')
    returning token, created_at, expires_at, max_uses, uses, revoked_at$$,
  'createInvite reads back every column it selects'
);

select lives_ok(
  $$insert into public.trip_doc_updates (trip_id, "update")
    values ('bbbb0001-0000-0000-0000-000000000001', 'AQIDBA==')
    returning id$$,
  'appending to the log can read the row back'
);

select lives_ok(
  $$update public.trip_members set person_id = 'person-returning'
    where trip_id = 'bbbb0001-0000-0000-0000-000000000001'
      and user_id = 'aaaa0001-0000-0000-0000-000000000001'
    returning person_id$$,
  'claiming an identity can read the result back'
);

select * from finish();
rollback;
