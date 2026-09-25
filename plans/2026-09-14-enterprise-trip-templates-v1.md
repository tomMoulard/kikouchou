# Enterprise trip templates, v1

Date: 2026-09-14
Flag: `ent-trip-templates` (PostHog 275578). It is released at 100% to the
static cohort "enterprise customers" (PostHog 239646).

## The story

An enterprise customer, for example a hotel or a rental agency, builds one trip
and publishes it as a template. The publish gives one link that never changes.
The enterprise puts that link in a chat message or on its own website.

A customer opens the link, reads a preview card, and lands in the kikouchou
trip wizard. The description, the location, the map pin, the currency and the
rooms are already filled. The customer fills the trip name, the dates and the
guests. The description of the template guides the customer.

## The decisions

These were taken with the product owner on 2026-09-14.

1. A template is a normal trip with a flag, not a separate entity. The link is a
   stable deeplink. The content behind it follows the trip.
2. The copy carries the description, the location, the map coordinates, the
   currency and the rooms. It carries nothing else. The name, the dates, the
   guests, the activities, the rides and the documents stay behind.
3. The customer stays anonymous. The new trip is a local trip, like any trip the
   person makes alone. Nothing is synced and the enterprise never sees it.
4. The flag gates the authoring side only. A link that exists keeps working for
   whoever opens it.
5. `share.kikouchou.app` answers the link with a branded card. The card carries
   the template data and a small kikouchou line.
6. The enterprise cohort is a static PostHog cohort. A person joins it by hand.
   No code path adds a member.

## Why a payload table, and not a read of the trip

The server holds almost nothing about a trip. `public.trips` has six columns:
`id`, `local_id`, `owner_id`, `name`, `start_date`, `end_date`. The other five
fields live only inside the Yjs document. That document is an append-only log of
updates plus a compacted snapshot.

That leaves two bad options and one good one.

* Return the document, the way `read_shared_trip` does. The document also holds
  every guest name and every stay date of the enterprise's own trip. A template
  link is meant for strangers, so this option leaks.
* Rebuild the document in Postgres. Postgres cannot read a Yjs update.
* Denormalize. The owner's device writes the five template fields into a small
  table at publish time, and again after each edit of a published template.

This plan takes the third option. It matches what `trips` already does with
`name`, `start_date` and `end_date`. That is a cheap copy for a reader who
cannot hydrate the document, and the document stays authoritative. The option
also gives the preview service its data with no Yjs rebuild.

It makes the promise about guests structural. The table holds no guest column,
so no bug can put a guest name in it.

The cost is staleness. A device that is offline updates the row at its next
sync. This is written down here so that nobody reads the link as live.

## The data model

A new migration adds four things.

`public.trips.is_template`, a boolean that is not null and defaults to false.

`public.trips.template_token`, a unique text column. The first publish mints the
token. The trip then keeps it for life. Unpublish sets `is_template` to false
and keeps the token, so a republish gives back the same link.

`public.trip_templates`, one row for each published trip. It holds the trip id,
the name, the description, the location, the coordinates, the currency, the
rooms as JSON, and an update timestamp. Row-Level Security is enabled in the
same block that creates the table. The `anon` role gets no privilege on it.

`public.read_trip_template(template_token text)`, which returns `jsonb`. It is
`security definer` and `stable`, and `anon` holds EXECUTE on it. It follows
`read_shared_trip` exactly. It refuses a badly shaped token before it touches a
table. It answers an unknown token, a deleted trip and an unpublished template
with one hint, `template_not_found`.

## What is not in this version

* No organization, no tenant and no billing. The cohort is the whole definition
  of "enterprise".
* No count of the trips created from a template. The customer is anonymous and
  the copy is local, so the server has nothing to count.
* No change to `useFeatureFlag`. The hook settles once and then stops listening.
  An enterprise customer who signs in sees the authoring control after a page
  reload. The product owner accepted this on 2026-09-14.
