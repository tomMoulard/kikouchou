/**
 * @fileoverview Runs the account-wide sweep, once there is an account to run it
 * for.
 *
 * Mounted once, beside the providers rather than inside a page, because the
 * promise it keeps is not about any screen: sign in anywhere in the app and the
 * trips converge. Renders nothing.
 *
 * ## When it runs, and why that is three moments and not one
 *
 * - **A session appears.** The obvious one, and the reason the feature exists.
 * - **A trip is created afterwards.** Signing in and *then* making a trip is at
 *   least as common as the other order, and a sweep that only fired at sign-in
 *   would leave that trip on one device until the next launch. So the set of
 *   never-uploaded trips is watched live, and a new one pulls the sweep back.
 * - **The network comes back.** A sweep attempted on a train did nothing; the
 *   `online` transition is when it is worth trying again, and it is also what
 *   clears the record of what has already been attempted so a failed upload gets
 *   another go.
 *
 * Nothing else may restart it — not a token refresh, not a re-render, not
 * another trip being edited. That is why the session's *id* is read rather than
 * the object, why the watched value is a sorted list of ids rather than the
 * trips themselves, and why a trip already handed to a sweep does not queue a
 * second one when it lands.
 *
 * @module lib/sync/AccountTripSync
 */

import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useAuth } from '@/features/auth/AuthContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { db } from '@/lib/db/database';
import posthog from '@/lib/posthog';
import { getSupabaseClient } from '@/lib/supabase/client';
import { syncAccountTrips } from './account-sync';

// ============================================================================
// Component
// ============================================================================

/**
 * Keeps this device's trips and the signed-in account's trips in one set.
 *
 * @returns Nothing. This is a behaviour, not a surface.
 */
export function AccountTripSync(): null {
  const { session } = useAuth();
  const { isOnline } = useOnlineStatus();

  // The id, not the session object: the object is replaced on every token
  // refresh, and a sweep per refresh would be a sweep per hour for no reason.
  const userId = session?.user.id ?? null;

  /**
   * The trips this device has never put on the server, as a stable key.
   *
   * Sorted ids joined into a string rather than the rows themselves, so the
   * effect below restarts when the *set* changes and not when a name is edited
   * — every trip write goes through Dexie, and a live query over the rows would
   * fire on all of them.
   *
   * `undefined` while the first read is in flight. That is "not known yet", not
   * "nothing pending", and the effect waits for it rather than sweeping against
   * a list it has not seen.
   */
  const pendingUploadKey = useLiveQuery(async () => {
    const trips = await db.trips.toArray();
    return trips
      .filter((trip) => trip.remoteTripId === undefined)
      .map((trip) => String(trip.id))
      .sort()
      .join(',');
  }, []);

  /**
   * Sweeps run one after another, never side by side.
   *
   * Not an optimisation. The pull half looks a trip up locally and creates it
   * when it is absent, so two passes interleaved between the look-up and the
   * write would each find nothing and each add a row — one remote trip, two
   * local copies. `materialiseJoinedTrip` holds a Dexie transaction across that
   * pair, which is what makes it safe between *tabs*; this is what makes it
   * safe within one, and what stops the push half racing the pull half over the
   * same trip.
   *
   * A promise chain rather than a "busy" flag, because a flag drops the work it
   * refuses: a trip created while a sweep was running would be skipped and then
   * never re-queued.
   */
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  /** The account the last sweep was queued for, cleared when the network drops. */
  const sweptAccountRef = useRef<string | null>(null);

  /**
   * Trips already handed to a sweep.
   *
   * A sweep that has begun will upload these, and each one that lands changes
   * `pendingUploadKey` — so without this the effect would re-queue a pass per
   * trip uploaded, every one of them finding nothing left to do.
   */
  const queuedTripIdsRef = useRef<Set<string>>(new Set());

  /**
   * Losing the network or the session forgets what has been attempted.
   *
   * Both are a reason to start again rather than to trust the last pass. A sweep
   * that ran with no connection achieved nothing, and one that ran before a
   * sign-out says nothing about what the account holds now — another device may
   * have added a trip in between, and re-signing in is exactly when somebody
   * expects to find it.
   */
  useEffect(() => {
    if (!isOnline || userId === null) {
      sweptAccountRef.current = null;
      queuedTripIdsRef.current.clear();
    }
  }, [isOnline, userId]);

  useEffect(() => {
    if (userId === null || !isOnline || pendingUploadKey === undefined) {
      // Signed out, offline, or the local list has not been read yet. All three
      // are ordinary, and none of them is a state worth reporting.
      return;
    }

    const pendingIds = pendingUploadKey === '' ? [] : pendingUploadKey.split(',');
    const isFirstForAccount = sweptAccountRef.current !== userId;
    const hasUnqueuedTrip = pendingIds.some(
      (id) => !queuedTripIdsRef.current.has(id),
    );

    if (!isFirstForAccount && !hasUnqueuedTrip) {
      // Everything here has already been handed to a sweep, and the account has
      // been swept since it came online. Nothing new to do.
      return;
    }

    if (isFirstForAccount) {
      // A different account, or the first pass since reconnecting: whatever the
      // previous one attempted says nothing about this one.
      queuedTripIdsRef.current.clear();
    }
    sweptAccountRef.current = userId;
    for (const id of pendingIds) {
      queuedTripIdsRef.current.add(id);
    }

    const account = userId;
    chainRef.current = chainRef.current
      .then(async () => {
        const client = await getSupabaseClient();
        if (!client) {
          return;
        }

        const result = await syncAccountTrips(client, account);

        // Reported even when the component has gone: the sweep is what the
        // event describes, and it happened. Only a `setState` would need a
        // mounted guard, and there is none — the trip list follows Dexie on its
        // own.
        if (result.uploaded > 0 || result.downloaded > 0 || result.failed > 0) {
          posthog?.capture('account_trip_sync', {
            uploaded: result.uploaded,
            downloaded: result.downloaded,
            failed: result.failed,
          });
        }
      })
      // The chain is the app's only sweep queue, and a rejected promise stays
      // rejected — one failure here would silently refuse every sweep for the
      // rest of the session. `syncAccountTrips` reports rather than throws, so
      // this catches the one thing above it that can: loading the client.
      .catch((error: unknown) => {
        console.warn(
          '[sync] could not run the account sweep:',
          error instanceof Error ? error.message : String(error),
        );
      });

    // No cleanup. The sweep is a sequence of idempotent server calls and Dexie
    // writes, and abandoning it halfway would leave exactly the half-uploaded
    // account this exists to prevent — so it is left to finish, whether or not
    // this component is still mounted when it does.
  }, [isOnline, pendingUploadKey, userId]);

  return null;
}
