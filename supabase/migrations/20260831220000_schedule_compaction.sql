-- Schedule log compaction.
--
-- Merging Yjs updates needs Yjs, so the work itself lives in the
-- `compact-trip-docs` Edge Function. This only arranges for it to be called.
--
-- ## The service key is deliberately not here
--
-- Compaction is the one actor permitted to rewrite a trip's compacted head, so
-- it runs with the service key — which must never enter git. The schedule
-- therefore reads it from Supabase Vault by name, and creating that secret is a
-- one-time manual step, documented at the bottom of this file.
--
-- Until the secret exists the job runs and fails harmlessly: the log simply
-- keeps growing, which is the same state as before this migration.

create extension if not exists pg_cron with schema extensions;
-- pg_net ignores `with schema` and installs into its own `net` schema. Stated
-- plainly here because getting it wrong produced a 42883 at run time — see the
-- follow-up migration.
create extension if not exists pg_net;

-- ===========================================================================
-- The invoker
-- ===========================================================================

-- Wrapped in a function rather than inlined into the cron command so the
-- schedule stays readable and the secret lookup lives in one place.
create or replace function private.invoke_trip_doc_compaction()
  returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_key text;
  v_url text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'compaction_service_key';

  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'compaction_function_url';

  if v_key is null or v_url is null then
    -- Not configured yet. Say so once per run rather than raising: a failing
    -- cron job that emails nobody is worse than a log line, and the only
    -- consequence is that the log keeps growing as it did before.
    raise notice 'trip doc compaction is not configured; add the vault secrets';
    return;
  end if;

  perform extensions.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function private.invoke_trip_doc_compaction() from public, anon, authenticated;

comment on function private.invoke_trip_doc_compaction() is
  'Calls the compact-trip-docs Edge Function. Reads the service key from Vault so it is never committed.';

-- ===========================================================================
-- The schedule
-- ===========================================================================

-- Daily, off-peak. Compaction is a housekeeping job, not a latency-sensitive
-- one: a trip carrying a few hundred extra log rows for a day costs a slightly
-- longer first sync and nothing else.
--
-- Unscheduled first so re-running this migration does not stack duplicates.
select cron.unschedule('compact-trip-docs')
where exists (select 1 from cron.job where jobname = 'compact-trip-docs');

select cron.schedule(
  'compact-trip-docs',
  '17 3 * * *',
  $$select private.invoke_trip_doc_compaction();$$
);

-- ===========================================================================
-- One-time setup, run by hand
-- ===========================================================================

-- These two statements are NOT part of the migration, because they carry a
-- secret. Run them once against the project, substituting real values:
--
--   select vault.create_secret(
--     '<service role key>',
--     'compaction_service_key',
--     'Service key used by the compaction cron job'
--   );
--
--   select vault.create_secret(
--     'https://<project ref>.functions.supabase.co/compact-trip-docs',
--     'compaction_function_url',
--     'Endpoint of the compact-trip-docs Edge Function'
--   );
--
-- And deploy the function itself:
--
--   bunx supabase functions deploy compact-trip-docs
--
-- To check it by hand afterwards:
--
--   select private.invoke_trip_doc_compaction();
--   select * from cron.job_run_details where jobname = 'compact-trip-docs'
--     order by start_time desc limit 5;
