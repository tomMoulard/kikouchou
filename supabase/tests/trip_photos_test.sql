-- The trip-photos bucket: who reads and who adds a cover photo.
--
-- Two properties are load-bearing. A trip's photos are its members' and
-- nobody else's. And a template's photos are read with the template token,
-- only while the template is published, and only for the photos its payload
-- names.
--
-- Run with:  bunx supabase test db

begin;
select plan(16);

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

-- The owner's trip, shared with one member, and published as a template.
insert into public.trips (id, local_id, owner_id, name, start_date, end_date,
                          is_template, template_token)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'local-1',
   '11111111-1111-1111-1111-111111111111', 'Chalet',
   '2026-07-15', '2026-07-22', true, 'template-token-00001'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'local-2',
   '11111111-1111-1111-1111-111111111111', 'Unpublished',
   '2026-08-01', '2026-08-03', false, 'template-token-00002');

insert into public.trip_members (trip_id, user_id, joined_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', now());

insert into public.trip_templates (trip_id, name, photo_id, rooms)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Chalet', 'coverPhoto0001',
   '[{"name": "Red room", "capacity": 2, "order": 0, "photoId": "roomPhoto0001"}]'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Unpublished', 'coverPhoto0002', '[]'::jsonb);

insert into storage.objects (bucket_id, name)
values
  ('trip-photos', 'trips/aaaaaaaa-0000-0000-0000-000000000001/coverPhoto0001'),
  ('trip-photos', 'templates/template-token-00001/coverPhoto0001'),
  ('trip-photos', 'templates/template-token-00001/roomPhoto0001'),
  ('trip-photos', 'templates/template-token-00001/replacedPhoto01'),
  ('trip-photos', 'templates/template-token-00002/coverPhoto0002');

-- ===========================================================================
-- The bucket
-- ===========================================================================

select is(
  (select public from storage.buckets where id = 'trip-photos'),
  false,
  'the bucket is private: every read goes through a policy'
);

select is(
  (select file_size_limit from storage.buckets where id = 'trip-photos'),
  2097152::bigint,
  'one photo is capped at 2 MiB'
);

-- ===========================================================================
-- trips/<trip id>/: members only
-- ===========================================================================

select tests.act_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from storage.objects
   where name = 'trips/aaaaaaaa-0000-0000-0000-000000000001/coverPhoto0001'),
  1,
  'a member reads the trip''s photo'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('trip-photos', 'trips/aaaaaaaa-0000-0000-0000-000000000001/memberPhoto01')$$,
  'a member adds a photo to the trip'
);

-- No UPDATE policy, so the update matches no row rather than raising.
update storage.objects
set name = 'trips/aaaaaaaa-0000-0000-0000-000000000001/renamed000001'
where name = 'trips/aaaaaaaa-0000-0000-0000-000000000001/coverPhoto0001';

select is(
  (select count(*)::int from storage.objects
   where name = 'trips/aaaaaaaa-0000-0000-0000-000000000001/coverPhoto0001'),
  1,
  'no client overwrites a photo: there is no UPDATE policy'
);

select tests.act_as('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from storage.objects
   where name like 'trips/%'),
  0,
  'a stranger reads no trip photo'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('trip-photos', 'trips/aaaaaaaa-0000-0000-0000-000000000001/strangerPhoto1')$$,
  '42501',
  null,
  'a stranger cannot add a photo to somebody else''s trip'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('trip-photos', 'loose/strangerPhoto1')$$,
  '42501',
  null,
  'nothing is written outside the two prefixes'
);

-- ===========================================================================
-- templates/<token>/: the owner adds, the link reads
-- ===========================================================================

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('trip-photos', 'templates/template-token-00001/strangerPhoto1')$$,
  '42501',
  null,
  'a stranger cannot add a photo to somebody else''s template'
);

select tests.act_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('trip-photos', 'templates/template-token-00001/memberPhoto01')$$,
  '42501',
  null,
  'a member is not a publisher'
);

select tests.act_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('trip-photos', 'templates/template-token-00001/ownerPhoto0001')$$,
  'the owner adds a template photo'
);

select tests.act_as_anon();

select is(
  (select array_agg(name order by name) from storage.objects),
  array[
    'templates/template-token-00001/coverPhoto0001',
    'templates/template-token-00001/roomPhoto0001'
  ],
  'anon reads the cover and the room photo the published payload names, and nothing else'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('trip-photos', 'templates/template-token-00001/anonPhoto0001')$$,
  '42501',
  null,
  'anon adds nothing'
);

-- Unpublishing kills the photos with the link.
select tests.act_as_postgres();
update public.trips set is_template = false
where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select tests.act_as_anon();

select is(
  (select count(*)::int from storage.objects),
  0,
  'an unpublished template serves no photo'
);

-- ===========================================================================
-- The one private function anon may execute
-- ===========================================================================

select tests.act_as_postgres();

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.prokind = 'f'
     and has_function_privilege('anon', p.oid, 'execute')),
  'is_published_template_photo',
  'anon can execute exactly one function in private: the template photo read rule'
);

select ok(
  not has_function_privilege('anon', 'private.my_trip_ids()', 'execute'),
  'anon still cannot execute my_trip_ids'
);

select * from finish();
rollback;
