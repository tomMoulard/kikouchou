-- Move log compaction from the Edge Function to the clients.
--
-- ## Why
--
-- The Edge Function reconstructs each trip's document by downloading and
-- applying every log row, purely to compute a value that a connected client is
-- already holding in memory: `Y.encodeStateAsUpdate(doc)` is free there and
-- costs a full replay here. Everything else the schedule needed — an Edge
-- Function deployment, a service key in Vault, pg_cron, pg_net — existed only to
-- get a Yjs runtime somewhere that could do that replay.
--
-- Compaction also wants to happen exactly when a trip is being used, which is
-- precisely when a client is connected. A schedule sweeping every busy trip is a
-- worse fit than the devices doing their own as they go.
--
-- ## What this deliberately gives up
--
-- The Edge Function's own comment stated the principle this reverses: "a member
-- must not be able to rewrite a trip's history by replacing its compacted head."
-- That is now exactly what a member does. The reasoning for accepting it:
--
--   * A member can already write any value into the document. The log takes
--     arbitrary updates from any member, and the CRDT has no per-field
--     authorization, so "delete every guest" is available to them today and
--     propagates to every device. Publishing a thin snapshot is *weaker* than
--     that: devices that already applied the real updates keep them, and only a
--     device joining later sees less.
--   * History was never durable anyway. Compaction deletes the log; the only
--     question was who triggered the delete.
--
-- What remains genuinely worse is a *buggy* client rather than a malicious one,
-- publishing a bad snapshot over good rows. Two things bound that: a device may
-- only claim rows it has actually applied, and pruning keeps a margin of recent
-- rows, so a bad snapshot does not take the newest history with it.
--
-- ## Why a function rather than a policy
--
-- Clients are **not** granted DELETE on `trip_doc_updates`, and not granted any
-- write on `trip_doc_snapshots`. Both stay as they are. A grant would let a
-- member delete rows nothing had folded, which is the one ordering that loses
-- data outright. Instead this function does the whole thing in one transaction,
-- in the only safe order, and the client cannot express anything else.

-- ===========================================================================
-- How much of the log to keep behind a snapshot
-- ===========================================================================

-- Rows at or below `through_id - RETENTION` are pruned; the rest stay even
-- though the snapshot already covers them. They are the recovery margin for a
-- client that publishes a snapshot its own document had got wrong.
--
-- Inlined as a literal because a `create function` body cannot read a GUC set
-- later in the same migration without complicating every call site.

create or replace function public.publish_trip_snapshot(
  p_trip_id    uuid,
  p_state      text,
  p_through_id bigint
)
  returns bigint
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  c_retention constant bigint := 50;
  v_user_id   uuid := auth.uid();
  v_existing  bigint;
  v_max_id    bigint;
  v_applied   bigint;
  v_deleted   bigint;
begin
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '28000';
  end if;

  -- Membership, checked here rather than trusted, because this function runs as
  -- its owner and so bypasses the policies that would otherwise say no.
  if not private.is_trip_member(p_trip_id) then
    raise exception 'not a member of this trip'
      using errcode = '42501', hint = 'not_a_member';
  end if;

  if p_state is null or length(p_state) = 0 then
    raise exception 'snapshot state is required'
      using errcode = '22023', hint = 'empty_state';
  end if;

  -- A cheap short-circuit only. The guard that actually holds is on the upsert
  -- below: `FOR UPDATE` here would lock nothing when no snapshot row exists yet,
  -- which is exactly when two devices race.
  select through_id into v_existing
  from public.trip_doc_snapshots
  where trip_id = p_trip_id;

  if v_existing is not null and p_through_id <= v_existing then
    return 0;
  end if;

  -- A device cannot claim to have folded rows that do not exist. This is the
  -- cheap half of "only claim what you have applied" — the other half is the
  -- client sending its own cursor, which nothing here can verify.
  select max(id) into v_max_id
  from public.trip_doc_updates
  where trip_id = p_trip_id;

  if v_max_id is null or p_through_id > v_max_id then
    raise exception 'through_id % is beyond the log', p_through_id
      using errcode = '22023', hint = 'through_id_beyond_log';
  end if;

  -- Snapshot first. If this transaction fails after here, nothing has been
  -- pruned and the next attempt simply repeats the work.
  --
  -- The `where` on the update is what makes the head monotonic under
  -- concurrency, and it is load-bearing rather than belt-and-braces. Two devices
  -- both finding no snapshot row would otherwise both insert-or-update, and the
  -- one with the *older* cursor could land last and move the head backwards —
  -- below rows the other had already pruned, losing them outright.
  insert into public.trip_doc_snapshots as s (trip_id, state, through_id, updated_at)
  values (p_trip_id, p_state, p_through_id, now())
  on conflict (trip_id) do update
    set state      = excluded.state,
        through_id = excluded.through_id,
        updated_at = excluded.updated_at
    where s.through_id < excluded.through_id
  returning s.through_id into v_applied;

  -- No row back means the update was skipped: somebody published a newer
  -- snapshot first. Returning before the prune matters — pruning against a head
  -- this transaction did not write is how the backwards case loses data.
  if v_applied is null then
    return 0;
  end if;

  -- Prune second, and never past the margin.
  delete from public.trip_doc_updates
  where trip_id = p_trip_id
    and id <= v_applied - c_retention;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.publish_trip_snapshot(uuid, text, bigint) is
  'Folds a trip''s log into the snapshot a member has computed, then prunes what it covers, keeping a margin of recent rows. Monotonic in through_id.';

-- Members only, and nothing wider: `public` includes `anon`.
revoke all on function public.publish_trip_snapshot(uuid, text, bigint) from public;
grant execute on function public.publish_trip_snapshot(uuid, text, bigint) to authenticated;

-- ===========================================================================
-- Retire the schedule
-- ===========================================================================

-- The Edge Function and its cron job are replaced by the above. Unscheduled
-- rather than left running: with clients compacting, a second writer of the same
-- snapshot row is a race for no benefit.
--
-- `cron.unschedule` raises if the job is absent, so this is guarded — the job
-- never existed on a database that skipped the scheduling migration.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'compact-trip-docs') then
    perform cron.unschedule('compact-trip-docs');
  end if;
exception
  when undefined_table then
    -- pg_cron was never installed here. Nothing to unschedule.
    null;
end;
$$;

drop function if exists private.invoke_trip_doc_compaction();

-- The Vault secrets `compaction_service_key` and `compaction_function_url` are
-- no longer read by anything. Left in place rather than dropped here: deleting
-- someone's secrets from a migration is not this file's business, and a stale
-- secret that nothing reads is inert.
