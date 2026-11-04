-- A trip without dates.
--
-- A trip is created without dates, and the organiser sets them later, so the
-- `trips` preview columns accept null. They stay a pair: both set, or both
-- null (`trips_dates_paired`). The ordering check still holds once both are set.
--
-- Its own file, with its own fixtures, because these inserts add rows and the
-- other suites assert on exact counts.
--
-- Run with:  bunx supabase test db

begin;
select plan(7);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

insert into auth.users (id, email, role, aud, instance_id)
values
  ('dddd0001-0000-0000-0000-000000000001', 'undated-owner@example.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

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

select tests.act_as('dddd0001-0000-0000-0000-000000000001');

-- ===========================================================================
-- Inserts, the shape of ensureRemoteTrip's write
-- ===========================================================================

select lives_ok(
  $$insert into public.trips (id, local_id, owner_id, name, start_date, end_date)
    values ('eeee0001-0000-0000-0000-000000000001', 'undated-1',
            'dddd0001-0000-0000-0000-000000000001', 'Undated', null, null)
    returning id$$,
  'an owner uploads a trip without dates, with both dates null'
);

select throws_ok(
  $$insert into public.trips (id, local_id, owner_id, name, start_date, end_date)
    values ('eeee0002-0000-0000-0000-000000000002', 'undated-2',
            'dddd0001-0000-0000-0000-000000000001', 'Half', '2026-07-15', null)$$,
  '23514',
  null,
  'a trip with a start and no end is refused'
);

select throws_ok(
  $$insert into public.trips (id, local_id, owner_id, name, start_date, end_date)
    values ('eeee0003-0000-0000-0000-000000000003', 'undated-3',
            'dddd0001-0000-0000-0000-000000000001', 'Backwards', '2026-07-22', '2026-07-15')$$,
  '23514',
  null,
  'a dated trip still may not end before it starts'
);

-- ===========================================================================
-- Updates, the shape of syncRemoteTripMetadata's write
-- ===========================================================================

select lives_ok(
  $$update public.trips set start_date = '2026-07-15', end_date = '2026-07-22'
    where id = 'eeee0001-0000-0000-0000-000000000001'$$,
  'an owner sets the dates of a trip without dates'
);

select lives_ok(
  $$update public.trips set start_date = null, end_date = null
    where id = 'eeee0001-0000-0000-0000-000000000001'$$,
  'an owner clears them again'
);

select throws_ok(
  $$update public.trips set end_date = '2026-07-22'
    where id = 'eeee0001-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'an update that leaves one date alone is refused'
);

select is(
  (select row(start_date, end_date)::text from public.trips
    where id = 'eeee0001-0000-0000-0000-000000000001'),
  '(,)',
  'the trip is stored without dates'
);

select * from finish();
rollback;
