-- Snapshot publishing, now that a client does it rather than an Edge Function.
--
-- The function is the only thing standing between a member and the log's DELETE
-- privilege, which is deliberately never granted. Every guard it makes is
-- therefore load-bearing, and each one is asserted here: membership, the
-- monotonic head, the claim never exceeding the log, and the ordering that keeps
-- a prune behind a snapshot that actually covers it.
--
-- Run with:  bunx supabase test db

begin;
select plan(14);

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

grant execute on all functions in schema tests to anon, authenticated;

-- Built before assuming any role, while the session is still privileged.
--
-- `trip_members` has no INSERT policy — joining goes through `redeem_invite`,
-- and `trip_sync_rls_test.sql` asserts that a direct insert is refused — so a
-- fixture that tried to add the second member as `authenticated` would be denied
-- rather than set up.
insert into public.trips (id, local_id, owner_id, name, start_date, end_date)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'local-1',
        '11111111-1111-1111-1111-111111111111', 'Brittany', '2026-07-15', '2026-07-22');

-- The owner's own roster row comes from an AFTER INSERT trigger on `trips`, so
-- this only fills in the second member.
insert into public.trip_members (trip_id, user_id)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111'),
       ('aaaaaaaa-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222')
on conflict (trip_id, user_id) do nothing;

-- 120 log rows, so pruning has something to bite on either side of the margin.
insert into public.trip_doc_updates (trip_id, author_id, update)
select 'aaaaaaaa-0000-0000-0000-000000000001',
       '11111111-1111-1111-1111-111111111111',
       'AAAA'
from generate_series(1, 120);

-- Ids are read back rather than assumed to start at 1. `id` is `generated always
-- as identity`, and an identity sequence is not rolled back with the
-- transaction — so any earlier test file that inserted a log row leaves this one
-- starting from wherever that got to. Hard-coding 1..120 would make these
-- assertions pass only against a pristine database.
create temporary table log_ids as
select min(id) as lo, max(id) as hi
from public.trip_doc_updates
where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- Created while privileged, read while acting as a member, so the grant is not
-- optional: without it every assertion below dies with `permission denied for
-- table log_ids` rather than testing anything.
grant select on log_ids to authenticated;

-- ===========================================================================
-- The privilege that must not exist
-- ===========================================================================

select ok(
  not has_table_privilege('authenticated', 'public.trip_doc_updates', 'DELETE'),
  'members still hold no DELETE on the log'
);

select ok(
  not has_table_privilege('authenticated', 'public.trip_doc_snapshots', 'INSERT'),
  'members still hold no INSERT on snapshots'
);

select ok(
  not has_table_privilege('authenticated', 'public.trip_doc_snapshots', 'UPDATE'),
  'members still hold no UPDATE on snapshots'
);

-- ===========================================================================
-- A member may publish
-- ===========================================================================

select tests.act_as('22222222-2222-2222-2222-222222222222');

-- Claims through row 100 of 120. With a 50-row margin that prunes ids <= 50.
select lives_ok(
  $$select public.publish_trip_snapshot(
      'aaaaaaaa-0000-0000-0000-000000000001', 'QUFB',
      (select lo + 99 from log_ids))$$,
  'a member can publish a snapshot for a trip they are on'
);

select is(
  (select through_id from public.trip_doc_snapshots
   where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  (select lo + 99 from log_ids),
  'the head records what was claimed'
);

select is(
  (select count(*) from public.trip_doc_updates
   where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and id <= (select lo + 49 from log_ids)),
  0::bigint,
  'rows behind the margin are pruned'
);

select ok(
  (select count(*) from public.trip_doc_updates
   where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and id between (select lo + 50 from log_ids)
                and (select lo + 99 from log_ids)) > 0,
  'the margin of recent rows the snapshot covers is kept, as the recovery window'
);

-- ===========================================================================
-- The head only moves forward
-- ===========================================================================

select is(
  (select public.publish_trip_snapshot(
     'aaaaaaaa-0000-0000-0000-000000000001', 'QkJC',
     (select lo + 59 from log_ids))),
  0::bigint,
  'an older claim is refused rather than moving the head backwards'
);

select is(
  (select through_id from public.trip_doc_snapshots
   where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  (select lo + 99 from log_ids),
  'the head is unchanged by the refused claim'
);

select is(
  (select state from public.trip_doc_snapshots
   where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'QUFB',
  'and so is the state: a refused claim must not overwrite a newer snapshot'
);

-- ===========================================================================
-- Claims are bounded by the log
-- ===========================================================================

select throws_ok(
  $$select public.publish_trip_snapshot(
      'aaaaaaaa-0000-0000-0000-000000000001', 'QkJC',
      (select hi + 1 from log_ids))$$,
  '22023',
  null,
  'a claim beyond the log is refused'
);

-- ===========================================================================
-- Non-members
-- ===========================================================================

select tests.act_as('33333333-3333-3333-3333-333333333333');

select throws_ok(
  $$select public.publish_trip_snapshot(
      'aaaaaaaa-0000-0000-0000-000000000001', 'QkJC',
      (select lo + 109 from log_ids))$$,
  '42501',
  null,
  'somebody who is not on the trip cannot publish, definer rights notwithstanding'
);

-- Back to a member to read the head. The stranger cannot see the snapshot at
-- all — `trip_doc_snapshots` restricts SELECT to members, so asserting from that
-- role returned NULL and tested the RLS policy rather than the head. Which is
-- itself worth stating, so it is asserted first.
select is(
  (select count(*) from public.trip_doc_snapshots
   where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0::bigint,
  'a non-member cannot see the trip''s snapshot either'
);

select tests.act_as('22222222-2222-2222-2222-222222222222');

select is(
  (select through_id from public.trip_doc_snapshots
   where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  (select lo + 99 from log_ids),
  'and the head is untouched by the attempt'
);

select * from finish();
rollback;
