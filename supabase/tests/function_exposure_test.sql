-- Which SECURITY DEFINER functions a client can reach.
--
-- Supabase's security advisor flagged all four as callable over
-- `/rest/v1/rpc/`. Three of those findings are intended and one was a real
-- oversight; this file pins the resulting shape so neither the oversight nor a
-- re-litigation of the intended ones can happen quietly.
--
-- Run with:  bunx supabase test db

begin;
select plan(22);

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
-- The whole surface, not four functions of it
-- ===========================================================================

-- This file used to name only the four functions the 2026-08-31 hardening
-- migration touched, so it passed green while every function written since
-- kept the project's default `grant all`. Measured on a fresh stack:
-- `store_push_subscription`, `trip_behind_live_invite`, `publish_trip_snapshot`
-- and `subscribe_member_reminders` were all reachable by `anon`, and the first
-- of those carries no authorisation of its own — an unauthenticated caller
-- could subscribe any endpoint to any trip's reminders.
--
-- One assertion over the whole catalogue rather than one per function, so a
-- function added tomorrow is covered by a test written today.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and has_function_privilege('anon', p.oid, 'execute')),
  'read_shared_trip, read_trip_template, subscribe_trip_reminders, unsubscribe_reminders',
  'anon can execute exactly the four doors an invite link opens, and nothing else'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.store_push_subscription(uuid, uuid, jsonb, text, text, text, text)',
    'execute'
  ),
  'the internal subscription writer, which authorises nobody, is closed to anon'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.store_push_subscription(uuid, uuid, jsonb, text, text, text, text)',
    'execute'
  ),
  'and to authenticated: its callers do the authorising, not it'
);

select ok(
  not has_function_privilege('anon', 'public.trip_behind_live_invite(text)', 'execute'),
  'the token oracle is not a client endpoint'
);

select ok(
  not has_function_privilege('anon', 'public.publish_trip_snapshot(uuid, text, bigint)', 'execute'),
  'an unauthenticated caller cannot publish a snapshot over the append-only log'
);

select ok(
  has_function_privilege('authenticated', 'public.publish_trip_snapshot(uuid, text, bigint)', 'execute'),
  'a signed-in member still can'
);

-- ===========================================================================
-- No client privilege on any table, view or sequence
-- ===========================================================================

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'v')
     and has_table_privilege('anon', c.oid, 'select, insert, update, delete')),
  '',
  'anon holds no privilege on any table or view: the functions are the whole surface'
);

select ok(
  not has_sequence_privilege('anon', 'public.trip_doc_updates_id_seq', 'usage, select, update'),
  'the log sequence is closed to anon — setval() moves what every cursor is compared against'
);

select ok(
  not has_sequence_privilege('authenticated', 'public.trip_doc_updates_id_seq', 'usage, select, update'),
  'and to authenticated: rows are inserted through the table policy, which takes the default as owner'
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
