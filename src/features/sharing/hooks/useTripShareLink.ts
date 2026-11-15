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

import { captureEvent } from '@/lib/posthog';
import { useAuth } from '@/features/auth/AuthContext';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { Trip } from '@/types';

import { getTripInviteLink, inviteUrlFor } from '../utils/invite-link';

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
  /** The token a viewer trip is read through: the link to hand on, as is. */
  const viewerToken = trip?.viewerToken ?? null;
  /** The trip's last day, which is what decides how long a new link lives. */
  const endDate = trip?.endDate ?? null;

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

    // A viewer holds the link already. Forwarding it is what people do with an
    // invitation, and it costs no account and no server call — the same token
    // opens the same trip for the next person, read-only, until it expires.
    if (viewerToken !== null) {
      setState({
        kind: 'invite',
        token: viewerToken,
        url: inviteUrlFor(viewerToken),
      });
      return;
    }

    // Decided before the session is consulted, because there is no session to
    // wait for.
    if (!isAvailable) {
      captureEvent('trip_share_blocked', { reason: 'no-backend' });
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
      captureEvent('trip_share_blocked', { reason: 'needs-account' });
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

      // The server steps live in `getTripInviteLink`, which the assistant's
      // `createInviteLink` action shares, so both hand out the same link.
      const result = await getTripInviteLink(client, userId, tripId, endDate);
      if (cancelled || !isMountedRef.current) {
        return;
      }
      setState(result);
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
  }, [attempt, enabled, endDate, isAvailable, isResolved, tripId, userId, viewerToken]);

  const refresh = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return { state, refresh };
}
