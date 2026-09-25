-- Call the right function.
--
-- The scheduled invoker referenced `extensions.http_post`, which does not exist:
--
--   ERROR: 42883: function extensions.http_post(url => text, headers => jsonb,
--          body => jsonb, timeout_milliseconds => integer) does not exist
--
-- `pg_net` installs its functions into its own `net` schema and ignores the
-- `with schema` clause it was created with, so the previous migration's
-- `create extension pg_net with schema extensions` was misleading about where
-- anything ended up. Verified against a live database:
--
--   net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}',
--                 headers jsonb DEFAULT '{"Content-Type": "application/json"}',
--                 timeout_milliseconds integer DEFAULT 5000)
--
-- The named arguments were fine — only the schema was wrong. Nothing had run
-- successfully before this, so there is no partial state to reconcile: the job
-- was failing on every tick.

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
    -- Not configured yet. A notice rather than an exception: a failing cron job
    -- that emails nobody is worse than a log line, and the only consequence is
    -- that the log keeps growing as it did before.
    raise notice 'trip doc compaction is not configured; add the vault secrets';
    return;
  end if;

  -- net, not extensions. pg_net owns its own schema.
  perform net.http_post(
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
  'Calls the compact-trip-docs Edge Function via net.http_post. Reads the service key from Vault so it is never committed.';
