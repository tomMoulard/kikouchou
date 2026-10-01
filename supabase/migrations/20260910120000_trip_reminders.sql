-- Trip reminders: the push subscriptions, and the log that sends each one once.
--
-- ## Why
--
-- Nothing in this app brings anyone back once they have looked at a trip. A
-- reminder before the trip starts, before your own arrival and before a pickup
-- you are part of is the one return trigger the plan creates
-- (`plans/2026-09-10-invite-first-and-reminders-v1.md`, phase 3). Web Push is
-- how a closed app is reached, and a push needs a server that holds the
-- subscription: this table, read by `server/share-preview` with the service
-- role key.
--
-- ## What a subscription is
--
-- What `PushManager.subscribe()` hands the page: an endpoint URL at the
-- browser's push service, and two keys that encrypt the payload to that one
-- browser. The endpoint is a capability — anybody holding it can send to that
-- device — so it is never returned to a client, never read by `anon` or
-- `authenticated`, and rows are written only through the two functions below.
--
-- One browser has one subscription per service worker, so the same endpoint
-- appears once per trip the device wants reminders for: the unique key is
-- (trip_id, endpoint), not the endpoint alone.
--
-- ## Who may subscribe
--
-- A **viewer** holds an invite token and no account. `subscribe_trip_reminders`
-- applies the same four refusals as `read_shared_trip` — unknown, revoked,
-- expired, spent — with the same hints, and consumes no use: asking to be
-- reminded is a read, not a join. A **member** calls
-- `subscribe_member_reminders` with the trip id and must be on the roster.
-- Either way `person_id` is what the caller says it is; the sender only ever
-- uses it to pick *which* arrival and *which* rides to mention from a document
-- the caller can already read in full.
--
-- `unsubscribe_reminders(endpoint)` is open to anon and authenticated: the
-- endpoint is 100+ characters of a push service's own randomness, and the one
-- thing a stranger who somehow held it could do here is stop the reminders.
--
-- ## The log
--
-- `reminder_log` is keyed on (subscription, kind, subject). The sender writes a
-- row when it reports a reminder as due and stamps `sent_at` when the push is
-- accepted, so an hourly task never reports the same reminder twice and a
-- webhook retry never sends it twice.
--
-- ## Grants
--
-- Both tables: RLS on, everything revoked from anon and authenticated, and the
-- service role granted exactly the statements the sender runs. Revoke-first,
-- for the reason `20260831170000_trip_sync_tables.sql` gives: the project's
-- default privileges grant the client roles everything on a new table.

-- ===========================================================================
-- Tables
-- ===========================================================================

create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid        not null references public.trips (id) on delete cascade,

  -- The guest on the roster this device says it is. Null means "remind me
  -- about the trip, not about anyone's arrival".
  person_id     text        check (person_id is null or length(person_id) between 1 and 64),

  -- The account behind a member's subscription; null for a viewer.
  user_id       uuid        references auth.users (id) on delete cascade,

  endpoint      text        not null check (endpoint like 'https://%' and length(endpoint) between 20 and 2048),
  p256dh        text        not null check (length(p256dh) between 40 and 200),
  auth          text        not null check (length(auth) between 10 and 100),

  -- The language the reminder is written in: what the app was showing.
  locale        text        not null default 'fr' check (locale in ('en', 'fr')),

  -- The PostHog distinct id of the browser that subscribed, so the sender's
  -- reminder_due and reminder_sent events land on the same person as the
  -- app's own events. Null when analytics is off.
  analytics_id  text        check (analytics_id is null or length(analytics_id) between 1 and 200),

  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  unique (trip_id, endpoint)
);

create index push_subscriptions_trip_id_idx on public.push_subscriptions (trip_id);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

comment on table public.push_subscriptions is
  'Web Push subscriptions for trip reminders. Written only through subscribe_*_reminders(); read and pruned by the sender with the service role.';

create table public.reminder_log (
  subscription_id  uuid        not null references public.push_subscriptions (id) on delete cascade,
  kind             text        not null check (kind in ('trip_start', 'own_arrival', 'pickup')),
  -- What the reminder is about: the start date, a transport id, a ride id.
  subject          text        not null check (length(subject) between 1 and 64),
  due_reported_at  timestamptz not null default now(),
  sent_at          timestamptz,

  primary key (subscription_id, kind, subject)
);

alter table public.reminder_log enable row level security;

comment on table public.reminder_log is
  'One row per reminder per subscription: reported once, sent once.';

-- ===========================================================================
-- Grants
-- ===========================================================================

revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.reminder_log       from anon, authenticated;

