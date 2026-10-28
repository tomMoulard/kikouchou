-- Cover photos for trips and rooms, and the photos a trip template hands on.
--
-- ## Why
--
-- A guest told "you sleep in the red room" wants to see the red room. A trip
-- and each of its rooms can now carry one photo, and every member of the trip
-- sees it.
--
-- ## Where the bytes live
--
-- The shared document carries a `photoId` on the trip and on each room, and
-- nothing else. The bytes go in the private `trip-photos` bucket, because the
-- document is an append-only log that every member replays on every start: a
-- photo written into it would be downloaded again, forever, by everybody.
--
-- Two prefixes, each with its own rule:
--
--   trips/<trips.id>/<photoId>            members of that trip read and add
--   templates/<template_token>/<photoId>  the owner adds, a link holder reads
--
-- An object is never updated or deleted by a client. A new photo is a new id,
-- so a replaced photo is never overwritten under somebody who is still looking
-- at it. The cost is orphaned bytes: a replaced photo, and the photos of a
-- deleted trip, stay in the bucket. Nobody can read them once the trip is gone,
-- because every read rule asks the trip.
--
-- ## The template prefix, and why it is keyed on the token
--
-- A template link is read by strangers with no account, through
-- `read_trip_template`. Its photos must be readable by the same strangers, and
-- by nobody else. Keying the prefix on the template token makes the token the
-- credential for the photos exactly as it is for the five published fields,
-- and `is_template` kills both at once. Keying it on `trips.id` would have
-- meant handing that id to anonymous readers, which nothing else does.
--
-- `anon` gets USAGE on `private` and EXECUTE on one function there, the check
-- the read rule needs: `anon` holds no privilege on `trips` or
-- `trip_templates`, so the rule cannot read them as its caller. The function
-- answers yes or no about one photo of one published template and returns no
-- row.

-- ===========================================================================
-- The bucket
-- ===========================================================================

-- Private: every read goes through the policies below. The client resizes a
-- photo to at most 1600 px and re-encodes it as WebP or JPEG before upload,
-- which lands well under the 2 MiB cap; the cap and the type list are what
-- hold when a client does not.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-photos',
  'trip-photos',
  false,
  2097152,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ===========================================================================
-- trip_templates: the cover photo travels with the template
-- ===========================================================================

-- The rooms' photos travel inside `rooms` as `photoId`, beside the name and
-- the capacity; that column is already bounded in count and in bytes.
alter table public.trip_templates
  add column photo_id text
    check (photo_id is null or photo_id ~ '^[A-Za-z0-9_-]{8,64}$');

comment on column public.trip_templates.photo_id is
  'The trip''s cover photo, stored at templates/<template_token>/<photo_id> in the trip-photos bucket.';

-- Same function, one more field. Everything else is unchanged from
-- 20260914090000_trip_templates; see the comments there.
create or replace function public.read_trip_template(template_token text)
  returns jsonb
  language plpgsql
  security definer
  stable
  set search_path = ''
as $$
declare
  v_trip     public.trips%rowtype;
  v_template public.trip_templates%rowtype;
begin
  if template_token is null
     or length(template_token) < 16
     or length(template_token) > 64 then
    raise exception 'template not found'
      using errcode = 'P0002', hint = 'template_not_found';
  end if;

  select * into v_trip
  from public.trips
  where trips.template_token = read_trip_template.template_token
    and trips.is_template;

  if not found then
    raise exception 'template not found'
      using errcode = 'P0002', hint = 'template_not_found';
  end if;

  select * into v_template
  from public.trip_templates
  where trip_id = v_trip.id;

  if not found then
    raise exception 'template not found'
      using errcode = 'P0002', hint = 'template_not_found';
  end if;

  return jsonb_build_object(
    'name',        v_template.name,
    'description', v_template.description,
    'location',    v_template.location,
    'coordinates', case
      when v_template.latitude is null or v_template.longitude is null then null
      else jsonb_build_object('lat', v_template.latitude, 'lon', v_template.longitude)
    end,
    'currency',    v_template.currency,
    'photoId',     v_template.photo_id,
    'rooms',       v_template.rooms
  );
end;
$$;

comment on function public.read_trip_template(text) is
  'Read-only view of a published trip template: name, description, location, coordinates, currency, cover photo id, rooms. Writes nothing, returns no guest and no date, and answers every dead end with template_not_found.';

-- ===========================================================================
-- private.is_published_template_photo
-- ===========================================================================

-- True when `photo_id` is the cover or a room photo of the published template
-- behind `template_token`. Checking the payload, and not only the token, means
-- a photo the owner has since replaced stops being served with the link.
create or replace function private.is_published_template_photo(
  template_token text,
  photo_id text
)
  returns boolean
  language sql
  security definer
  stable
  set search_path = ''
as $$
  select exists (
    select 1
    from public.trips t
    join public.trip_templates tt on tt.trip_id = t.id
    where t.template_token = is_published_template_photo.template_token
      and t.is_template
      and (
        tt.photo_id = is_published_template_photo.photo_id
        or tt.rooms @> jsonb_build_array(
          jsonb_build_object('photoId', is_published_template_photo.photo_id)
        )
      )
  );
$$;

-- A storage policy is privilege-checked against the caller, so both roles
-- that read a template need USAGE on the schema and EXECUTE on the function.
-- `private` has no REST endpoint, so this opens no new RPC.
grant usage on schema private to anon;
revoke all on function private.is_published_template_photo(text, text)
  from public, anon, authenticated;
grant execute on function private.is_published_template_photo(text, text)
  to anon, authenticated;

comment on function private.is_published_template_photo(text, text) is
  'Storage read rule for templates/<token>/<photo>: is this photo part of a published template. Returns a boolean only.';

-- ===========================================================================
-- Row-Level Security on storage.objects
-- ===========================================================================
--
--   prefix                | select              | insert
--   ----------------------|---------------------|-------------------
--   trips/<trip id>/      | members             | members
--   templates/<token>/    | anyone, if published| the trip's owner
--
-- No UPDATE and no DELETE policy: see "Where the bytes live". A viewer with
-- an invite link and no account reads no trip photo; that was decided on
-- 2026-10-29 with the feature.

create policy "members read their trip photos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'trip-photos'
    and (storage.foldername(objects.name))[1] = 'trips'
    and (storage.foldername(objects.name))[2] in (
      select id::text from private.my_trip_ids() as id
    )
  );

create policy "members add trip photos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'trip-photos'
    and (storage.foldername(objects.name))[1] = 'trips'
    and (storage.foldername(objects.name))[2] in (
      select id::text from private.my_trip_ids() as id
    )
  );

-- Owner, not member, for the reason the trip_templates policies give:
-- publishing to the public web is not an edit.
--
-- Every policy here writes `objects.name`: inside the subquery a bare `name`
-- resolves to `trips.name`, the trip's title, and the rule silently refused
-- every upload.
create policy "owners add template photos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'trip-photos'
    and (storage.foldername(objects.name))[1] = 'templates'
    and exists (
      select 1
      from public.trips t
      where t.template_token = (storage.foldername(objects.name))[2]
        and t.owner_id = (select auth.uid())
    )
  );

create policy "template photos are read with the link"
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'trip-photos'
    and (storage.foldername(objects.name))[1] = 'templates'
    and private.is_published_template_photo(
      (storage.foldername(objects.name))[2],
      storage.filename(objects.name)
    )
  );
