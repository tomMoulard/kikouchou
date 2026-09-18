-- read_trip_template(): the second door anon may open, and what stays shut.
--
-- Two properties are load-bearing here. A stranger holding a live template
-- token reads the five published fields of that template and nothing else —
-- no guest, no date, no document, no other trip. And a template is the owner's
-- to publish: a member of the trip is not a publisher, and neither is anyone
-- else.
--
-- Run with:  bunx supabase test db

begin;
select plan(21);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

insert into auth.users (id, email, role, aud, instance_id)
values
  ('11111111-1111-1111-1111-111111111111', 'hotel@example.test',    'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
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

-- The hotel publishes one trip and keeps a second one private.
select tests.act_as('11111111-1111-1111-1111-111111111111');

insert into public.trips (id, local_id, owner_id, name, start_date, end_date,
                          is_template, template_token)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'local-1',
   '11111111-1111-1111-1111-111111111111', 'Chalet Marmotte',
   '2026-07-15', '2026-07-22', true,  'template-token-00001'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'local-2',
   '11111111-1111-1111-1111-111111111111', 'Staff weekend',
   '2026-08-01', '2026-08-03', false, 'template-token-00002');

insert into public.trip_templates
  (trip_id, name, description, location, latitude, longitude, currency, rooms)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Chalet Marmotte',
   'Check-in after 3pm. Bring indoor shoes.', 'Chamonix',
   45.9237, 6.8694, 'EUR',
   '[{"name": "Attic", "capacity": 4, "order": 0},
     {"name": "Suite", "capacity": 2, "order": 1}]'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Staff weekend',
   null, null, null, null, null, '[]'::jsonb);

-- ===========================================================================
-- anon reads a published template, and nothing else
-- ===========================================================================

select tests.act_as_anon();

select is(
  (public.read_trip_template('template-token-00001')->>'name'),
  'Chalet Marmotte',
  'anon reads the template behind a live token'
);

select is(
  (public.read_trip_template('template-token-00001')->>'description'),
  'Check-in after 3pm. Bring indoor shoes.',
  'the description comes back: it is what guides the customer'
);

select is(
  (public.read_trip_template('template-token-00001')->'coordinates'->>'lat')::numeric,
  45.9237::numeric,
  'the map pin comes back as a lat/lon object'
);

select is(
  (public.read_trip_template('template-token-00001')->>'currency'),
  'EUR',
  'the currency comes back'
);

select is(
  jsonb_array_length(public.read_trip_template('template-token-00001')->'rooms'),
  2,
  'every room comes back'
);

select is(
  (public.read_trip_template('template-token-00001')->'rooms'->0->>'name'),
  'Attic',
  'a room keeps its name and its shape'
);

-- The payload is a fixed set of keys. A date or a guest appearing here would
-- be a leak, and the assertion is cheap enough to keep forever.
select is(
  (select array_agg(key order by key)
   from jsonb_object_keys(public.read_trip_template('template-token-00001')) as key),
  array['coordinates', 'currency', 'description', 'location', 'name', 'rooms'],
  'the payload holds six keys, and no date, guest or document among them'
);

-- The tables themselves stay shut. This is the whole point of a function.
select throws_ok(
  $$select count(*) from public.trip_templates$$,
  '42501',
  null,
  'anon still has no privilege on trip_templates'
);

select throws_ok(
  $$select count(*) from public.trips$$,
  '42501',
  null,
  'anon still has no privilege on trips'
);

-- ===========================================================================
-- Every dead end says the same thing
-- ===========================================================================

select throws_ok(
  $$select public.read_trip_template('template-token-00002')$$,
  'P0002',
  'template not found',
  'a trip that is not published reads as not found'
);

select throws_ok(
  $$select public.read_trip_template('template-token-99999')$$,
  'P0002',
  'template not found',
  'an unknown token reads as not found'
);

select throws_ok(
  $$select public.read_trip_template('short')$$,
  'P0002',
  'template not found',
  'something not shaped like a token is refused the same way'
);

select throws_ok(
  $$select public.read_trip_template(null)$$,
  'P0002',
  'template not found',
  'a null token is refused the same way'
);

-- ===========================================================================
-- Unpublishing kills every copy of the link, and republishing revives it
-- ===========================================================================

select tests.act_as('11111111-1111-1111-1111-111111111111');

update public.trips set is_template = false
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select tests.act_as_anon();

select throws_ok(
  $$select public.read_trip_template('template-token-00001')$$,
  'P0002',
  'template not found',
  'unpublishing closes the link that was already handed out'
);

select tests.act_as('11111111-1111-1111-1111-111111111111');

update public.trips set is_template = true
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select tests.act_as_anon();

select is(
  (public.read_trip_template('template-token-00001')->>'name'),
  'Chalet Marmotte',
  'republishing revives the same link, because the token was kept'
);

-- ===========================================================================
-- Publishing is the owner's, and the row is the owner's
-- ===========================================================================

select tests.act_as('22222222-2222-2222-2222-222222222222');

select is(
  (select count(*)::int from public.trip_templates),
  0,
  'a stranger reads no template row, however many exist'
);

select throws_ok(
  $$insert into public.trip_templates (trip_id, name)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'Hijacked')$$,
  '42501',
  null,
  'a stranger cannot publish somebody else''s trip'
);

select tests.act_as_postgres();

select is(
  (select name from public.trip_templates
    where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Chalet Marmotte',
  'and the row is unchanged'
);

-- ===========================================================================
-- The bounds hold
-- ===========================================================================

select throws_ok(
  $$insert into public.trip_templates (trip_id, name, rooms)
    values ('aaaaaaaa-0000-0000-0000-000000000003', 'Too many',
            (select jsonb_agg(jsonb_build_object('name', n::text))
             from generate_series(1, 51) as n))$$,
  '23514',
  null,
  'more than fifty rooms is refused by a check, not by the client'
);

select throws_ok(
  $$insert into public.trip_templates (trip_id, name, currency)
    values ('aaaaaaaa-0000-0000-0000-000000000003', 'Bad money', 'euros')$$,
  '23514',
  null,
  'a currency that is not three capitals is refused'
);

-- ===========================================================================
-- The token is unique across trips
-- ===========================================================================

select throws_ok(
  $$insert into public.trips (local_id, owner_id, name, start_date, end_date, template_token)
    values ('local-3', '11111111-1111-1111-1111-111111111111', 'Clash',
            '2026-09-01', '2026-09-02', 'template-token-00001')$$,
  '23505',
  null,
  'two trips cannot share one template token'
);

select * from finish();
rollback;