-- The sender: reads the subscriptions, refreshes last_seen_at, deletes a
-- subscription the push service reports gone (404 / 410).
grant select, update, delete on public.push_subscriptions to service_role;
grant select, insert, update on public.reminder_log       to service_role;

-- ===========================================================================
-- Internals
-- ===========================================================================

-- The trip a live invite token opens, or an exception with the same hint
-- contract as read_shared_trip and redeem_invite.
create or replace function public.trip_behind_live_invite(invite_token text)
  returns uuid
  language plpgsql
  security definer
  stable
  set search_path = ''
as $$
declare
  v_invite public.trip_invites%rowtype;
begin
  if invite_token is null
     or length(invite_token) < 16
     or length(invite_token) > 64 then
    raise exception 'invite not found'
      using errcode = 'P0002', hint = 'invite_not_found';
  end if;

  select * into v_invite
  from public.trip_invites
  where token = invite_token;

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

  if v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses then
    raise exception 'invite has no uses left'
      using errcode = 'P0001', hint = 'invite_exhausted';
  end if;

  return v_invite.trip_id;
end;
$$;

revoke all on function public.trip_behind_live_invite(text) from public;

-- Validates and stores what PushManager.subscribe() returned, for one trip.
-- Returns the row id. Upserts on (trip_id, endpoint): a device that asks
-- twice, or asks again after picking a different name, updates its row.
create or replace function public.store_push_subscription(
  p_trip_id      uuid,
  p_user_id      uuid,
  p_subscription jsonb,
  p_person_id    text,
  p_locale       text,
  p_analytics_id text
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
    (trip_id, user_id, person_id, endpoint, p256dh, auth, locale, analytics_id)
  values
    (p_trip_id, p_user_id, nullif(p_person_id, ''), v_endpoint, v_p256dh, v_auth,
     coalesce(p_locale, 'fr'), nullif(p_analytics_id, ''))
  on conflict (trip_id, endpoint) do update
    set user_id      = coalesce(excluded.user_id, public.push_subscriptions.user_id),
        person_id    = excluded.person_id,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        locale       = excluded.locale,
        analytics_id = coalesce(excluded.analytics_id, public.push_subscriptions.analytics_id),
        last_seen_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.store_push_subscription(uuid, uuid, jsonb, text, text, text) from public;

-- ===========================================================================
-- The doors
-- ===========================================================================

-- A viewer, holding an invite token and no account.
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
    v_trip_id, auth.uid(), subscription, person_id, locale, analytics_id
  );
end;
$$;

revoke all on function public.subscribe_trip_reminders(text, jsonb, text, text, text) from public;
grant execute on function public.subscribe_trip_reminders(text, jsonb, text, text, text) to anon, authenticated;

comment on function public.subscribe_trip_reminders(text, jsonb, text, text, text) is
  'Stores a push subscription for the trip behind a live invite token. Same refusals as read_shared_trip; consumes no use.';

-- A member, signed in and on the roster.
create or replace function public.subscribe_member_reminders(
  trip         uuid,
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
begin
  if auth.uid() is null then
    raise exception 'not signed in'
      using errcode = '28000', hint = 'unauthenticated';
  end if;

  -- The membership predicate lives in `private` since 20260831180000.
  if not private.is_trip_member(trip) then
    raise exception 'not a member of this trip'
      using errcode = '42501', hint = 'not_a_member';
  end if;

  return public.store_push_subscription(
    trip, auth.uid(), subscription, person_id, locale, analytics_id
  );
end;
$$;

revoke all on function public.subscribe_member_reminders(uuid, jsonb, text, text, text) from public;
grant execute on function public.subscribe_member_reminders(uuid, jsonb, text, text, text) to authenticated;

comment on function public.subscribe_member_reminders(uuid, jsonb, text, text, text) is
  'Stores a push subscription for a trip the caller is a member of.';

-- Stops the reminders for one endpoint: for one trip, or for all of them.
-- Returns how many subscriptions were removed.
create or replace function public.unsubscribe_reminders(
  endpoint text,
  trip     uuid default null
)
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_removed integer;
begin
  if endpoint is null or length(endpoint) not between 20 and 2048 then
    return 0;
  end if;

  delete from public.push_subscriptions s
  where s.endpoint = unsubscribe_reminders.endpoint
    and (unsubscribe_reminders.trip is null or s.trip_id = unsubscribe_reminders.trip);

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.unsubscribe_reminders(text, uuid) from public;
grant execute on function public.unsubscribe_reminders(text, uuid) to anon, authenticated;

comment on function public.unsubscribe_reminders(text, uuid) is
  'Removes the push subscription(s) for an endpoint. The endpoint is the whole authorisation: only its holder knows it.';
