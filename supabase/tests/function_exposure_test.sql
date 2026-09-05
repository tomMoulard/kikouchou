-- Which SECURITY DEFINER functions a client can reach.
--
-- Supabase's security advisor flagged all four as callable over
-- `/rest/v1/rpc/`. Three of those findings are intended and one was a real
-- oversight; this file pins the resulting shape so neither the oversight nor a
-- re-litigation of the intended ones can happen quietly.
--
-- Run with:  bunx supabase test db

begin;
select plan(13);

-- ===========================================================================
-- Where the functions live
-- ===========================================================================

select is(
  (select n.nspname
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'is_trip_member'),
  'private',
  'is_trip_member lives outside the exposed schema, so it has no REST endpoint'
);

select is(
  (select n.nspname
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'add_owner_as_trip_member'),
  'private',
  'the owner trigger function lives outside the exposed schema'
);

select is(
  (select n.nspname
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'redeem_invite'),
  'public',
  'redeem_invite stays in public: it is the join flow, and it is meant to be called'
);

select is(
  (select n.nspname
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'revoke_invite'),
  'public',
  'revoke_invite stays in public: it is how a member un-shares a trip'
);

-- ===========================================================================
-- Who holds EXECUTE
-- ===========================================================================

select ok(
  not has_function_privilege('anon', 'private.is_trip_member(uuid)', 'execute'),
  'anon cannot execute is_trip_member'
);

select ok(
  has_function_privilege('authenticated', 'private.is_trip_member(uuid)', 'execute'),
  'authenticated keeps EXECUTE on is_trip_member — every policy calling it needs that'
);

select ok(
  not has_function_privilege('anon', 'private.add_owner_as_trip_member()', 'execute'),
  'anon cannot execute the owner trigger function — this was the real oversight'
);

select ok(
  not has_function_privilege('authenticated', 'private.add_owner_as_trip_member()', 'execute'),
  'no client role can execute the owner trigger function'
);

select ok(
  not has_function_privilege('anon', 'public.redeem_invite(text)', 'execute'),
  'an unauthenticated caller cannot redeem an invite'
);

select ok(
  has_function_privilege('authenticated', 'public.redeem_invite(text)', 'execute'),
  'a signed-in caller can redeem an invite'
);

select ok(
  not has_function_privilege('anon', 'public.revoke_invite(text)', 'execute'),
  'an unauthenticated caller cannot revoke an invite'
);

-- ===========================================================================
-- The policies still work, and revoke_invite still resolves its helper
-- ===========================================================================

insert into auth.users (id, email, role, aud, instance_id)
values ('55555555-5555-5555-5555-555555555555', 'exposure@example.test',
        'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

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

select tests.act_as('55555555-5555-5555-5555-555555555555');

insert into public.trips (id, local_id, owner_id, name, start_date, end_date)
values ('55555555-0000-0000-0000-000000000001', 'exposure',
        '55555555-5555-5555-5555-555555555555', 'Exposure', '2026-07-15', '2026-07-22');

-- Reading through a policy that calls the moved function.
select is(
  (select count(*)::int from public.trips),
  1,
  'moving the helper did not break the policies that call it'
);

-- revoke_invite() names its helper as text, so the move would have broken it at
-- run time had the migration not recreated it.
insert into public.trip_invites (token, trip_id, created_by)
values ('exposure-token-00001', '55555555-0000-0000-0000-000000000001',
        '55555555-5555-5555-5555-555555555555');

select lives_ok(
  $$select public.revoke_invite('exposure-token-00001')$$,
  'revoke_invite still resolves its helper after the schema move'
);

select * from finish();
rollback;
