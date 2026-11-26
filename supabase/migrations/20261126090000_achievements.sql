-- Achievements: the badges an account unlocked, and how rare each one is.
--
-- An achievement is unlocked on a device, often long before an account exists,
-- and kept there in Dexie. Once the person signs in, the device uploads what it
-- holds and pulls what the account's other devices unlocked. A row here is
-- therefore a claim the client makes about itself: nothing on the server can
-- check that somebody created ten trips or tapped the pet at midnight. The
-- table is bounded so a dishonest client can only lie about its own account.
--
-- An unlock is permanent. There is no UPDATE and no DELETE grant: the upload
-- is an insert that ignores a row already present, and the rows leave with the
-- account through the foreign key's cascade (`delete_my_account`).
--
-- `achievement_stats()` is the reason this lives on the server at all: it
-- answers, for each key, which share of the project's accounts holds it, so the
-- settings screen can say "14% of people have this". It is the first function
-- here that reads across every account, so it answers percentages only, never
-- a count of accounts or a list of who holds what.

-- ===========================================================================
-- achievements
-- ===========================================================================

create table public.achievements (
  owner_id    uuid        not null references auth.users (id) on delete cascade,

  -- The client's AchievementKey. Not an enum: a new achievement ships in the
  -- client alone, and a key no build knows is ignored by every reader. Bounded
  -- in shape, so the column cannot hold free text.
  key         text        not null check (key ~ '^[a-z0-9_]{1,40}$'),

  -- When the device unlocked it, as the device saw it. Bounded so a wrong or
  -- hostile clock cannot store a date from another century.
  unlocked_at timestamptz not null
                check (unlocked_at >= '2026-01-01'::timestamptz)
                check (unlocked_at <= now() + interval '1 day'),

  created_at  timestamptz not null default now(),

  primary key (owner_id, key)
);

alter table public.achievements enable row level security;

comment on table public.achievements is
  'Achievements an account unlocked. Written by the client, permanent, private to the owner.';
comment on column public.achievements.key is
  'The client''s achievement key. Unknown keys are ignored by every reader.';

-- The primary key leads with owner_id, so it also serves the foreign key and
-- every per-owner read.

create policy "owners read their achievements"
  on public.achievements
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "owners record their own achievements"
  on public.achievements
  for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

revoke all on public.achievements from anon, authenticated;
grant select, insert on public.achievements to authenticated;

-- ===========================================================================
-- achievement_stats()
-- ===========================================================================
--
-- One row per key held by at least one account: the share of accounts that
-- hold it, as a whole percent. The denominator is every account that is not
-- anonymous, so an account that never opened a build with achievements counts
-- as one that holds none. Anonymous accounts are left out of both sides: they
-- are minted without a form, and counting them would let anybody move the
-- numbers.
--
-- The percent is at least 1 for a key anybody holds, so "nobody" and "almost
-- nobody" do not read the same. No count leaves the function: with a handful of
-- accounts, a count would say which of them did what.

create or replace function public.achievement_stats()
  returns table (key text, percent integer)
  language plpgsql
  stable
  security definer
  set search_path = ''
as $$
declare
  v_accounts bigint;
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '28000', hint = 'unauthenticated';
  end if;

  select count(*) into v_accounts
  from auth.users u
  where not coalesce(u.is_anonymous, false);

  if v_accounts = 0 then
    return;
  end if;

  return query
    select a.key,
           greatest(1, round(100.0 * count(*) / v_accounts))::integer
    from public.achievements a
    join auth.users u on u.id = a.owner_id
    where not coalesce(u.is_anonymous, false)
    group by a.key
    order by a.key;
end;
$$;

revoke all on function public.achievement_stats() from public, anon, authenticated;
grant execute on function public.achievement_stats() to authenticated;
