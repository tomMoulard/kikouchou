-- The store apps: native push tokens, and deleting an account from the app.
--
-- See plans/2026-09-26-native-apps-v1.md.
--
-- ## Native push
--
-- A store app's web view has no PushManager. The iOS app registers with Apple
-- Push Notification service and the Android app with Firebase Cloud
-- Messaging, and each hands back a device token instead of a Web Push
-- subscription. The token is stored where a browser's endpoint goes, so the
-- unique key, `unsubscribe_reminders(endpoint)` and the client's local record
-- work unchanged, and `transport` says which sender the row needs.
--
-- A token is a capability to send to that phone, exactly as an endpoint is. It
-- is bounded on the way in and never returned to a client.
--
-- ## Account deletion
--
-- Both stores require it inside the app (App Store guideline 5.1.1(v), Google
-- Play's user data policy). The rule, decided on 2026-09-26: a trip shared
-- with other members stays as it is, and a trip with no other member goes with
-- the account.
--
-- A bare delete of the auth.users row does not do that. Three foreign keys
-- cascade from it into data other people depend on:
--
-- * trips.owner_id would delete every trip the user owns, shared or not;
-- * trip_doc_updates.author_id would delete the user's edits from the log of
--   every shared trip, and every edit not yet folded into a snapshot with it;
-- * trip_invites.created_by would kill every invite link the user handed out,
--   and through push_subscriptions.invite_token the reminders of every viewer
--   who opened one.
--
-- The last two become ON DELETE SET NULL. The first stays a cascade, and
-- delete_my_account() hands each shared trip to another member before the
-- account row goes.

-- ===========================================================================
-- Native push tokens
-- ===========================================================================

alter table public.push_subscriptions
  add column transport text not null default 'webpush'
    check (transport in ('webpush', 'apns', 'fcm'));

comment on column public.push_subscriptions.transport is
  'Which sender the row needs: webpush (endpoint plus p256dh and auth), apns or fcm (endpoint holds the device token).';

-- The Web Push checks only hold for a Web Push row.
alter table public.push_subscriptions drop constraint push_subscriptions_endpoint_check;
alter table public.push_subscriptions drop constraint push_subscriptions_p256dh_check;
alter table public.push_subscriptions drop constraint push_subscriptions_auth_check;
alter table public.push_subscriptions alter column p256dh drop not null;
alter table public.push_subscriptions alter column auth drop not null;

alter table public.push_subscriptions
  add constraint push_subscriptions_shape_check check (
    case transport
      when 'webpush' then
        endpoint like 'https://%'
        and length(endpoint) between 20 and 2048
        and p256dh is not null and length(p256dh) between 40 and 200
        and auth is not null and length(auth) between 10 and 100
      else
        -- An APNs token is 64 hex characters today and an FCM token about 160
        -- characters; neither format is promised, so the bound is loose.
        endpoint ~ '^[A-Za-z0-9_:.\-]+$'
        and length(endpoint) between 32 and 4096
        and p256dh is null
        and auth is null
    end
  );

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
  v_transport text;
  v_endpoint  text;
  v_p256dh    text;
  v_auth      text;
  v_id        uuid;
begin
  if p_subscription is null or jsonb_typeof(p_subscription) <> 'object' then
    raise exception 'subscription must be an object'
      using errcode = '22023', hint = 'subscription_invalid';
  end if;

  -- A browser sends `PushSubscription.toJSON()`, which has no `transport`. A
  -- store app sends `{ transport, token }`.
  v_transport := coalesce(p_subscription->>'transport', 'webpush');

  if v_transport = 'webpush' then
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
  elsif v_transport in ('apns', 'fcm') then
    v_endpoint := p_subscription->>'token';
    v_p256dh   := null;
    v_auth     := null;

    -- A character class, then the length: Postgres caps a regex repetition
    -- count at 255, below an FCM token's plausible length.
    if v_endpoint is null or v_endpoint !~ '^[A-Za-z0-9_:.\-]+$'
       or length(v_endpoint) not between 32 and 4096 then
      raise exception 'subscription must carry a device token'
        using errcode = '22023', hint = 'subscription_invalid';
    end if;
  else
    raise exception 'unsupported push transport'
      using errcode = '22023', hint = 'subscription_invalid';
  end if;

  if p_locale is not null and p_locale not in ('en', 'fr') then
    raise exception 'unsupported locale'
      using errcode = '22023', hint = 'locale_invalid';
  end if;

  insert into public.push_subscriptions
    (trip_id, user_id, person_id, transport, endpoint, p256dh, auth, locale, analytics_id, invite_token)
  values
    (p_trip_id, p_user_id, nullif(p_person_id, ''), v_transport, v_endpoint, v_p256dh, v_auth,
     coalesce(p_locale, 'fr'), nullif(p_analytics_id, ''), nullif(p_invite_token, ''))
  on conflict (trip_id, endpoint) do update
    set user_id      = coalesce(excluded.user_id, public.push_subscriptions.user_id),
        person_id    = excluded.person_id,
        transport    = excluded.transport,
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

-- The sender reads the transport from the view. Same filter as before.
-- Dropped and recreated rather than replaced: `create or replace view` cannot
-- insert a column in the middle.
drop view public.live_push_subscriptions;

create view public.live_push_subscriptions as
select s.id,
       s.trip_id,
       s.person_id,
       s.transport,
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

-- ===========================================================================
-- What a deleted account leaves behind for everybody else
-- ===========================================================================

alter table public.trip_doc_updates alter column author_id drop not null;
alter table public.trip_doc_updates drop constraint trip_doc_updates_author_id_fkey;
alter table public.trip_doc_updates
  add constraint trip_doc_updates_author_id_fkey
  foreign key (author_id) references auth.users (id) on delete set null;

alter table public.trip_invites alter column created_by drop not null;
alter table public.trip_invites drop constraint trip_invites_created_by_fkey;
alter table public.trip_invites
  add constraint trip_invites_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

-- ===========================================================================
-- delete_my_account()
-- ===========================================================================

create or replace function public.delete_my_account()
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_user_id   uuid := auth.uid();
  v_trip      record;
  v_new_owner uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '28000', hint = 'unauthenticated';
  end if;

  for v_trip in
    select t.id, t.local_id
    from public.trips t
    where t.owner_id = v_user_id
    for update
  loop
    -- The member who joined first takes the trip over. Ownership only decides
    -- who may rename, re-date or delete the trip on the server; every member
    -- already edits the document.
    select m.user_id into v_new_owner
    from public.trip_members m
    where m.trip_id = v_trip.id
      and m.user_id <> v_user_id
    order by m.joined_at, m.user_id
    limit 1;

    if v_new_owner is null then
      -- Nobody else is on it: the trip goes with the account, and the cascade
      -- takes its log, snapshots, invites, template and subscriptions.
      delete from public.trips where id = v_trip.id;
    else
      -- `local_id` is a per-device nanoid of the old owner's copy. It is kept
      -- unless the new owner already owns a trip under the same id, where the
      -- server id is used instead: it is unique by construction.
      update public.trips
      set owner_id = v_new_owner,
          local_id = case
            when exists (
              select 1 from public.trips other
              where other.owner_id = v_new_owner
                and other.local_id = v_trip.local_id
            ) then v_trip.id::text
            else v_trip.local_id
          end
      where id = v_trip.id;
    end if;
  end loop;

  -- The rest follows from the foreign keys: memberships, guest groups and
  -- push subscriptions cascade, edits and invites stay with their trips.
  delete from auth.users where id = v_user_id;
end;
$$;

revoke all on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Deletes the caller''s account. A trip shared with other members is handed to the earliest of them; a trip with nobody else on it is deleted.';
