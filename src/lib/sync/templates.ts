/**
 * @fileoverview Publishing a trip as a template, and reading one back.
 *
 * A template is a trip an enterprise customer publishes once and hands out as a
 * single link. Whoever opens the link starts their own trip with the place, the
 * description, the map pin, the currency and the rooms already filled, and
 * supplies the name, the dates and the guests.
 *
 * Two things make this different from an invite, and both are deliberate.
 *
 * The link never changes. `trips.template_token` is minted at the first publish
 * and kept for the life of the trip, because a template link goes into a web
 * page and a printed card, not into one group chat. Unpublishing sets
 * `is_template` to false and leaves the token alone, so putting the template
 * back gives the same link back.
 *
 * The reader gets a payload, not the document. `read_shared_trip` hands an
 * invitee the trip's whole Yjs document, guests and stay dates included, which
 * is right for somebody who was invited and wrong for a stranger who followed a
 * link from a web page. So the five published fields are copied into
 * `trip_templates` when the owner publishes, and that row is all an anonymous
 * reader can reach.
 *
 * The copy is as fresh as the last publish, and refreshing it is a button the
 * enterprise presses rather than something that happens on every edit. That is
 * deliberate: a room is not a column of the trip row, so an automatic refresh
 * keyed on the trip would look live while missing the edit customers notice
 * most. The screen says so instead of implying otherwise.
 *
 * @module lib/sync/templates
 */

import { nanoid } from 'nanoid';

import type { TypedSupabaseClient } from '@/lib/supabase/client';
import {
  normalizeCurrency,
  normalizeRoomIcon,
  type CurrencyCode,
  type RoomIcon,
} from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Token length.
 *
 * The same 16 characters of nanoid's 64-symbol alphabet an invite token uses —
 * 96 bits, and the same `length between 16 and 64` check on the server, so one
 * shape covers both kinds of link.
 */
const TOKEN_LENGTH = 16;

/** Path a template link points at inside the app. */
const TEMPLATE_PATH = 'template';

/** Path segment that tells the link preview service this is a template. */
const TEMPLATE_SHARE_SEGMENT = 't';

/** The server's bounds, restated so a payload is refused here rather than there. */
const MAX_NAME = 200;
const MAX_DESCRIPTION = 2_000;
const MAX_LOCATION = 200;
const MAX_ROOMS = 50;
const MAX_ROOM_NAME = 100;
const MAX_ROOM_CAPACITY = 50;

// ============================================================================
// Type Definitions
// ============================================================================

/** One room, as a template carries it. */
export interface TemplateRoom {
  readonly name: string;
  readonly capacity: number;
  readonly icon: RoomIcon;
}

/** Everything a template link hands to whoever opens it. */
export interface TripTemplatePayload {
  readonly name: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly coordinates: { readonly lat: number; readonly lon: number } | null;
  readonly currency: CurrencyCode | null;
  readonly rooms: readonly TemplateRoom[];
}

/** Whether a trip is published, under which token, and who may change that. */
export interface TemplateState {
  readonly isTemplate: boolean;
  readonly token: string | null;
  /**
   * The account that owns the server row, or null when the row is gone.
   *
   * Read because publishing is owner-only while reading is open to every member
   * of the trip: a member who is offered the two buttons gets a write that
   * Row-Level Security matches against no row, which reads as a broken app.
   * The screen compares this with the signed-in account instead.
   */
  readonly ownerId: string | null;
}

export type ReadTemplateStateResult =
  | { readonly status: 'ok'; readonly state: TemplateState }
  | { readonly status: 'error'; readonly message: string };

export type PublishTemplateResult =
  | { readonly status: 'published'; readonly token: string }
  | { readonly status: 'error'; readonly message: string };

export type UnpublishTemplateResult =
  | { readonly status: 'unpublished' }
  | { readonly status: 'error'; readonly message: string };

export type ReadTripTemplateResult =
  | { readonly status: 'ok'; readonly template: TripTemplatePayload }
  | { readonly status: 'not-found' }
  | { readonly status: 'error'; readonly message: string };

// ============================================================================
// Links
// ============================================================================

/**
 * The link to hand out for a template.
 *
 * Two shapes, and which one comes out depends on whether a share origin is
 * configured, exactly as {@link buildInviteUrl} decides it.
 *
 * **With one** — `https://share.kikouchou.app/fr/t/<token>`. That host draws a
 * card with the template's name, place and room count, so the link unfurls in a
 * chat and on a web page, then sends the visitor into the app.
 *
 * **Without one** — `https://app.kikouchou.app/template/<token>`, the direct
 * link, which works and shows the app's generic card.
 *
 * The `t` segment keeps template tokens and invite tokens in different
 * namespaces on the preview service. One link shape can then never be resolved
 * as the other, whatever a token happens to look like.
 *
 * Takes the origin and base path as arguments rather than reading
 * `window.location`, because nothing under `lib/` may read the URL.
 *
 * @param origin - e.g. `https://app.kikouchou.app`
 * @param basePath - Vite's `BASE_URL`
 * @param token - The template token
 * @param share - The preview service's origin and the language to show it in
 * @returns An absolute URL
 */
