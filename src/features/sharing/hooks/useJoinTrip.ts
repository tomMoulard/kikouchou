/**
 * @fileoverview Drives the join flow: redeem, materialise, then wait to hydrate.
 *
 * Kept out of the page component because the sequence has real states worth
 * testing on their own — a signed-out visitor, each way an invite can be
 * unusable, and the wait while the document downloads before participants can be
 * offered.
 *
 * The one ordering constraint: the local trip must exist *before* the provider
 * can mount, and the provider must have hydrated *before* the identity step has
 * anything to show. So joining and choosing are separate phases, not one screen.
 *
 * @module features/sharing/hooks/useJoinTrip
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import posthog, { captureUsage } from '@/lib/posthog';
import { useAuth } from '@/features/auth/AuthContext';
import { getSupabaseClient } from '@/lib/supabase/client';
import { redeemInvite, type RedeemInviteResult } from '@/lib/sync/invites';
import { materialiseJoinedTrip } from '@/lib/sync/join-trip';
import type { TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export type JoinPhase =
  /** Waiting for the visitor to sign in. */
  | { readonly kind: 'needs-account' }
  /** Redeeming and creating the local trip. */
  | { readonly kind: 'joining' }
  /** In, with a local trip. The document may still be downloading. */
  | { readonly kind: 'joined'; readonly tripId: TripId }
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

    // Wait for the session lookup before concluding anything: acting on the
    // not-yet-resolved null would flash "sign in" at someone already signed in.
    if (!isResolved) {
      return;
    }

    if (!hasSession) {
      // Joining is one of the two operations allowed to require an account, so
      // this is an expected step rather than a failure — but it is also the most
      // likely place for an invitee to give up, which is worth being able to see.
      posthog?.capture('trip_join_blocked', { reason: 'needs-account' });
      setPhase({ kind: 'needs-account' });
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

      const redeemed = await redeemInvite(client, token);
      if (cancelled || !isMountedRef.current) {
        return;
      }
      if (redeemed.status !== 'joined') {
        // The reason is the whole point: a revoked link and an exhausted one are
        // the same dead end to the person holding it and completely different
        // problems to fix.
        posthog?.capture('trip_join_failed', { reason: redeemed.status });
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
      return { kind: 'needs-account' };
    case 'error':
      return { kind: 'failed', message: result.message };
    default:
      return { kind: 'failed', message: 'unexpected result' };
  }
}
