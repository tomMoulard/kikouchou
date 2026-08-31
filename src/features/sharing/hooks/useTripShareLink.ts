/**
 * @fileoverview Produces the link the share dialog shows.
 *
 * Three outcomes, chosen in this order, because each is the best available given
 * what exists:
 *
 * 1. **No backend configured** — the legacy peer-to-peer link. A build with no
 *    server can still share on a LAN, and taking that away would be a
 *    regression for anyone self-hosting.
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

import { useAuth } from '@/features/auth/AuthContext';
import { getSupabaseClient } from '@/lib/supabase/client';
import {
  buildInviteUrl,
  createInvite,
  isInviteUsable,
  listInvites,
} from '@/lib/sync/invites';
import { ensureRemoteTrip } from '@/lib/sync/remote-trip';
import type { Trip, TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export type ShareLinkState =
  | { readonly kind: 'loading' }
  /** A shareable, revocable link backed by the account. */
  | { readonly kind: 'invite'; readonly url: string; readonly token: string }
  /** No account yet: the dialog should offer to sign in. */
  | { readonly kind: 'needs-account' }
  /** No backend in this build: the peer-to-peer link is all there is. */
  | { readonly kind: 'legacy' }
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

  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false forever.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !trip) {
      return;
    }

    // A build with no server keeps the peer-to-peer link. Decided before the
    // session is consulted, because there is no session to wait for.
    if (!isAvailable) {
      setState({ kind: 'legacy' });
      return;
    }

    // Wait for the session lookup rather than concluding "signed out" from a
    // null that has not resolved yet.
    if (!isResolved) {
      setState({ kind: 'loading' });
      return;
    }

    if (!user) {
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
        setState({ kind: 'legacy' });
        return;
      }

      const remote = await ensureRemoteTrip(client, user.id, trip.id as TripId);
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
        : await mintToken(client, remote.remoteTripId, user.id);
      if (cancelled || !isMountedRef.current) {
        return;
      }
      if (token === null) {
        setState({ kind: 'error', message: 'Could not create a share link.' });
        return;
      }

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
  }, [attempt, enabled, isAvailable, isResolved, trip, user]);

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