export function buildTemplateUrl(
  origin: string,
  basePath: string,
  token: string,
  share?: { readonly origin: string; readonly language: string },
): string {
  if (share !== undefined && share.origin !== '') {
    const shareOrigin = share.origin.replace(/\/+$/, '');
    return `${shareOrigin}/${share.language}/${TEMPLATE_SHARE_SEGMENT}/${encodeURIComponent(token)}`;
  }
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  return `${origin}${base}${TEMPLATE_PATH}/${encodeURIComponent(token)}`;
}

// ============================================================================
// Bounds
// ============================================================================

/**
 * Trims a remote string to a length this app can render, or drops it.
 *
 * @param value - Anything the server returned
 * @param max - The longest string worth keeping
 * @returns The trimmed string, or null when there is nothing to show
 */
function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, max);
}

/**
 * Reads one room out of a template payload, or drops it.
 *
 * A bad room is dropped on its own rather than failing the template: a
 * customer who gets four of five rooms has something to work with, and the
 * fifth is one line to add. An unbounded capacity is the specific hazard —
 * `Array.from({ length: capacity })` OOM'd a tab once already.
 */
function parseRoom(raw: unknown): TemplateRoom | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;

  const name = boundedText(record.name, MAX_ROOM_NAME);
  if (name === null) {
    return null;
  }

  const capacityRaw = record.capacity;
  if (typeof capacityRaw !== 'number' || !Number.isFinite(capacityRaw)) {
    return null;
  }
  const capacity = Math.min(Math.max(Math.round(capacityRaw), 1), MAX_ROOM_CAPACITY);

  return { name, capacity, icon: normalizeRoomIcon(record.icon) };
}

/**
 * Bounds the function's answer before anything acts on it.
 *
 * Returns `null` for a payload with no usable template in it, which the caller
 * reports as an error. Everything optional is dropped rather than defaulted:
 * a template with no description shows no description, and a customer who
 * needed one asks the enterprise for it.
 */
function parsePayload(data: unknown): TripTemplatePayload | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;

  const name = boundedText(record.name, MAX_NAME);
  if (name === null) {
    return null;
  }

  let coordinates: TripTemplatePayload['coordinates'] = null;
  const coordinatesRaw = record.coordinates;
  if (typeof coordinatesRaw === 'object' && coordinatesRaw !== null) {
    const candidate = coordinatesRaw as Record<string, unknown>;
    const { lat, lon } = candidate;
    if (
      typeof lat === 'number' &&
      Number.isFinite(lat) &&
      lat >= -90 &&
      lat <= 90 &&
      typeof lon === 'number' &&
      Number.isFinite(lon) &&
      lon >= -180 &&
      lon <= 180
    ) {
      coordinates = { lat, lon };
    }
  }

  const rooms: TemplateRoom[] = [];
  if (Array.isArray(record.rooms)) {
    for (const roomRaw of record.rooms.slice(0, MAX_ROOMS)) {
      const room = parseRoom(roomRaw);
      if (room !== null) {
        rooms.push(room);
      }
    }
  }

  const currencyRaw = record.currency;

  return {
    name,
    description: boundedText(record.description, MAX_DESCRIPTION),
    location: boundedText(record.location, MAX_LOCATION),
    coordinates,
    currency: typeof currencyRaw === 'string' ? normalizeCurrency(currencyRaw) : null,
    rooms,
  };
}

// ============================================================================
// Server operations
// ============================================================================

/**
 * Whether a trip is published as a template, under which token, and who owns it.
 *
 * @param client - Authenticated Supabase client
 * @param remoteTripId - Server `trips.id`
 */
export async function readTemplateState(
  client: TypedSupabaseClient,
  remoteTripId: string,
): Promise<ReadTemplateStateResult> {
  try {
    const { data, error } = await client
      .from('trips')
      .select('is_template, template_token, owner_id')
      .eq('id', remoteTripId)
      .maybeSingle();

    if (error) {
      return { status: 'error', message: error.message };
    }
    if (!data) {
      // The owner's own trip is readable by its own policy, so no row means the
      // trip was deleted from another device between the two reads.
      return { status: 'ok', state: { isTemplate: false, token: null, ownerId: null } };
    }
    return {
      status: 'ok',
      state: {
        isTemplate: data.is_template === true,
        token: typeof data.template_token === 'string' ? data.template_token : null,
        ownerId: typeof data.owner_id === 'string' ? data.owner_id : null,
      },
    };
  } catch (error: unknown) {
    return { status: 'error', message: toMessage(error) };
  }
}

