-- Invite lifecycle tests.
--
-- An invite is a bearer credential for a trip, so each way it can stop being
-- valid needs to actually stop working: revoked, expired, used up. The previous
-- scheme had none of these — a room id and key sat in a URL fragment forever.
--
-- Run with:  bunx supabase test db

begin;
select plan(14);

-- ===========================================================================
-- Fixtures
-- ===========================================================================

insert into auth.users (id, email, role, aud, instance_id)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test',   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222', 'guest1@example.test',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('33333333-3333-3333-3333-333333333333', 'guest2@example.test',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('44444444-4444-4444-4444-444444444444', 'guest3@example.test',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

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

-- The owner sets up a trip and four differently-flawed invites.
select tests.act_as('11111111-1111-1111-1111-111111111111');

insert into public.trips (id, local_id, owner_id, name, start_date, end_date)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'local-1',
        '11111111-1111-1111-1111-111111111111', 'Brittany', '2026-07-15', '2026-07-22');

insert into public.trip_invites (token, trip_id, created_by, expires_at, max_uses)
values
  ('token-still-valid-01', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, null),
  ('token-expired-000001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', now() - interval '1 hour', null),
  ('token-single-use-001', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, 1),
  ('token-to-be-revoked1', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', null, null);

-- ===========================================================================
-- Expiry
-- ===========================================================================

select tests.act_as('22222222-2222-2222-2222-222222222222');

select throws_ok(
  $$select public.redeem_invite('token-expired-000001')$$,
  'P0001',
  'invite expired',
  'an expired invite cannot be redeemed'
);

select is((select count(*)::int from public.trips), 0,
  'a failed redemption grants nothing');

-- ===========================================================================
-- Revocation
-- ===========================================================================

select tests.act_as('11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$select public.revoke_invite('token-to-be-revoked1')$$,
  'a member can revoke an invite'
);

select isnt(
  (select revoked_at from public.trip_invites where token = 'token-to-be-revoked1'),
  null,
  'revoking stamps revoked_at'
);

select tests.act_as('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$select public.redeem_invite('token-to-be-revoked1')$$,
  'P0001',
  'invite revoked',
  'a revoked invite cannot be redeemed'
);

-- A stranger must not be able to revoke someone else's invite, and must not
-- learn whether a token exists either way.
select tests.act_as('44444444-4444-4444-4444-444444444444');
select throws_ok(
  $$select public.revoke_invite('token-still-valid-01')$$,
  '42501',
  'not a member of this trip',
  'a non-member cannot revoke an invite'
);

select lives_ok(
  $$select public.revoke_invite('token-does-not-exist')$$,
  'revoking an unknown token is quiet, so it is not an enumeration oracle'
);

-- ===========================================================================
-- Use caps
-- ===========================================================================

select tests.act_as('22222222-2222-2222-2222-222222222222');
select is(
  public.redeem_invite('token-single-use-001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'a single-use invite works once'
);

select is(
  (select uses from public.trip_invites where token = 'token-single-use-001'),
  1,
  'redeeming consumes a use'
);

-- The same person returning must still get in, even though the cap is spent.
select is(
  public.redeem_invite('token-single-use-001'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'an exhausted invite still readmits a member who already joined with it'
);

select tests.act_as('33333333-3333-3333-3333-333333333333');
select throws_ok(
  $$select public.redeem_invite('token-single-use-001')$$,
  'P0001',
  'invite has no uses left',
  'a second person cannot use a spent single-use invite'
);

-- ===========================================================================
-- The still-valid invite
-- ===========================================================================

select is(
  public.redeem_invite('token-still-valid-01'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'an uncapped, unexpired, unrevoked invite admits a new member'
);

select is((select count(*)::int from public.trips), 1,
  'the new member can read the trip');

select is(
  (select count(*)::int from public.trip_members
   where trip_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  3,
  'the roster holds the owner and both admitted guests'
);

select * from finish();
rollback;
