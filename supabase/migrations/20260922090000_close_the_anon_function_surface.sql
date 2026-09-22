-- Close the function surface `revoke ... from public` did not close, and stop a
-- withdrawn invite from going on sending reminders.
--
-- ## The grant bug
--
-- `revoke all on function f from public` reads like it closes a function. It
-- does not. Postgres grants EXECUTE to PUBLIC by default, *and* this project's
-- default privileges grant it to `anon`, `authenticated` and `service_role`
-- besides — so revoking PUBLIC leaves the three role grants exactly where they
-- were. It is the same trap `20260831170000_trip_sync_tables.sql` documents for
-- tables ("revoke-first, because the project's default privileges grant the
-- client roles everything on a new table"); the function half was applied to
-- four functions in `20260831180000_harden_function_grants.sql`, which spells
-- out `from public, anon`, and to nothing written since.
--
-- Measured against a fresh local stack before this migration:
--
--   publish_trip_snapshot      anon=true authenticated=true
--   store_push_subscription    anon=true authenticated=true
--   subscribe_member_reminders anon=true authenticated=true
--   trip_behind_live_invite    anon=true authenticated=true
--
-- `store_push_subscription` is the one that mattered. It is the internal writer
-- both `subscribe_*_reminders` functions call *after* they have authorised the
-- caller, so it carries no check of its own — and an unauthenticated caller
-- holding nothing but the publishable key could call it directly:
--
--   POST /rest/v1/rpc/store_push_subscription
--   {"p_trip_id": "<any trip uuid>", "p_subscription": {...attacker endpoint...}}
--
-- That was accepted, and the reminder sender would then push that trip's places
-- and times to the attacker's device, with no invite token anywhere in it.
--
-- The other three each check `auth.uid()` and membership as their first act, so
-- the grant was wrong rather than exploitable. Closed anyway: an
-- unauthenticated SECURITY DEFINER endpoint is not something to leave lying
-- around, and the next function to be written from one of these as a template
-- inherits whatever they do.
--
-- ## The invite bug
--
-- A viewer subscribes with an invite token, and `subscribe_trip_reminders`
-- applies the four refusals `read_shared_trip` applies. Nothing re-applied them
-- afterwards. Revoking the invite — the act of un-sharing a trip — left the
-- subscription in place, and the sender went on delivering that trip's pickup
-- places and times to the device forever. Expiring and exhausting the invite
-- did the same.
--
-- The subscription now records which invite authorised it, `revoke_invite`
-- deletes what it authorised, and the sender reads a view that re-applies the
-- expiry and use checks on every tick. A member's subscription carries no
-- invite and is unaffected.

-- ===========================================================================
-- The grants
-- ===========================================================================

-- Internal. Called by the two subscribe functions after they have authorised
-- the caller; carries no authorisation of its own, so no client may reach it.
revoke all on function public.store_push_subscription(uuid, uuid, jsonb, text, text, text)
  from public, anon, authenticated;

comment on function public.store_push_subscription(uuid, uuid, jsonb, text, text, text) is
  'Internal writer for the subscribe_*_reminders functions. No client holds EXECUTE: it authorises nobody, its callers do.';

-- Internal. Answers whether a token is live and which trip it opens, which is
-- an oracle a stranger has no business holding directly.
revoke all on function public.trip_behind_live_invite(text)
  from public, anon, authenticated;

comment on function public.trip_behind_live_invite(text) is
  'Internal token check for the reminder functions. No client holds EXECUTE.';

-- Signed-in only, and each one says so itself.
revoke all on function public.publish_trip_snapshot(uuid, text, bigint) from public, anon;
grant execute on function public.publish_trip_snapshot(uuid, text, bigint) to authenticated;

revoke all on function public.subscribe_member_reminders(uuid, jsonb, text, text, text)
  from public, anon;
grant execute on function public.subscribe_member_reminders(uuid, jsonb, text, text, text)
  to authenticated;

-- The three that are open to anon on purpose, restated so the shape is pinned
-- in code rather than inherited from a default. Each is a door an invite link
-- opens with no account, and each checks its own token.
revoke all on function public.read_shared_trip(text, bigint) from public;
grant execute on function public.read_shared_trip(text, bigint) to anon, authenticated;

revoke all on function public.read_trip_template(text) from public;
grant execute on function public.read_trip_template(text) to anon, authenticated;

revoke all on function public.subscribe_trip_reminders(text, jsonb, text, text, text) from public;
grant execute on function public.subscribe_trip_reminders(text, jsonb, text, text, text)
  to anon, authenticated;

revoke all on function public.unsubscribe_reminders(text, uuid) from public;
grant execute on function public.unsubscribe_reminders(text, uuid) to anon, authenticated;

-- ===========================================================================
-- The sequence behind the append-only log
-- ===========================================================================

-- `trip_doc_updates.id` is a bigint identity, and its sequence carried the
-- project's default `grant all` to both client roles. The revoke-first rule was
-- applied to the table and not to the sequence underneath it, so a client held
-- USAGE, SELECT and UPDATE on it: `setval()` could move the counter, and the
-- log's ids are what every sync cursor and every snapshot's `through_id` are
-- compared against.
--
-- Nothing needs it. Rows are inserted through the table's own INSERT policy,
-- which takes the default from the sequence as the *table owner*, not as the
-- caller.
revoke all on sequence public.trip_doc_updates_id_seq from public, anon, authenticated;

-- ===========================================================================
-- A reminder subscription remembers which invite authorised it
-- ===========================================================================

alter table public.push_subscriptions
  add column if not exists invite_token text
    references public.trip_invites (token) on delete cascade;

comment on column public.push_subscriptions.invite_token is
  'The invite that authorised a viewer''s subscription; null for a member. Revoking, expiring or exhausting that invite stops the reminders.';

create index if not exists push_subscriptions_invite_token_idx
  on public.push_subscriptions (invite_token);

-- Same body as before plus the token, which `subscribe_trip_reminders` now
-- passes and `subscribe_member_reminders` leaves null.
create or replace function public.store_push_subscription(
  p_trip_id      uuid,
  p_user_id      uuid,
  p_subscription jsonb,
  p_person_id    text,
  p_locale       text,
  p_analytics_id text,
  p_invite_token text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_endpoint text;
  v_p256dh   text;
  v_auth     text;
  v_id       uuid;
begin
  if p_subscription is null or jsonb_typeof(p_subscription) <> 'object' then
    raise exception 'subscription must be an object'
      using errcode = '22023', hint = 'subscription_invalid';
  end if;

  v_endpoint := p_subscription->>'endpoint';
  v_p256dh   := p_subscription->'keys'->>'p256dh';
  v_auth     := p_subscription->'keys'->>'auth';

  if v_endpoint is null or v_endpoint not like 'https://%'
     or length(v_endpoint) not between 20 and 2048
     or v_p256dh is null or length(v_p256dh) not between 40 and 200
     or v_auth is null or length(v_auth) not between 10 and 100 then
    raise exception 'subscription must carry an https endpoint and both keys'
      using errcode = '22023', hint = 'subscription_invalid';
  end if;

  if p_locale is not null and p_locale not in ('en', 'fr') then
    raise exception 'unsupported locale'
      using errcode = '22023', hint = 'locale_invalid';
  end if;

  insert into public.push_subscriptions
    (trip_id, user_id, person_id, endpoint, p256dh, auth, locale, analytics_id, invite_token)
  values
    (p_trip_id, p_user_id, nullif(p_person_id, ''), v_endpoint, v_p256dh, v_auth,
     coalesce(p_locale, 'fr'), nullif(p_analytics_id, ''), nullif(p_invite_token, ''))
  on conflict (trip_id, endpoint) do update
    set user_id      = coalesce(excluded.user_id, public.push_subscriptions.user_id),
        person_id    = excluded.person_id,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        locale       = excluded.locale,
        analytics_id = coalesce(excluded.analytics_id, public.push_subscriptions.analytics_id),
        -- A member re-subscribing on a device that first subscribed as a viewer
        -- drops the invite: their access no longer depends on it.
        invite_token = excluded.invite_token,
        last_seen_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.store_push_subscription(uuid, uuid, jsonb, text, text, text, text)
  from public, anon, authenticated;

comment on function public.store_push_subscription(uuid, uuid, jsonb, text, text, text, text) is
  'Internal writer for the subscribe_*_reminders functions. No client holds EXECUTE: it authorises nobody, its callers do.';

-- The six-argument form is now unreachable and unused. Dropped rather than left
-- behind: an overload nobody calls is an endpoint nobody re-reads.
drop function if exists public.store_push_subscription(uuid, uuid, jsonb, text, text, text);

create or replace function public.subscribe_trip_reminders(
  invite_token text,
  subscription jsonb,
  person_id    text default null,
  locale       text default 'fr',
  analytics_id text default null
)
  returns uuid
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_trip_id uuid;
begin
  v_trip_id := public.trip_behind_live_invite(invite_token);
  return public.store_push_subscription(
    v_trip_id, auth.uid(), subscription, person_id, locale, analytics_id, invite_token
  );
end;
$$;

revoke all on function public.subscribe_trip_reminders(text, jsonb, text, text, text) from public;
grant execute on function public.subscribe_trip_reminders(text, jsonb, text, text, text)
  to anon, authenticated;

-- ===========================================================================
-- Revoking an invite stops what it authorised
-- ===========================================================================

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

  -- Un-sharing a trip stops the reminders the share authorised. Without this
  -- the subscription outlived the invite and the sender went on delivering the
  -- trip's pickup places and times to the device for good.
  delete from public.push_subscriptions
  where push_subscriptions.invite_token = revoke_invite.invite_token;
end;
$$;

revoke all on function public.revoke_invite(text) from public, anon;
grant execute on function public.revoke_invite(text) to authenticated;

-- ===========================================================================
-- Expiry and exhaustion, re-applied on every tick
-- ===========================================================================

-- Revocation is an act, so it can delete. Expiry and exhaustion are conditions
-- that become true with nobody present, so they have to be checked at send
-- time. The sender reads this instead of the table; `reminders.rs` names it.
--
-- `security_invoker` is deliberately off: only `service_role` is granted
-- SELECT, and it is the role that already reads the table underneath.
create or replace view public.live_push_subscriptions as
select s.id,
       s.trip_id,
       s.person_id,
       s.endpoint,
       s.p256dh,
       s.auth,
       s.locale,
       s.analytics_id
from public.push_subscriptions s
left join public.trip_invites i on i.token = s.invite_token
where s.invite_token is null
   or (i.token is not null
       and i.revoked_at is null
       and (i.expires_at is null or i.expires_at > now())
       and (i.max_uses is null or i.uses < i.max_uses));

revoke all on public.live_push_subscriptions from public, anon, authenticated;
grant select on public.live_push_subscriptions to service_role;

comment on view public.live_push_subscriptions is
  'Subscriptions the sender may still push to: a member''s, or a viewer''s whose invite is not revoked, expired or spent.';