/**
 * Publishes a trip as a template, and writes the payload readers will see.
 *
 * The token is minted only when the trip has none. Republishing a trip that was
 * taken down therefore hands back the link that is already in the enterprise's
 * web page, which is the whole reason the token outlives the flag.
 *
 * The two writes are not a transaction, and the order is the safe one: the
 * payload first, then the flag. A publish that dies in between leaves a payload
 * nobody can reach, which is invisible. The other order would leave a published
 * trip with no payload, and every visitor would see a dead link.
 *
 * @param client - Authenticated Supabase client
 * @param remoteTripId - Server `trips.id`
 * @param payload - The five fields to publish
 * @param existingToken - The trip's token, when it already has one
 */
export async function publishTemplate(
  client: TypedSupabaseClient,
  remoteTripId: string,
  payload: TripTemplatePayload,
  existingToken: string | null = null,
): Promise<PublishTemplateResult> {
  const token = existingToken ?? nanoid(TOKEN_LENGTH);

  try {
    const { error: payloadError } = await client.from('trip_templates').upsert(
      {
        trip_id: remoteTripId,
        name: payload.name.slice(0, MAX_NAME),
        description: payload.description?.slice(0, MAX_DESCRIPTION) ?? null,
        location: payload.location?.slice(0, MAX_LOCATION) ?? null,
        latitude: payload.coordinates?.lat ?? null,
        longitude: payload.coordinates?.lon ?? null,
        currency: payload.currency ?? null,
        rooms: payload.rooms.slice(0, MAX_ROOMS).map((room) => ({
          name: room.name.slice(0, MAX_ROOM_NAME),
          capacity: room.capacity,
          icon: room.icon,
        })),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'trip_id' },
    );

    if (payloadError) {
      return { status: 'error', message: payloadError.message };
    }

    const { data, error } = await client
      .from('trips')
      .update({ is_template: true, template_token: token })
      .eq('id', remoteTripId)
      .select('template_token');

    if (error) {
      return { status: 'error', message: error.message };
    }
    // An UPDATE matching no row succeeds with no error, so the affected rows
    // are what says whether this device may publish this trip at all.
    const updated = data?.[0]?.template_token;
    if (typeof updated !== 'string') {
      return { status: 'error', message: 'the trip could not be published' };
    }
    return { status: 'published', token: updated };
  } catch (error: unknown) {
    return { status: 'error', message: toMessage(error) };
  }
}

/**
 * Takes a template down, without losing its link.
 *
 * Every copy of the link stops working at once — the one in the web page, the
 * one in a bookmark, the one forwarded three chats ago. The payload row stays,
 * because `read_trip_template` refuses on the flag and a kept payload is what
 * makes republishing instant.
 *
 * @param client - Authenticated Supabase client
 * @param remoteTripId - Server `trips.id`
 */
export async function unpublishTemplate(
  client: TypedSupabaseClient,
  remoteTripId: string,
): Promise<UnpublishTemplateResult> {
  try {
    const { data, error } = await client
      .from('trips')
      .update({ is_template: false })
      .eq('id', remoteTripId)
      .select('id');

    if (error) {
      return { status: 'error', message: error.message };
    }
    if (!data || data.length === 0) {
      return { status: 'error', message: 'the template could not be taken down' };
    }
    return { status: 'unpublished' };
  } catch (error: unknown) {
    return { status: 'error', message: toMessage(error) };
  }
}

/**
 * Reads the template behind a link, with or without an account.
 *
 * Every dead end — an unknown token, a token that is not shaped like one, a
 * trip that was deleted, a template taken down — comes back as `not-found`,
 * because the function answers all four with one hint on purpose. Whether an
 * enterprise ever published anything is not the visitor's business.
 *
 * @param client - Any Supabase client, signed in or not
 * @param token - The token out of the link
 */
export async function readTripTemplate(
  client: TypedSupabaseClient,
  token: string,
): Promise<ReadTripTemplateResult> {
  try {
    const { data, error } = await client.rpc('read_trip_template', {
      template_token: token,
    });

    if (error) {
      if (error.hint === 'template_not_found') {
        return { status: 'not-found' };
      }
      return { status: 'error', message: error.message };
    }

    const template = parsePayload(data);
    if (template === null) {
      return { status: 'error', message: 'the server answered with something unreadable' };
    }
    return { status: 'ok', template };
  } catch (error: unknown) {
    // Offline: the fetch rejects rather than returning an error.
    return { status: 'error', message: toMessage(error) };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
