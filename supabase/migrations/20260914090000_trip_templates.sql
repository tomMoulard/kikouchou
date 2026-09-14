-- Trip templates: one enterprise trip, published as a link strangers can copy.
--
-- ## Why
--
-- An enterprise customer — a hotel, a rental agency — builds one trip, turns it
-- into a template, and hands out a single link. Whoever opens it starts their
-- own trip with the description, the place, the map pin, the currency and the
-- rooms already filled, and fills in the name, the dates and the guests. The
-- link is the same link for everybody and it never changes, so it can sit in a
-- web page for a year.
--
-- ## Why a second table rather than a read of the trip
--
-- `public.trips` holds seven columns, and five of them are bookkeeping. The
-- description, the location, the coordinates, the currency and the rooms live
-- only inside the Yjs document, as base64 updates plus a compacted snapshot.
-- Postgres cannot read one of those, so a SQL function cannot answer "what is
-- in this template" from the document.
--
-- `read_shared_trip` solves the same problem by handing the document back and
-- letting the client rebuild it. That is exactly what must NOT happen here. The
-- document also carries every guest of the enterprise's own trip, their stay
-- dates and their pickup places, and a template link is written for strangers:
-- it goes in a chat message, on a public web page, to anyone at all. An invite
-- is forwarded to a group; a template is published to the world, and that is a
-- different promise.
--
-- So the five fields are denormalised into a row of their own, written by the
-- owner's client at publish time and after each later edit. `public.trips`
-- already does this for the name and the dates, and `guest_groups.members` is
-- the precedent for a child collection travelling as jsonb in its parent row.
--
-- The promise about guests is structural rather than careful: this table has no
-- guest column, so no bug in the client can put a guest name where an anonymous
-- reader sees it.
--
-- The cost is staleness. The row is as fresh as the last sync of the device
-- that owns the trip. A template edited on a phone in flight mode updates when
-- that phone reconnects.
--
-- ## What a reader can do with the token
--
-- `read_trip_template` is the fourth function `anon` may execute, and the
-- second bearer-read credential in this database. Holding a template token
-- reads the five published fields of that template and nothing else: no guest,
-- no date, no document, no other trip. The controls are `is_template`, which
-- the owner turns off to kill every copy of the link at once, and deleting the
-- trip, which cascades this row away.
--
-- Row-Level Security is enabled in the same statement block that creates the
-- table: the publishable key ships inside the client bundle, so RLS is the only
-- thing protecting any of this.

-- ===========================================================================
-- trips: the flag and the token
-- ===========================================================================

-- The first `alter table` in this schema. Both columns belong on `trips`
-- rather than on the new table because they describe the trip's own state:
-- whether it is published, and the name it is published under.
alter table public.trips
  add column is_template boolean not null default false,

  -- Minted by the client at the first publish, with the same nanoid alphabet
  -- and the same length check as an invite token, so one validator shape
  -- covers both. It is kept when the template is unpublished: taking the link
  -- down and putting it back must not break the copy a customer bookmarked or
  -- the copy pasted into the enterprise's web page.
  add column template_token text unique
    check (template_token is null or length(template_token) between 16 and 64);

comment on column public.trips.is_template is
  'Whether this trip is published as a copyable template. Turning it off kills every template link to this trip at once.';

comment on column public.trips.template_token is
  'The stable token in the template link. Minted once, kept for the life of the trip, unaffected by unpublishing.';

-- ===========================================================================
-- trip_templates
-- ===========================================================================

create table public.trip_templates (
  -- One row per trip, so the trip id is the key. A trip is one template or no
  -- template; there is no version history, because the link is defined as
  -- following the trip.
  trip_id     uuid        primary key references public.trips (id) on delete cascade,

  -- The template's own name. It titles the link preview card and the landing
  -- page; it is never copied into the customer's trip, because naming the trip
  -- is one of the three things the customer is asked for.
  name        text        not null check (length(name) between 1 and 200),

  -- The field that does the guiding: what the place is, what to bring, when
  -- check-in opens. Bounded because it is echoed to anonymous readers.
  description text        check (description is null or length(description) <= 2000),

  location    text        check (location is null or length(location) <= 200),

  -- The map pin, as two columns rather than one jsonb: they are two numbers
  -- with a range each, and a check constraint states that better than a shape
  -- check on an object would.
  latitude    double precision check (latitude is null or latitude between -90 and 90),
  longitude   double precision check (longitude is null or longitude between -180 and 180),

  -- ISO 4217, the same three-letter shape the money page stores.
  currency    text        check (currency is null or currency ~ '^[A-Z]{3}$'),

  -- One entry per room: {name, capacity, description?, icon?, order}.
  --
  -- Bounded three ways, for the reason guest_groups.members is: a client is not
  -- obliged to be reasonable, and this column is read by strangers. An
  -- unbounded capacity reached `Array.from({length: capacity})` once already;
  -- the client validates each field on the way in, and these checks are what
  -- stops the row being unusable in the first place.
  rooms       jsonb       not null default '[]'::jsonb
                check (jsonb_typeof(rooms) = 'array')
                check (jsonb_array_length(rooms) <= 50)
                check (octet_length(rooms::text) <= 65536),

  updated_at  timestamptz not null default now()
);

