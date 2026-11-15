/**
 * @fileoverview The server steps that publish a trip as a template, or take
 * it down.
 *
 * Two callers: the template card on the trip settings page
 * (`useTripTemplateLink`) and the assistant's `publishTemplate` and
 * `unpublishTemplate` actions. Both are behind the `ent-trip-templates` flag,
 * which the callers check: this module does not read flags.
 *
 * It reads `window.location` to build the URL, which is why it lives in a
 * feature and not in `lib/`.
 *
 * @module features/sharing/utils/template-link
 */

import { getCurrentLanguage } from '@/lib/i18n';
import { resolveLinkOrigin } from '@/lib/platform';
import { captureEvent } from '@/lib/posthog';
import type { TypedSupabaseClient } from '@/lib/supabase/client';
import { ensureRemoteTrip } from '@/lib/sync/remote-trip';
import {
  buildTemplateCardUrl,
  buildTemplatePayload,
  buildTemplateUrl,
  publishTemplate,
  readTemplateState,
  templatePhotoIds,
  unpublishTemplate,
  uploadTemplatePhotos,
} from '@/lib/sync/templates';
import type { Trip, TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** What publishing came to. */
export type PublishTripTemplateResult =
  | {
      readonly status: 'published';
      readonly url: string;
      readonly cardUrl: string | null;
      readonly token: string;
    }
  | { readonly status: 'error'; readonly message: string };

/** What taking the template down came to. */
export type UnpublishTripTemplateResult =
  | { readonly status: 'unpublished' }
  /** The trip has no server row, so there is nothing published to take down. */
  | { readonly status: 'not-on-server' }
  | { readonly status: 'error'; readonly message: string };

// ============================================================================
// Links
// ============================================================================

/** The preview service, and the language the publisher is reading in. */
function shareFor(): { readonly origin: string; readonly language: string } {
  return {
    origin: import.meta.env.VITE_SHARE_ORIGIN ?? '',
    language: getCurrentLanguage(),
  };
}

/**
 * The link for a template token.
 *
 * @param token - The template token
 * @returns The URL to hand out
 */
export function templateUrlFor(token: string): string {
  return buildTemplateUrl(
    resolveLinkOrigin(window.location.origin),
    import.meta.env.BASE_URL || '/',
    token,
    shareFor(),
  );
}

/**
 * The link's card for a template token.
 *
 * @param token - The template token
 * @returns The card URL, or null without a preview service
 */
export function templateCardUrlFor(token: string): string | null {
  return buildTemplateCardUrl(token, shareFor());
}

// ============================================================================
// Server steps
// ============================================================================

/**
 * Publishes the trip as a template, or republishes it under the same token.
 *
 * @param client - An authenticated Supabase client
 * @param userId - The signed-in account
 * @param trip - The local trip
 * @returns The link, or why there is none
 */
export async function publishTripTemplate(
  client: TypedSupabaseClient,
  userId: string,
  trip: Trip,
): Promise<PublishTripTemplateResult> {
  const remote = await ensureRemoteTrip(client, userId, trip.id);
  if (remote.status !== 'ready') {
    captureEvent('trip_template_publish_failed', { reason: remote.status });
    return {
      status: 'error',
      message: remote.status === 'error' ? remote.message : 'the trip is not on the server',
    };
  }

  const existing = await readTemplateState(client, remote.remoteTripId);
  const payload = await buildTemplatePayload(trip);
  const result = await publishTemplate(
    client,
    remote.remoteTripId,
    payload,
    existing.status === 'ok' ? existing.state.token : null,
  );

  if (result.status === 'error') {
    captureEvent('trip_template_publish_failed', { reason: 'write' });
    return { status: 'error', message: result.message };
  }

  // After the row, because the read rule checks the payload. A photo that
  // could not be copied is retried by the next refresh, not reported as a
  // failed publish: the link works without it.
  const photosFailed = await uploadTemplatePhotos(
    client,
    { id: trip.id, remoteTripId: remote.remoteTripId },
    payload,
  );
  captureEvent('trip_template_published', {
    room_count: payload.rooms.length,
    photo_count: templatePhotoIds(payload).length,
    photos_failed: photosFailed,
    has_description: payload.description !== null,
    republished: existing.status === 'ok' && existing.state.isTemplate,
  });

  return {
    status: 'published',
    url: templateUrlFor(result.token),
    cardUrl: templateCardUrlFor(result.token),
    token: result.token,
  };
}

/**
 * Takes the trip's template down. The token stays on the row, so publishing
 * again brings the same link back.
 *
 * @param client - An authenticated Supabase client
 * @param userId - The signed-in account
 * @param tripId - The local trip
 * @returns Whether it was taken down
 */
export async function unpublishTripTemplate(
  client: TypedSupabaseClient,
  userId: string,
  tripId: TripId,
): Promise<UnpublishTripTemplateResult> {
  const remote = await ensureRemoteTrip(client, userId, tripId);
  if (remote.status !== 'ready') {
    return { status: 'not-on-server' };
  }
  const result = await unpublishTemplate(client, remote.remoteTripId);
  if (result.status === 'error') {
    return { status: 'error', message: result.message };
  }
  captureEvent('trip_template_unpublished');
  return { status: 'unpublished' };
}
