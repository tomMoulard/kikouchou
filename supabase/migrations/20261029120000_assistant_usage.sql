-- The assistant's daily limit on api.kikouchou.app (server/api).
--
-- api.kikouchou.app answers the assistant's chat on the project's OpenRouter
-- key, so every answer costs the project money. Each signed-in account gets a
-- number of requests per UTC day; this table counts them and the function below
-- takes one from the allowance.
--
-- Nothing on a client may read or write either. The service calls the
-- function with the service role key, after it has verified the caller's
-- token itself. The function therefore authorises nobody, and that is why
-- EXECUTE is revoked from every client role by name: `from public` alone
-- leaves the project's default grants to anon and authenticated in place
-- (see AGENTS.md, "Grants are revoke-first").

create table public.assistant_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  requests integer not null default 0 check (requests >= 0),
  primary key (user_id, day)
);

alter table public.assistant_usage enable row level security;

revoke all on public.assistant_usage from public, anon, authenticated;
grant select, insert, update, delete on public.assistant_usage to service_role;

comment on table public.assistant_usage is
  'Assistant requests to api.kikouchou.app per account per UTC day. Written by consume_assistant_quota only.';

-- Takes one request from the account's allowance for today and answers whether
-- it fitted. One statement, so two concurrent calls cannot both take the last
-- request: the upsert locks the row, and the second one sees the first one's
-- count. A refused request is not counted, so the stored number stops at the
-- limit rather than growing with every retry.
create function public.consume_assistant_quota(p_user_id uuid, p_limit integer)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_requests integer;
begin
  if p_user_id is null or p_limit is null or p_limit <= 0 then
    return false;
  end if;

  insert into public.assistant_usage as usage (user_id, day, requests)
  values (p_user_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update
    set requests = usage.requests + 1
    where usage.requests < p_limit
  returning usage.requests into v_requests;

  return v_requests is not null;
end;
$$;

revoke all on function public.consume_assistant_quota(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.consume_assistant_quota(uuid, integer) to service_role;

comment on function public.consume_assistant_quota(uuid, integer) is
  'Assistant daily limit on api.kikouchou.app. Service role only: the caller has already verified the user.';
