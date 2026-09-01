/**
 * @fileoverview Produces the link the share dialog shows.
 *
 * Three outcomes, chosen in this order, because each is the best available given
 * what exists:
 *
 * 1. **No backend configured** — nothing to offer, said plainly. This used to
 *    fall back to a peer-to-peer link; that transport is gone, so there is no
 *    link a server-less build can hand out. Reporting it is the whole job here,
 *    because the alternative is a dialog that waits for something that is never
 *    coming.
 * 2. **Backend, but signed out** — no link. Sharing needs an account, and
 *    saying so is better than handing over a link that syncs with nobody.
 * 3. **Signed in** — an account-backed invite: revocable, and it works between
 *    two phones on different networks, which the P2P link never did.
 *
 * The invite is *reused* rather than minted per open. Opening the dialog three
 * times should not leave three live links on a trip, and the one already handed
 * out has to keep working.
 *
 * @module features/sharing/hooks/useTripShareLink
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import posthog from '@/lib/posthog';
import { useAuth } from '@/features/auth/AuthContext';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  buildInviteUrl,
  createInvite,
  isInviteUsable,
  listInvites,
} from '@/lib/sync/invites';
import { ensureRemoteTrip } from '@/lib/sync/remote-trip';
import { uploadTripDocument } from '@/lib/sync/upload-document';
import type { Trip } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export type ShareLinkState =
  | { readonly kind: 'loading' }
  /** A shareable, revocable link backed by the account. */
  | { readonly kind: 'invite'; readonly url: string; readonly token: string }
  /** No account yet: the dialog should offer to sign in. */
  | { readonly kind: 'needs-account' }
  /**
   * No backend in this build, so there is no link to give.
   *
   * Distinct from `error`: nothing failed, the capability is simply absent, and
   * no amount of retrying will change that.
   */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'error'; readonly message: string };

// ============================================================================
// Hook
// ============================================================================

/**
 * @param trip - The trip being shared, or undefined when none is selected
 * @param enabled - Usually the dialog's `open`, so nothing runs while closed
 */
export function useTripShareLink(
  trip: Trip | undefined,
  enabled: boolean,
): { readonly state: ShareLinkState; readonly refresh: () => void } {
  const { user, isAvailable, isResolved } = useAuth();
  const [state, setState] = useState<ShareLinkState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const isMountedRef = useRef(true);

  /**
   * Identities, not objects.
   *
   * `trip` arrives from a Dexie live query, and the sync provider writes to the
   * `trips` table every time it projects a remote update — so the object is a
   * new one for reasons that have nothing to do with which trip is being shared.
   * Keyed on the object, the effect below restarted on each of those writes,
   * and since it opens by setting `loading`, the dialog dropped back to a
   * spinner over and over for as long as sync had anything to deliver. Each
   * restart also repeated the server work: `ensureRemoteTrip`, then a
   * `listInvites`, then possibly another mint.
   *
   * `user` is memoised by `AuthProvider` today, but reading the id here means
   * this hook no longer depends on that staying true.
   */
  const tripId = trip?.id ?? null;
  const userId = user?.id ?? null;

  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false forever.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || tripId === null) {
      return;
    }

    // Decided before the session is consulted, because there is no session to
    // wait for.
    if (!isAvailable) {
      posthog?.capture('trip_share_blocked', { reason: 'no-backend' });
      setState({ kind: 'unavailable' });
      return;
    }

    // Wait for the session lookup rather than concluding "signed out" from a
    // null that has not resolved yet.
    if (!isResolved) {
      setState({ kind: 'loading' });
      return;
    }

    if (userId === null) {
      // Where the sharing funnel most plausibly leaks: somebody wanted to share
      // and was asked to make an account first.
      posthog?.capture('trip_share_blocked', { reason: 'needs-account' });
      setState({ kind: 'needs-account' });
      return;
    }

    let cancelled = false;
    setState({ kind: 'loading' });

    const run = async (): Promise<void> => {
      const client = await getSupabaseClient();
      if (cancelled || !isMountedRef.current) {
        return;
      }
      if (!client) {
        // Configured but unusable — a malformed URL or key. Same outcome for the
        // user as no backend at all.
        setState({ kind: 'unavailable' });
        return;
      }

      const remote = await ensureRemoteTrip(client, userId, tripId);
      if (cancelled || !isMountedRef.current) {
        return;
      }
      if (remote.status === 'unauthenticated') {
        setState({ kind: 'needs-account' });
        return;
      }
      if (remote.status !== 'ready') {
        setState({
          kind: 'error',
          message:
            remote.status === 'missing'
              ? 'This trip is no longer on this device.'
              : remote.message,
        });
        return;
      }

      // Put the document on the server before handing out a link to it.
      //
      // Sync is mounted for the open trip only, so a trip shared from the list
      // while a different trip is open would otherwise get a server row and an
      // invite with no document behind them — and the invitee would sit on
      // "Getting the trip…" indefinitely, seeing the name and dates from the
      // preview row and none of the contents.
      //
      // Awaited, and a failure is reported rather than swallowed: a link to an
      // empty trip is worse than being told the share did not work.
      const uploaded = await uploadTripDocument(client, tripId, remote.remoteTripId);
      if (cancelled || !isMountedRef.current) {
        return;
      }
      if (uploaded.status === 'error') {
        posthog?.capture('trip_share_blocked', { reason: 'upload-failed' });
        setState({
          kind: 'error',
          message: uploaded.message,
        });
        return;
      }

      // Reuse a live invite before minting another, so opening the dialog
      // repeatedly does not litter the trip with links.
      const existing = (await listInvites(client, remote.remoteTripId)).find((invite) =>
        isInviteUsable(invite),
      );
      if (cancelled || !isMountedRef.current) {
        return;
      }

      const token = existing
        ? existing.token
        : await mintToken(client, remote.remoteTripId, userId);
      if (cancelled || !isMountedRef.current) {
        return;
      }
      if (token === null) {
        setState({ kind: 'error', message: 'Could not create a share link.' });
        return;
      }

      // `reused` is the interesting half: minting a link every time somebody
      // opens the dialog would litter the trip with live invites, so this
      // distinguishes "shared again" from "shared for the first time".
      posthog?.capture('trip_invite_ready', { reused: existing !== undefined });

      setState({
        kind: 'invite',
        token,
        // Read from `window` here, in a hook a component owns — `lib/` must not.
        url: buildInviteUrl(
          window.location.origin,
          import.meta.env.BASE_URL || '/',
          token,
        ),
      });
    };

    void run().catch((error: unknown) => {
      if (!cancelled && isMountedRef.current) {
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [attempt, enabled, isAvailable, isResolved, tripId, userId]);

  const refresh = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return { state, refresh };
}

// ============================================================================
// Internals
// ============================================================================

async function mintToken(
  client: Parameters<typeof createInvite>[0],
  remoteTripId: string,
  userId: string,
): Promise<string | null> {
  const created = await createInvite(client, remoteTripId, userId);
  return created.status === 'created' ? created.invite.token : null;
}
