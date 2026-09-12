-- Hardening: get the internal helpers out of the exposed API surface.
--
-- Supabase's security advisor flagged all four `security definer` functions as
-- callable over `/rest/v1/rpc/`. Triaged one at a time, because the answers
-- differ and three of the four findings are working as intended:
--
--   private.is_trip_member(uuid)        internal — moved out of the API
--   private.add_owner_as_trip_member()  internal — moved out, EXECUTE revoked
--   public.redeem_invite(text)          intentional RPC: this *is* the join flow
--   public.revoke_invite(text)          intentional RPC: this *is* un-sharing
--
-- All four genuinely need SECURITY DEFINER, so "switch to SECURITY INVOKER" is
-- not available for any of them:
--   * is_trip_member reads trip_members from inside trip_members' own policy;
--     as invoker that re-enters the policy and recurses.
--   * add_owner_as_trip_member inserts into trip_members, which has no INSERT
--     policy at all; as invoker the trigger would always fail.
--   * redeem_invite runs for a caller who is by definition not yet a member, so
--     no policy could let them read the invite or insert their own row.
--   * revoke_invite updates trip_invites, which has no UPDATE policy — that is
--     what keeps `uses` tamper-proof.
--
-- The real defect this fixes: add_owner_as_trip_member() was never revoked at
-- all, so it was reachable by anon as well as authenticated. It is a trigger
-- function, so a direct call raises "trigger functions can only be called as
-- triggers" and there is no exploit — but an unauthenticated, exposed
-- SECURITY DEFINER endpoint is not something to leave lying around.

-- ===========================================================================
-- A schema the API cannot see
-- ===========================================================================

-- `[api] schemas` is ["public", "graphql_public"], so nothing here gets a REST
-- endpoint. Policies reference a function by OID, so moving one does not
-- disturb them — verified: policies keep evaluating and the trigger keeps
-- firing after the move.
create schema if not exists private;

revoke all on schema private from public, anon;

-- USAGE is required in addition to EXECUTE for a policy to reach the function.
grant usage on schema private to authenticated, service_role;

alter function public.is_trip_member(uuid) set schema private;
alter function public.add_owner_as_trip_member() set schema private;

-- ===========================================================================
-- is_trip_member: the EXECUTE grant is load-bearing, not an oversight
-- ===========================================================================

-- Measured: revoking EXECUTE from `authenticated` makes a plain
-- `select from public.trips` fail with "permission denied for function
-- is_trip_member". RLS policy expressions are privilege-checked against the
-- invoking role, so every policy that calls this needs the caller to hold
-- EXECUTE. The grant stays.
--
-- Keeping it is safe on its own terms: the function takes a trip id and answers
-- only about `auth.uid()`'s own membership. A caller can learn nothing it does
-- not already know, and after the move above it has no REST endpoint either.
revoke all on function private.is_trip_member(uuid) from public, anon;
grant execute on function private.is_trip_member(uuid) to authenticated;

comment on function private.is_trip_member(uuid) is
  'Membership predicate for RLS. Lives outside the exposed schema; authenticated must keep EXECUTE or every policy calling it fails.';

-- ===========================================================================
-- add_owner_as_trip_member: nobody calls this but the trigger
-- ===========================================================================

-- A trigger fires as part of the statement, not as a call by the invoking role,
-- so no client needs EXECUTE. Verified after revoking: inserting a trip still
-- creates the owner's membership row, and a direct call is refused.
revoke all on function private.add_owner_as_trip_member() from public, anon, authenticated;

comment on function private.add_owner_as_trip_member() is
  'Trigger only. No client holds EXECUTE; the trigger fires as part of the INSERT.';

-- ===========================================================================
-- revoke_invite must follow the function it calls
-- ===========================================================================

-- A plpgsql body is stored as text and resolved at run time, so `alter function
-- ... set schema` does NOT rewrite callers. revoke_invite() names
-- `public.is_trip_member` explicitly (it must — `search_path` is empty), so
-- after the move above that reference points at nothing and every revoke would
-- fail at run time. RLS policies are unaffected: those hold a parsed expression
-- referencing the function by OID.
--
-- Recreated here rather than left to a later migration, so no deployed state
-- exists in which revoking an invite is broken.
create or replace function public.revoke_invite(invite_token text)
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id
  from public.trip_invites
  where token = invite_token;

  if not found then
    -- Deliberately quiet: telling a stranger that a token exists but is not
    -- theirs is an enumeration oracle.
    return;
  end if;

  if not private.is_trip_member(v_trip_id) then
    raise exception 'not a member of this trip'
      using errcode = '42501';
  end if;

  update public.trip_invites
  set revoked_at = coalesce(revoked_at, now())
  where token = invite_token;
end;
$$;

-- ===========================================================================
-- redeem_invite / revoke_invite: exposed on purpose
-- ===========================================================================

-- These two are the API. Restated here so the advisor findings are triaged in
-- code rather than re-litigated every time the report is run.
--
-- Each one authorises its own caller rather than trusting the grant:
-- redeem_invite requires auth.uid() and validates the token's expiry, revocation
-- and use cap; revoke_invite requires membership of the invite's trip and stays
-- silent about tokens that do not exist, so it is not an enumeration oracle.
revoke all on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;

revoke all on function public.revoke_invite(text) from public, anon;
grant execute on function public.revoke_invite(text) to authenticated;
