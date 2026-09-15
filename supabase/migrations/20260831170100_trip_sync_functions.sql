-- Server-backed trip sync: functions and triggers.
--
-- Every function here is `security definer` with `set search_path = ''`, so all
-- references are schema-qualified. That combination is what stops a caller from
-- shadowing `trip_members` with a table of their own and answering the
-- membership question for themselves.

-- ===========================================================================
-- Membership predicate
-- ===========================================================================

-- The single question every policy asks.
--
-- `security definer` is load-bearing and not merely convenient: the policy on
-- trip_members needs to query trip_members, and doing that as the caller
-- re-enters the same policy and recurses. Running as the owner bypasses RLS for
-- this one lookup.
create or replace function public.is_trip_member(trip uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from public.trip_members m
    where m.trip_id = trip
      and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_trip_member(uuid) from public;
grant execute on function public.is_trip_member(uuid) to authenticated;

comment on function public.is_trip_member(uuid) is
  'Whether the current user belongs to the trip. security definer to avoid RLS recursion on trip_members.';

-- ===========================================================================
-- The owner is a member
-- ===========================================================================

-- is_trip_member() reads trip_members, so without this an owner could create a
-- trip and then be unable to read its own document. Done as a trigger rather
-- than a second client insert so the two rows can never come apart.
create or replace function public.add_owner_as_trip_member()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  insert into public.trip_members (trip_id, user_id)
  values (new.id, new.owner_id)
  on conflict (trip_id, user_id) do nothing;
  return new;
end;
$$;

create trigger trips_add_owner_as_member
  after insert on public.trips
  for each row
  execute function public.add_owner_as_trip_member();

-- ===========================================================================
-- Redeeming an invite
-- ===========================================================================

-- The only way to join a trip.
--
-- It has to be `security definer` because the caller is by definition *not* yet
-- a member, so no RLS policy could let them read the invite to validate it, nor
-- insert their own membership row. The token is therefore usable without being
-- readable by a stranger.
create or replace function public.redeem_invite(invite_token text)
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_invite  public.trip_invites;
begin
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '28000';
  end if;

  -- FOR UPDATE serialises concurrent redemptions of the same token, so a
  -- max_uses cap cannot be overshot by two people clicking at once.
  select * into v_invite
  from public.trip_invites
  where token = invite_token
  for update;

  if not found then
    raise exception 'invite not found'
      using errcode = 'P0002', hint = 'invite_not_found';
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'invite revoked'
      using errcode = 'P0001', hint = 'invite_revoked';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'invite expired'
      using errcode = 'P0001', hint = 'invite_expired';
  end if;

  -- Already in: return the trip without consuming a use. Opening a share link
  -- twice, or reloading the join page, must not burn a seat or fail.
  if exists (
    select 1
    from public.trip_members m
    where m.trip_id = v_invite.trip_id
      and m.user_id = v_user_id
  ) then
    return v_invite.trip_id;
  end if;

  -- Checked after the idempotent path, so an exhausted invite still lets its
  -- existing members back in.
  if v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses then
    raise exception 'invite has no uses left'
      using errcode = 'P0001', hint = 'invite_exhausted';
  end if;

  insert into public.trip_members (trip_id, user_id)
  values (v_invite.trip_id, v_user_id);

  update public.trip_invites
  set uses = uses + 1
  where token = invite_token;

  return v_invite.trip_id;
end;
$$;

revoke all on function public.redeem_invite(text) from public;
grant execute on function public.redeem_invite(text) to authenticated;

comment on function public.redeem_invite(text) is
  'Joins the caller to the invite''s trip and returns its id. Idempotent for existing members.';

-- ===========================================================================
-- Revoking an invite
-- ===========================================================================

-- There is no UPDATE policy on trip_invites, so `uses` stays tamper-proof:
-- only redeem_invite() advances it and only this revokes. Any member of the trip
-- may revoke — the product lets anyone on a trip share it, so anyone on it can
-- un-share it.
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

  if not public.is_trip_member(v_trip_id) then
    raise exception 'not a member of this trip'
      using errcode = '42501';
  end if;

  update public.trip_invites
  set revoked_at = coalesce(revoked_at, now())
  where token = invite_token;
end;
$$;

revoke all on function public.revoke_invite(text) from public;
grant execute on function public.revoke_invite(text) to authenticated;
