-- The assistant API's daily limit: the counter, and who may touch it.
--
-- Run with:  bunx supabase test db

begin;

select plan(12);

insert into auth.users (id, email, role, aud, instance_id)
values
  ('a1111111-1111-1111-1111-111111111111', 'quota-one@example.test',
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('a2222222-2222-2222-2222-222222222222', 'quota-two@example.test',
   'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

-- ===========================================================================
-- Nobody but the service
-- ===========================================================================

select ok(
  not has_function_privilege('anon', 'public.consume_assistant_quota(uuid, integer)', 'execute'),
  'anon cannot spend anybody''s allowance'
);

select ok(
  not has_function_privilege('authenticated', 'public.consume_assistant_quota(uuid, integer)', 'execute'),
  'a signed-in client cannot either: the function authorises nobody'
);

select ok(
  has_function_privilege('service_role', 'public.consume_assistant_quota(uuid, integer)', 'execute'),
  'the service role can'
);

select ok(
  not has_table_privilege('authenticated', 'public.assistant_usage', 'select, insert, update, delete'),
  'a signed-in client can neither read nor reset its counter'
);

-- ===========================================================================
-- The count
-- ===========================================================================

set local role service_role;

select is(
  public.consume_assistant_quota('a1111111-1111-1111-1111-111111111111', 2),
  true,
  'the first request of the day fits'
);

select is(
  public.consume_assistant_quota('a1111111-1111-1111-1111-111111111111', 2),
  true,
  'so does the second, at a limit of two'
);

select is(
  public.consume_assistant_quota('a1111111-1111-1111-1111-111111111111', 2),
  false,
  'the third is refused'
);

select is(
  (select requests from public.assistant_usage
   where user_id = 'a1111111-1111-1111-1111-111111111111'),
  2,
  'a refused request is not counted'
);

select is(
  public.consume_assistant_quota('a2222222-2222-2222-2222-222222222222', 2),
  true,
  'another account has its own allowance'
);

select is(
  public.consume_assistant_quota('a1111111-1111-1111-1111-111111111111', 0),
  false,
  'a limit of zero refuses everything'
);

-- Yesterday's spent allowance does not carry over.
update public.assistant_usage
set day = day - 1
where user_id = 'a1111111-1111-1111-1111-111111111111';

select is(
  public.consume_assistant_quota('a1111111-1111-1111-1111-111111111111', 2),
  true,
  'a new UTC day starts a new count'
);

reset role;

delete from auth.users where id = 'a2222222-2222-2222-2222-222222222222';

select is(
  (select count(*)::integer from public.assistant_usage
   where user_id = 'a2222222-2222-2222-2222-222222222222'),
  0,
  'deleting the account deletes its counters'
);

select * from finish();

rollback;
