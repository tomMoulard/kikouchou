/**
 * @fileoverview The server steps that turn a trip into an invite link.
 *
 * Two callers need the same link: the share dialog (`useTripShareLink`) and
 * the assistant's `createInviteLink` action. Both go through this function, so
 * a link the assistant hands out is the one the dialog would have shown:
 * uploaded first, reused when a live one exists, and valid until a week after
 * the trip ends.
 *
 * It reads `window.location` to build the URL, which is why it lives in a
 * feature and not in `lib/`.
 *
 * @module features/sharing/utils/invite-link
 */

import { getCurrentLanguage } from '@/lib/i18n';
import { resolveLinkOrigin } from '@/lib/platform';
import { captureEvent } from '@/lib/posthog';
import type { TypedSupabaseClient } from '@/lib/supabase/client';
import {
  buildInviteUrl,
  createInvite,
  inviteExpiryForTrip,
  inviteOutlastsTrip,
  isInviteUsable,
  listInvites,
} from '@/lib/sync/invites';
import { ensureRemoteTrip } from '@/lib/sync/remote-trip';
import { uploadTripDocument } from '@/lib/sync/upload-document';
import type { TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** What asking for a trip's invite link came to. */
export type TripInviteLinkResult =
  | { readonly kind: 'invite'; readonly url: string; readonly token: string }
  /** The server says nobody is signed in. */
  | { readonly kind: 'needs-account' }
  | { readonly kind: 'error'; readonly message: string };

// ============================================================================
// Functions
// ============================================================================

/**
 * The public link for an invite token.
 *
 * The language goes into the link because the preview is rendered once, by a
 * crawler, before anybody sees it: the card is drawn in whatever language the
 * person sharing the trip is using, which is the best available guess at the
 * language of the chat it is pasted into.
 *
 * @param token - The invite token
 * @returns The URL to hand out
 */
export function inviteUrlFor(token: string): string {
  return buildInviteUrl(
    resolveLinkOrigin(window.location.origin),
    import.meta.env.BASE_URL || '/',
    token,
    {
      origin: import.meta.env.VITE_SHARE_ORIGIN ?? '',
      language: getCurrentLanguage(),
    },
  );
}

/**
 * Puts the trip on the server, then reuses or mints an invite for it.
 *
 * @param client - An authenticated Supabase client
 * @param userId - The signed-in account
 * @param tripId - The local trip
 * @param endDate - The trip's last day, which decides how long a new link lives
 * @returns The link, or why there is none
 */
export async function getTripInviteLink(
  client: TypedSupabaseClient,
  userId: string,
  tripId: TripId,
  endDate: string | null,
): Promise<TripInviteLinkResult> {
  const remote = await ensureRemoteTrip(client, userId, tripId);
  if (remote.status === 'unauthenticated') {
    return { kind: 'needs-account' };
  }
  if (remote.status !== 'ready') {
    return {
      kind: 'error',
      message:
        remote.status === 'missing'
          ? 'This trip is no longer on this device.'
          : remote.message,
    };
  }

  // Put the document on the server before handing out a link to it.
  //
  // Sync is mounted for the open trip only, so a trip shared from the list
  // while a different trip is open would otherwise get a server row and an
  // invite with no document behind them, and the invitee would sit on
  // "Getting the trip..." indefinitely, seeing the name and dates from the
  // preview row and none of the contents.
  //
  // Awaited, and a failure is reported rather than swallowed: a link to an
  // empty trip is worse than being told the share did not work.
  const uploaded = await uploadTripDocument(client, tripId, remote.remoteTripId);
  if (uploaded.status === 'error') {
    captureEvent('trip_share_blocked', { reason: 'upload-failed' });
    return { kind: 'error', message: uploaded.message };
  }

  // Reuse a live invite before minting another, so opening the dialog
  // repeatedly does not litter the trip with links, but only one that will
  // still work on the trip's last day. A link minted under the old one-month
  // default can be live today and dead before the trip starts.
  const existing = (await listInvites(client, remote.remoteTripId)).find(
    (invite) =>
      isInviteUsable(invite) && (endDate === null || inviteOutlastsTrip(invite, endDate)),
  );

  let token: string | null;
  if (existing) {
    token = existing.token;
  } else {
    // Without an end date the invite keeps its own one-month default.
    const created = await createInvite(
      client,
      remote.remoteTripId,
      userId,
      endDate === null ? {} : { expiresAt: inviteExpiryForTrip(endDate) },
    );
    token = created.status === 'created' ? created.invite.token : null;
  }
  if (token === null) {
    return { kind: 'error', message: 'Could not create a share link.' };
  }

  // `reused` is the interesting half: it tells "shared again" from "shared for
  // the first time".
  captureEvent('trip_invite_ready', { reused: existing !== undefined });

  return { kind: 'invite', token, url: inviteUrlFor(token) };
}
