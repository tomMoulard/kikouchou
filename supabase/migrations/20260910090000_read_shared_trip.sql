-- Reading a shared trip through its invite link, with no account.
--
-- ## Why
--
-- An invite link used to lead to a wall: "Create an account so the others can
-- see your room". Four invitees hit that wall in the first nine days of
-- analytics and three of them left within three minutes. The account is
-- needed to *write* — every insert policy names auth.uid() — but nothing about
-- reading a trip needs one. This function is the read.
--
-- ## What changes about the security model
--
-- `20260831170000_trip_sync_tables.sql` revoked every privilege from `anon`
-- and said "an unauthenticated caller must reach nothing". That remains true
-- of every table. `anon` gains EXECUTE on this one function and nothing else,
-- and the function answers one question — "what does the trip behind this
-- token look like?" — for a caller who already holds the token.
--
-- The token thereby becomes a bearer *read* credential, where before it was
-- usable only by an account (`redeem_invite`) and readable by nobody outside
-- the trip. That is a deliberate product decision, taken on 2026-09-10 and
-- recorded in `plans/2026-09-10-invite-first-and-reminders-v1.md`: anyone the
-- link is forwarded to reads guest names, stay dates and pickup places. The
-- controls are the ones the invite already had — expiry, a use cap, and
-- revocation — and every one of them is enforced here exactly as
-- `redeem_invite` enforces it, with the same `hint` contract so the client
-- explains a dead link the same way whichever door it came through.
--
-- What it does NOT do:
--   * consume a use. Reading is not joining; `uses` moves only in redeem_invite.
--   * write anything. `stable`, and the body holds no INSERT/UPDATE/DELETE.
--   * widen the exposure of any table. It returns exactly the four things a
--     member's own client reads to hydrate a trip: the preview row, the
--     compacted snapshot, the log after a cursor, and whether more is waiting.
--
-- Enumeration: tokens are 16 characters of a 64-symbol alphabet (96 bits),
-- and an unknown token is refused with the same hint whatever the reason it is
-- unknown. Anything not even shaped like a token is refused before a query
-- runs.
--
-- ## The payload
--
--   {
--     "trip":     { "id", "name", "start_date", "end_date" },
--     "snapshot": { "state", "through_id" } | null,
--     "updates":  [ { "id", "update" }, ... ],   -- at most 500, ascending
--     "has_more": boolean
--   }
--
-- `after_id` is the caller's cursor — the highest log id it has applied. The
-- snapshot is included only when it folds rows past that cursor, which is the
-- same rule `SupabaseYjsProvider.pull` applies for members: a device that has
-- read up to row 50 when rows 1..100 were compacted must receive the snapshot,
-- or rows 51..100 exist nowhere it can reach. When the snapshot is sent, the
-- rows returned start after its through_id; otherwise they start after the
-- cursor. `has_more` tells the caller to ask again with the last id it got.

create or replace function public.read_shared_trip(
  invite_token text,
  after_id     bigint default 0
)
  returns jsonb
  language plpgsql
  security definer
  stable
  set search_path = ''
as $$
declare
  c_page_size constant integer := 500;
  v_invite    public.trip_invites%rowtype;
  v_trip      public.trips%rowtype;
  v_snapshot  public.trip_doc_snapshots%rowtype;
  v_has_snapshot boolean := false;
  v_floor     bigint;
  v_remaining bigint;
  v_updates   jsonb;
begin
  -- Not even shaped like a token: refused before touching a table, and with
  -- the same hint as an unknown one so the two cannot be told apart.
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

  -- The same three refusals as redeem_invite, in the same order, with the same
  -- hints. A revoked link must stop *reading* the trip too: withdrawing a link
  -- means the group chat it was pasted into stops seeing who sleeps where.
  if v_invite.revoked_at is not null then
    raise exception 'invite revoked'
      using errcode = 'P0001', hint = 'invite_revoked';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'invite expired'
      using errcode = 'P0001', hint = 'invite_expired';
  end if;

  -- No idempotent path here, unlike redeem_invite: a reader is never on the
  -- roster, so a spent cap simply closes the link to readers as well.
  if v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses then
    raise exception 'invite has no uses left'
      using errcode = 'P0001', hint = 'invite_exhausted';
  end if;

  select * into v_trip
  from public.trips
  where id = v_invite.trip_id;

  if not found then
    -- Invites cascade with their trip, so this is a race against a delete.
    -- The link is dead either way.
    raise exception 'invite not found'
      using errcode = 'P0002', hint = 'invite_not_found';
  end if;

  -- The log floor: the caller's cursor, or the snapshot's through_id when the
  -- snapshot is ahead of that cursor and is therefore being sent.
  v_floor := greatest(coalesce(after_id, 0), 0);

  select * into v_snapshot
  from public.trip_doc_snapshots
  where trip_id = v_trip.id;

  if found and v_snapshot.through_id > v_floor then
    v_has_snapshot := true;
    v_floor := v_snapshot.through_id;
  end if;

  -- Two index scans on (trip_id, id): one to know whether a page is left over,
  -- one for the page itself. A single scan of page + 1 rows would need the
  -- row set held in a variable to split it, which plpgsql does not do cleanly.
  select count(*) into v_remaining
  from public.trip_doc_updates
  where trip_id = v_trip.id
    and id > v_floor;

  select coalesce(
           jsonb_agg(jsonb_build_object('id', u.id, 'update', u.update) order by u.id),
           '[]'::jsonb
         )
    into v_updates
  from (
    select id, update
    from public.trip_doc_updates
    where trip_id = v_trip.id
      and id > v_floor
    order by id
    limit c_page_size
  ) u;

  return jsonb_build_object(
    'trip', jsonb_build_object(
      'id',         v_trip.id,
      'name',       v_trip.name,
      'start_date', v_trip.start_date,
      'end_date',   v_trip.end_date
    ),
    'snapshot', case
      when v_has_snapshot then jsonb_build_object(
        'state',      v_snapshot.state,
        'through_id', v_snapshot.through_id
      )
      else null
    end,
    'updates',  v_updates,
    'has_more', v_remaining > c_page_size
  );
end;
$$;

-- The one grant `anon` holds anywhere in this database. Restated next to the
-- function so the security advisor's "callable by anon" finding is triaged
-- here, in code: the function authorises its own caller with the token, the
-- way redeem_invite authorises its caller with a session.
revoke all on function public.read_shared_trip(text, bigint) from public;
grant execute on function public.read_shared_trip(text, bigint) to anon, authenticated;

comment on function public.read_shared_trip(text, bigint) is
  'Read-only view of the trip behind a live invite token: preview row, compacted snapshot, log rows after a cursor. Consumes no use and writes nothing. The one function anon may execute.';