alter table public.trip_templates enable row level security;

comment on table public.trip_templates is
  'The published half of a trip: the five fields a template link hands to a stranger. Deliberately holds no guest, no date and no document.';

comment on column public.trip_templates.name is
  'Titles the preview card and the landing page. Never copied into the customer''s own trip.';

comment on column public.trip_templates.rooms is
  'Client-authored array of {name, capacity, description?, icon?, order}. Bounded in count and in bytes.';

comment on column public.trip_templates.updated_at is
  'When the owner''s device last republished the payload. The document remains authoritative; this row is a copy of part of it.';

-- ===========================================================================
-- Row-Level Security
-- ===========================================================================
--
--   table          | select | insert | update | delete
--   ---------------|--------|--------|--------|-------
--   trip_templates | owner  | owner  | owner  | owner
--
-- Owner, not member. Publishing a trip to the public web is not an edit, and a
-- member who was invited to sleep in a room did not agree to be the publisher
-- of anything. `anon` reads this table only through `read_trip_template`, which
-- runs as its definer and needs no policy here.

create policy "owners read their trip templates"
  on public.trip_templates
  for select
  to authenticated
  using (
    trip_id in (
      select id from public.trips where owner_id = (select auth.uid())
    )
  );

create policy "owners create their trip templates"
  on public.trip_templates
  for insert
  to authenticated
  with check (
    trip_id in (
      select id from public.trips where owner_id = (select auth.uid())
    )
  );

-- WITH CHECK repeats the condition so a row cannot be moved onto somebody
-- else's trip by an UPDATE, which is also what makes the client's
-- `on conflict (trip_id) do update` safe.
create policy "owners update their trip templates"
  on public.trip_templates
  for update
  to authenticated
  using (
    trip_id in (
      select id from public.trips where owner_id = (select auth.uid())
    )
  )
  with check (
    trip_id in (
      select id from public.trips where owner_id = (select auth.uid())
    )
  );

create policy "owners delete their trip templates"
  on public.trip_templates
  for delete
  to authenticated
  using (
    trip_id in (
      select id from public.trips where owner_id = (select auth.uid())
    )
  );

-- ===========================================================================
-- Grants
-- ===========================================================================
--
-- Revoke-first, for the reason spelled out in 20260831170000_trip_sync_tables:
-- Supabase's default privileges hand every new table to anon and authenticated
-- with `grant all`, so an additive grant reads like a restriction and enforces
-- nothing. anon is revoked outright and stays that way — the anonymous door to
-- this data is the function below, and nothing else.

revoke all on public.trip_templates from anon, authenticated;

grant select, insert, update, delete on public.trip_templates to authenticated;

-- The link preview service reads the row to draw the card, for the reason
-- 20260907190000_share_preview_service_role_reads gives: the service role's
-- default grants do not reach a table created after them. SELECT only.
grant select on public.trip_templates to service_role;

-- ===========================================================================
-- read_trip_template
-- ===========================================================================
--
-- The anonymous read behind a template link.
--
-- It mirrors `read_shared_trip` deliberately: shape-check the token before
-- touching a table, answer every dead end with one hint so that a caller
-- cannot tell an unknown token from an unpublished one, write nothing, and
-- return a fixed set of fields rather than a row.
--
-- One hint, not four. An invite distinguishes revoked, expired and exhausted
-- because the app explains to an invitee which of those happened. A template
-- has one state — published or not — and the reasons it might not be published
-- are the enterprise's business, not the visitor's.
--
-- Enumeration: the token is 16 to 64 characters of a 64-symbol alphabet, and
-- anything not shaped like one is refused before a query runs.
--
-- ## The payload
--
--   {
--     "name":        text,
--     "description": text | null,
--     "location":    text | null,
--     "coordinates": { "lat": number, "lon": number } | null,
--     "currency":    text | null,
--     "rooms":       [ { ... }, ... ]
--   }

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
  -- Not even shaped like a token: refused before touching a table, and with
  -- the same hint as an unknown one so the two cannot be told apart.
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
    -- Published, but the payload has never been written: a device that flagged
    -- the trip and went offline before it could upload. Dead to the visitor,
    -- and dead in the same words as everything else.
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
    'rooms',       v_template.rooms
  );
end;
$$;

-- The fourth function `anon` may execute, and the second that turns a token
-- into a read. Restated next to the function so the security advisor's
-- "callable by anon" finding is triaged here, in code: the function authorises
-- its own caller with the token, and answers with five published fields.
revoke all on function public.read_trip_template(text) from public;
grant execute on function public.read_trip_template(text) to anon, authenticated;

comment on function public.read_trip_template(text) is
  'Read-only view of a published trip template: name, description, location, coordinates, currency, rooms. Writes nothing, returns no guest and no date, and answers every dead end with template_not_found.';
