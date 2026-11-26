-- A store app can stop the reminders for a device token of any stored length.
--
-- `20261022120000` let `push_subscriptions.endpoint` hold an APNs or FCM
-- device token of up to 4096 characters, and `store_push_subscription`
-- accepts that length. `unsubscribe_reminders` kept the Web Push bound of
-- 2048 from `20260910120000` and answered 0 for anything longer. The client
-- reads "no error" as "the server forgot the endpoint" and clears its local
-- record, so a phone with a long token lost its only handle on a row the
-- sender went on pushing to.
--
-- The bound is now the widest one the table accepts. The lower bound stays
-- at 20, the shortest Web Push endpoint, below the 32 of a device token.
-- Nothing else changes: the endpoint is still the whole authorisation,
-- because only the device that holds it knows it.

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
  if endpoint is null or length(endpoint) not between 20 and 4096 then
    return 0;
  end if;

  delete from public.push_subscriptions s
  where s.endpoint = unsubscribe_reminders.endpoint
    and (unsubscribe_reminders.trip is null or s.trip_id = unsubscribe_reminders.trip);

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

-- `create or replace` keeps the grants, and they are restated so this file
-- reads on its own. Revoke-first, naming the roles (see AGENTS.md).
revoke all on function public.unsubscribe_reminders(text, uuid) from public, anon, authenticated;
grant execute on function public.unsubscribe_reminders(text, uuid) to anon, authenticated;
