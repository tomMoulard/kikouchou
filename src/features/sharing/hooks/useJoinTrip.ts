/**
 * @fileoverview Drives the join flow: read or redeem, materialise, then hydrate.
 *
 * Kept out of the page component because the sequence has real states worth
 * testing on their own — each way an invite can be unusable, the two ways in
 * (an account, or no account), and the wait while the document downloads
 * before participants can be offered.
 *
 * Two ways in, decided by whether a session exists:
 *
 * - **Signed in** — `redeem_invite` puts the account on the roster, the trip
 *   is materialised as a member trip, and the identity step claims a
 *   participant on the server. Unchanged from before.
 * - **Signed out** — `read_shared_trip` fetches the trip through the token and
 *   it is materialised as a *viewer* trip: readable everywhere, editable
 *   nowhere, refreshed from the same token whenever it is open. The identity
 *   step is device-local. This replaces the wall that used to stand here —
 *   "Create an account so the others can see your room" — which most invitees
 *   walked away from.
 *
 * The one ordering constraint is the same for both: the local trip must exist
 * *before* the provider can mount, and the document must have arrived before
 * the identity step has anything to show. So arriving and choosing are separate
 * phases, not one screen.
 *
 * @module features/sharing/hooks/useJoinTrip
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { captureEvent, captureUsage } from '@/lib/posthog';
import { useAuth } from '@/features/auth/AuthContext';
import { getSupabaseClient } from '@/lib/supabase/client';
import { redeemInvite, type RedeemInviteResult } from '@/lib/sync/invites';
import { materialiseJoinedTrip } from '@/lib/sync/join-trip';
import { materialiseViewerTrip } from '@/lib/sync/viewer';
import type { TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export type JoinPhase =
  /** Waiting on the session lookup, the server, or the local write. */
  | { readonly kind: 'joining' }
  /** In as a member, with a local trip. The document may still be downloading. */
  | { readonly kind: 'joined'; readonly tripId: TripId }
  /** In as a viewer, read-only, with the document already on the device. */
  | { readonly kind: 'viewing'; readonly tripId: TripId }
  /** The invite cannot be used. `reason` distinguishes why, for the copy. */
  | {
      readonly kind: 'rejected';
      readonly reason: 'not-found' | 'revoked' | 'expired' | 'exhausted';
    }
  | { readonly kind: 'failed'; readonly message: string };

// ============================================================================
// Hook
// ============================================================================

/**
 * @param token - The invite token from the URL, or null if the route had none
 */
export function useJoinTrip(token: string | null): {
  readonly phase: JoinPhase;
  readonly retry: () => void;
} {
  const { session, isResolved } = useAuth();
  const hasSession = session !== null;
  const [phase, setPhase] = useState<JoinPhase>({ kind: 'joining' });
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
    if (token === null) {
      setPhase({ kind: 'rejected', reason: 'not-found' });
      return;
    }

    // Wait for the session lookup before choosing a door: acting on the
    // not-yet-resolved null would read the trip as a viewer for somebody who
    // is about to turn out to be signed in, and then join them a moment later.
    if (!isResolved) {
      return;
    }

    let cancelled = false;
    setPhase({ kind: 'joining' });

    const run = async (): Promise<void> => {
      const client = await getSupabaseClient();
      if (cancelled || !isMountedRef.current) {
        return;
      }
      if (!client) {
        setPhase({
          kind: 'failed',
          message: 'This build has no account backend configured.',
        });
        return;
      }

      if (!hasSession) {
        const viewed = await materialiseViewerTrip(client, token);
        if (cancelled || !isMountedRef.current) {
          return;
        }
        if (viewed.status === 'viewing') {
          // The first value moment for most people who ever reach this app:
          // counted as use, the way a member's join is.
          captureUsage('trip_viewed', { mode: 'viewer' });
          setPhase({ kind: 'viewing', tripId: viewed.tripId });
          return;
        }
        if (viewed.status === 'member') {
          // This device joined the trip with an account earlier and is signed
          // out now. The trip is here; open it rather than reading it again.
          setPhase({ kind: 'joined', tripId: viewed.tripId });
          return;
        }
        if (viewed.status === 'error') {
          setPhase({ kind: 'failed', message: viewed.message });
          return;
        }
        // The reason is the whole point: a revoked link and an exhausted one are
        // the same dead end to the person holding it and completely different
        // problems to fix.
        captureEvent('trip_join_failed', { reason: viewed.status, mode: 'viewer' });
        setPhase({ kind: 'rejected', reason: viewed.status });
        return;
      }

      const redeemed = await redeemInvite(client, token);
      if (cancelled || !isMountedRef.current) {
        return;
      }
      if (redeemed.status !== 'joined') {
        captureEvent('trip_join_failed', { reason: redeemed.status, mode: 'member' });
        setPhase(toFailurePhase(redeemed));
        return;
      }

      const local = await materialiseJoinedTrip(client, redeemed.remoteTripId);
      if (cancelled || !isMountedRef.current) {
        return;
      }
      if (local.status === 'error') {
        setPhase({ kind: 'failed', message: local.message });
        return;
      }

      // 'joined' and 'already-local' are the same outcome from here: the trip is
      // on the device and linked to the server row.
      captureUsage('trip_joined', { already_local: local.status === 'already-local' });
      setPhase({ kind: 'joined', tripId: local.tripId });
    };

    void run().catch((error: unknown) => {
      if (!cancelled && isMountedRef.current) {
        setPhase({
          kind: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return () => {
      cancelled = true;
    };
    // Keyed on whether there is a session, not on the session object. Supabase
    // replaces it on every token refresh — including one shortly after sign-in,
    // which is exactly when someone is on this page — and the object identity
    // would restart the effect, flashing 'joining' over a join that had already
    // finished. `redeem_invite` is idempotent for an existing member, so the
    // repeat was harmless server-side; the flicker was not.
  }, [attempt, hasSession, isResolved, token]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return { phase, retry };
}

// ============================================================================
// Internals
// ============================================================================

function toFailurePhase(result: RedeemInviteResult): JoinPhase {
  switch (result.status) {
    case 'not-found':
    case 'revoked':
    case 'expired':
    case 'exhausted':
      return { kind: 'rejected', reason: result.status };
    case 'unauthenticated':
      // The session lapsed between the page loading and the call. The next
      // render sees no session and reads the trip as a viewer instead.
      return { kind: 'failed', message: 'Your session expired. Reload to continue.' };
    case 'error':
      return { kind: 'failed', message: result.message };
    default:
      return { kind: 'failed', message: 'unexpected result' };
  }
}
