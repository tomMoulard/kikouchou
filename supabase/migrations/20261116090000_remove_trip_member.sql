-- Removing a member from a trip: the organiser's control over who is on it.
--
-- App Review asks an app with shared content for a way to act on the people
-- who see it. A trip is private to the people its organiser invited, so the
-- control that fits is the organiser taking someone off the roster.
--
-- trip_members has no DELETE policy for this and gets none: the only delete a
-- client holds is "members may leave", which matches the caller's own row. A
-- privileged write goes in a security definer function that checks the caller
-- first, as redeem_invite and delete_my_account do.
--
-- Three things go together, or the removal does not hold:
-- - the roster row, which is what every trip policy reads through
--   private.my_trip_ids();
-- - every live invite of the trip. redeem_invite lets anybody holding a live
--   link back on, the removed person included, and the link they joined with
--   is in their history. The organiser's next share mints a fresh link;
-- - the removed account's reminder subscriptions for the trip, which carry no
--   invite token, so live_push_subscriptions would keep sending them.
--
-- The removed person's device keeps the copy it already had. Nothing on the
-- server can reach into it; what stops is every read and write after this.

create or replace function public.remove_trip_member(
  target_trip_id uuid,
  target_user_id uuid
) returns void
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id from public.trips where id = target_trip_id;

  -- `is distinct from`, not `<>`: for a caller with no session auth.uid() is
  -- null, and `owner <> null` is null, which an `if` reads as false.
  -- An unknown trip answers the same as somebody else's, so the function is
  -- no oracle for which trip ids exist.
  if v_owner_id is null or v_owner_id is distinct from (select auth.uid()) then
    raise exception 'only the trip organiser can remove a member'
      using errcode = '42501', hint = 'not_trip_owner';
  end if;

  if target_user_id = v_owner_id then
    raise exception 'the trip organiser cannot be removed'
      using errcode = '22023', hint = 'owner_not_removable';
  end if;

  delete from public.trip_members
   where trip_id = target_trip_id
     and user_id = target_user_id;

  update public.trip_invites
     set revoked_at = now()
   where trip_id = target_trip_id
     and revoked_at is null;

  delete from public.push_subscriptions
   where trip_id = target_trip_id
     and user_id = target_user_id;
end;
$$;

revoke all on function public.remove_trip_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_trip_member(uuid, uuid) to authenticated;
