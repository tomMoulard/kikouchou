-- Row-Level Security tests for per-account guest groups.
--
-- A guest group is private to its owner and has no sharing path at all, which
-- makes the whole claim testable in one sentence: nobody but the owner can see
-- or touch a row. Every assertion below is that sentence from a different angle.
--
-- Run with:  bunx supabase test db

begin;
select plan(16);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

-- Two accounts. There is no third role to model here — no members, no invitees.
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

grant execute on all functions in schema tests to anon, authenticated;

-- ===========================================================================
-- The owner creates a group
-- ===========================================================================

select tests.act_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$insert into public.guest_groups (id, local_id, owner_id, name, members)
    values ('cccccccc-0000-0000-0000-000000000001', 'local-group-1',
            '11111111-1111-1111-1111-111111111111', 'Family',
            '[{"id":"m1","name":"Tom + Léa","color":"#ef4444","headcount":2}]'::jsonb)$$,
  'an owner can create a guest group'
);

select throws_ok(
  $$insert into public.guest_groups (local_id, owner_id, name)
    values ('local-group-x', '22222222-2222-2222-2222-222222222222', 'Not mine')$$,
  '42501',
  'new row violates row-level security policy for table "guest_groups"',
  'a group cannot be created on somebody else''s behalf'
);

select is(
  (select count(*)::int from public.guest_groups),
  1,
  'the owner reads their own group'
);

-- ===========================================================================
-- The constraints that keep a synced row renderable
-- ===========================================================================

select throws_ok(
  $$insert into public.guest_groups (local_id, owner_id, name, members)
    values ('local-group-2', '11111111-1111-1111-1111-111111111111', 'Bad',
            '{"not":"an array"}'::jsonb)$$,
  '23514',
  null,
  'members must be a JSON array'
);

select throws_ok(
  $$insert into public.guest_groups (local_id, owner_id, name, members)
    values ('local-group-3', '11111111-1111-1111-1111-111111111111', 'Huge',
            (select jsonb_agg(jsonb_build_object('id', i::text, 'name', 'G', 'color', '#ef4444'))
               from generate_series(1, 51) i))$$,
  '23514',
  null,
  'a group is capped at 50 members'
);

select throws_ok(
  $$insert into public.guest_groups (local_id, owner_id, name)
    values ('local-group-4', '11111111-1111-1111-1111-111111111111', '')$$,
  '23514',
  null,
  'a group name cannot be empty'
);

select throws_ok(
  $$insert into public.guest_groups (local_id, owner_id, name)
    values ('local-group-1', '11111111-1111-1111-1111-111111111111', 'Duplicate')$$,
  '23505',
  null,
  'one local id maps to exactly one row per owner — the upsert key'
);

-- The upsert the client actually issues resolves to that same row rather than
-- failing, which is what makes a retry and a second tab safe.
select lives_ok(
  $$insert into public.guest_groups (local_id, owner_id, name, updated_at)
    values ('local-group-1', '11111111-1111-1111-1111-111111111111', 'Family renamed', now())
    on conflict (owner_id, local_id)
      do update set name = excluded.name, updated_at = excluded.updated_at$$,
  'the client upsert updates the existing row'
);

select is(
  (select name from public.guest_groups where local_id = 'local-group-1'),
  'Family renamed',
  'and the update actually landed'
);

-- ===========================================================================
-- A stranger reaches nothing
-- ===========================================================================

select tests.act_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.guest_groups),
  0,
  'a stranger reads no group of somebody else'
);

-- An UPDATE narrowed to no rows by RLS succeeds having changed nothing, so the
-- assertion is on the rows affected rather than on an exception.
--
-- `is_empty` rather than counting inside a subquery: a data-modifying statement
-- has to be the top level of its query, so `select (with updated as (update …))`
-- is not merely awkward, it does not parse.
select is_empty(
  $$update public.guest_groups set name = 'Hijacked'
    where id = 'cccccccc-0000-0000-0000-000000000001'
    returning 1$$,
  'a stranger updates no group of somebody else'
);

select is_empty(
  $$delete from public.guest_groups
    where id = 'cccccccc-0000-0000-0000-000000000001'
    returning 1$$,
  'a stranger deletes no group of somebody else'
);

-- ===========================================================================
-- Signed out reaches nothing at all
-- ===========================================================================

select tests.act_as_anon();

select throws_ok(
  $$select * from public.guest_groups$$,
  '42501',
  'permission denied for table guest_groups',
  'anon has no privilege on the table, not merely no rows'
);

select throws_ok(
  $$insert into public.guest_groups (local_id, owner_id, name)
    values ('anon-group', '11111111-1111-1111-1111-111111111111', 'Nope')$$,
  '42501',
  'permission denied for table guest_groups',
  'anon cannot insert'
);

-- ===========================================================================
-- The grants are gone, not merely unused
-- ===========================================================================
--
-- Supabase's default privileges grant `all` on a new table, so an additive
-- grant would leave anon holding everything. Asserted directly, because RLS
-- matching no rows looks identical to a privilege that was never granted right
-- up until somebody adds a permissive policy.

select ok(
  not has_table_privilege('anon', 'public.guest_groups', 'select'),
  'anon holds no SELECT on guest_groups'
);

select ok(
  not has_table_privilege('anon', 'public.guest_groups', 'insert'),
  'anon holds no INSERT on guest_groups'
);

select * from finish();
rollback;
