-- Row-Level Security tests for per-account trip archives.
--
-- An archive row is private to its account, and an account files one only for
-- a trip it belongs to. Every assertion below is one of those two rules from a
-- different angle.
--
-- Run with:  bunx supabase test db

begin;
select plan(13);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

insert into auth.users (id, email, role, aud, instance_id)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test',    'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222', 'member@example.test',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('33333333-3333-3333-3333-333333333333', 'stranger@example.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

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

-- One trip with an owner and a member. The insert trigger makes the owner a
-- member; the second member is added directly, as redeem_invite would.
insert into public.trips (id, local_id, owner_id, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'local-1',
        '11111111-1111-1111-1111-111111111111', 'Brittany');

insert into public.trip_members (trip_id, user_id, joined_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', now());

-- ===========================================================================
-- A member archives the trip for themselves
-- ===========================================================================

select tests.act_as('22222222-2222-2222-2222-222222222222');

select lives_ok(
  $$insert into public.trip_archives (user_id, trip_id, archived, updated_at)
    values ('22222222-2222-2222-2222-222222222222',
            'aaaaaaaa-0000-0000-0000-000000000001', true, now())$$,
  'a member can archive a trip for themselves'
);

select lives_ok(
  $$insert into public.trip_archives (user_id, trip_id, archived, updated_at)
    values ('22222222-2222-2222-2222-222222222222',
            'aaaaaaaa-0000-0000-0000-000000000001', false, now())
    on conflict (user_id, trip_id) do update
      set archived = excluded.archived, updated_at = excluded.updated_at$$,
  'the client upsert takes a trip back out of the archive'
);

select is(
  (select archived from public.trip_archives),
  false,
  'a member reads their own row back'
);

select throws_ok(
  $$insert into public.trip_archives (user_id, trip_id, archived, updated_at)
    values ('11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000001', true, now())$$,
  '42501',
  null,
  'a member cannot archive a trip on behalf of another member'
);

select throws_ok(
  $$delete from public.trip_archives$$,
  '42501',
  null,
  'a client holds no DELETE on archive rows'
);

-- ===========================================================================
-- Nobody else sees it
-- ===========================================================================

select tests.act_as('11111111-1111-1111-1111-111111111111');

select is(
  (select count(*)::int from public.trip_archives),
  0,
  'another member of the same trip does not see the row'
);

select lives_ok(
  $$update public.trip_archives set archived = true$$,
  'an update aimed at another member''s row runs'
);

select tests.act_as_postgres();

select is(
  (select archived from public.trip_archives
   where user_id = '22222222-2222-2222-2222-222222222222'),
  false,
  'and changes nothing, because the row is outside the caller''s policy'
);

select tests.act_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$update public.trip_archives
    set user_id = '33333333-3333-3333-3333-333333333333'$$,
  '42501',
  null,
  'a member cannot hand their row to another account'
);

-- ===========================================================================
-- A stranger cannot file a row against a trip they do not belong to
-- ===========================================================================

select tests.act_as('33333333-3333-3333-3333-333333333333');

select throws_ok(
  $$insert into public.trip_archives (user_id, trip_id, archived, updated_at)
    values ('33333333-3333-3333-3333-333333333333',
            'aaaaaaaa-0000-0000-0000-000000000001', true, now())$$,
  '42501',
  null,
  'a stranger cannot archive a trip they are not a member of'
);

select is(
  (select count(*)::int from public.trip_archives),
  0,
  'a stranger sees no row'
);

select tests.act_as_anon();

select throws_ok(
  $$select count(*) from public.trip_archives$$,
  '42501',
  null,
  'anon holds no privilege on the table'
);

-- ===========================================================================
-- The rows go with the trip
-- ===========================================================================

select tests.act_as_postgres();

delete from public.trips where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.trip_archives),
  0,
  'deleting a trip deletes its archive rows'
);

select * from finish();
rollback;
