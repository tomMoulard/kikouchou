-- Row-Level Security and statistics tests for per-account achievements.
--
-- Two claims. A row is private to its owner, and permanent: no client can
-- change or remove one. And `achievement_stats()` answers a percent per key
-- over the accounts that are not anonymous, and nothing else.
--
-- Run with:  bunx supabase test db

begin;
select plan(17);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

-- Four real accounts and one anonymous session. The test database holds no
-- other account, so the percentages below are exact.
insert into auth.users (id, email, role, aud, instance_id, is_anonymous)
values
  ('11111111-1111-1111-1111-111111111111', 'one@example.test',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', false),
  ('22222222-2222-2222-2222-222222222222', 'two@example.test',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', false),
  ('33333333-3333-3333-3333-333333333333', 'three@example.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', false),
  ('44444444-4444-4444-4444-444444444444', 'four@example.test',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', false),
  ('55555555-5555-5555-5555-555555555555', null,                 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', true);

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
-- An owner records their own achievements
-- ===========================================================================

select tests.act_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$insert into public.achievements (owner_id, key, unlocked_at)
    values ('11111111-1111-1111-1111-111111111111', 'trips_1', now()),
           ('11111111-1111-1111-1111-111111111111', 'midnight_pet', now())$$,
  'an owner can record their achievements'
);

select lives_ok(
  $$insert into public.achievements (owner_id, key, unlocked_at)
    values ('11111111-1111-1111-1111-111111111111', 'trips_1', now())
    on conflict do nothing$$,
  'uploading an achievement already held is a no-op, which is how every device uploads'
);

select throws_ok(
  $$insert into public.achievements (owner_id, key, unlocked_at)
    values ('22222222-2222-2222-2222-222222222222', 'trips_1', now())$$,
  '42501',
  null,
  'an account cannot record an achievement for another account'
);

select throws_ok(
  $$insert into public.achievements (owner_id, key, unlocked_at)
    values ('11111111-1111-1111-1111-111111111111', 'Not A Key!', now())$$,
  '23514',
  null,
  'a key must be a short lowercase identifier'
);

select throws_ok(
  $$insert into public.achievements (owner_id, key, unlocked_at)
    values ('11111111-1111-1111-1111-111111111111', 'trips_3', now() + interval '1 year')$$,
  '23514',
  null,
  'an unlock date in the future is refused'
);

select throws_ok(
  $$update public.achievements set key = 'trips_1000'
    where owner_id = '11111111-1111-1111-1111-111111111111'$$,
  '42501',
  null,
  'an unlock cannot be changed'
);

select throws_ok(
  $$delete from public.achievements
    where owner_id = '11111111-1111-1111-1111-111111111111'$$,
  '42501',
  null,
  'an unlock cannot be removed by a client'
);

-- ===========================================================================
-- Nobody else reads them
-- ===========================================================================

select tests.act_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*) from public.achievements)::integer,
  0,
  'another account sees none of the owner''s achievements'
);

select lives_ok(
  $$insert into public.achievements (owner_id, key, unlocked_at)
    values ('22222222-2222-2222-2222-222222222222', 'trips_1', now())$$,
  'a second account records its own'
);

-- The anonymous session records one too. It must count for nothing.
select tests.act_as('55555555-5555-5555-5555-555555555555');

select lives_ok(
  $$insert into public.achievements (owner_id, key, unlocked_at)
    values ('55555555-5555-5555-5555-555555555555', 'trips_1', now()),
           ('55555555-5555-5555-5555-555555555555', 'polyglot', now())$$,
  'an anonymous session can record its own achievements'
);

-- ===========================================================================
-- achievement_stats()
-- ===========================================================================

select tests.act_as('33333333-3333-3333-3333-333333333333');

-- Four real accounts: two hold trips_1 (50%), one holds midnight_pet (25%).
-- The anonymous session's rows count on neither side, so polyglot is absent.
select results_eq(
  $$select key, percent from public.achievement_stats()$$,
  $$values ('midnight_pet'::text, 25), ('trips_1'::text, 50)$$,
  'stats answer the share of real accounts per key, and ignore anonymous ones'
);

select is(
  (select count(*) from public.achievement_stats() where key = 'polyglot')::integer,
  0,
  'a key held only by an anonymous session does not appear'
);

select tests.act_as_anon();

select throws_ok(
  $$select * from public.achievement_stats()$$,
  '42501',
  null,
  'anon cannot ask for the stats'
);

select throws_ok(
  $$select count(*) from public.achievements$$,
  '42501',
  null,
  'anon cannot read the table'
);

reset role;

select ok(
  not has_table_privilege('anon', 'public.achievements', 'insert'),
  'anon holds no INSERT on achievements'
);

select ok(
  not has_table_privilege('authenticated', 'public.achievements', 'update'),
  'authenticated holds no UPDATE on achievements'
);

-- ===========================================================================
-- The rows leave with the account
-- ===========================================================================

delete from auth.users where id = '11111111-1111-1111-1111-111111111111';

select is(
  (select count(*) from public.achievements
   where owner_id = '11111111-1111-1111-1111-111111111111')::integer,
  0,
  'a deleted account''s achievements go with it'
);

select * from finish();
rollback;
