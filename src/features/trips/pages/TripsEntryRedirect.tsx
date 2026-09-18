/**
 * @fileoverview Where the app's root sends somebody who has just opened it.
 *
 * `/` used to redirect to `/trips` unconditionally, so a first launch landed on
 * an empty list: a title, an illustration, and a button to press before the app
 * could do anything at all. The one thing that visitor can do is make a trip,
 * and the form is one route away — so on a first launch with nothing to open,
 * the form *is* the landing page. The list comes after, once there is something
 * on it, or the moment they back out of the form.
 *
 * "Nothing to open" is deliberately wider than the local database. A device can
 * hold no trips and still have somewhere to go: an account whose trips have not
 * been downloaded onto it yet — see `useRemoteTrips` — is a list with rows on
 * it, and sending that person to a create form would hide the trip they came
 * back for. So the redirect waits for the local trips, for the session, and for
 * the remote lookup, and any one of them finding something sends it to the
 * list.
 *
 * Waiting has a deadline. Every input here can stall — a slow network, a
 * Supabase call that never answers — and a root route that spins forever is
 * worse than one that guesses. After {@link DECISION_TIMEOUT_MS} the redirect
 * gives up and falls through to `/trips`, which is the answer that hides
 * nothing: the list renders the empty state, the invite button and the remote
 * trips alike.
 *
 * It happens once per browser. A first launch that ends in *Cancel* means the
 * form was not what that person wanted — most likely they are here to join
 * somebody else's trip, and the invite button lives on the list — so the next
 * launch leaves them on the list. The flag is written when the redirect fires,
 * not when a trip is created, because creating one makes the question moot.
 *
 * @module features/trips/pages/TripsEntryRedirect
 */

import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { LoadingState } from '@/components/shared/LoadingState';
import { useTripContext } from '@/contexts/TripContext';
import { useAuth } from '@/features/auth/AuthContext';
import { useRemoteTrips } from '../hooks/useRemoteTrips';

// ============================================================================
// Constants
// ============================================================================

/** Where a visitor with a trip to open goes. */
const TRIP_LIST_PATH = '/trips';

/** Where a visitor with nothing to open goes. */
const TRIP_CREATE_PATH = '/trips/new';

/**
 * How long the decision may wait on the trips, the session and the server.
 *
 * Long enough for a local database to open and a fast lookup to answer, short
 * enough that a dead network is a pause rather than a hang.
 */
export const DECISION_TIMEOUT_MS = 1500;

/** LocalStorage key set the first time this browser is sent to the form. */
export const FIRST_RUN_STORAGE_KEY = 'kikouchou-first-run-trip-form-shown';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Reads whether this browser has already been sent to the create form.
 *
 * @returns True when the first-run redirect has fired before
 */
function hasBeenSentToTheForm(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(FIRST_RUN_STORAGE_KEY) !== null;
  } catch {
    // Private browsing, or storage refused. Treat it as a first launch: the
    // cost of repeating the redirect is one *Cancel*, and the cost of
    // suppressing it is that the feature never happens on that browser.
    return false;
  }
}

/**
 * Records that this browser has been sent to the create form.
 */
function markSentToTheForm(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(FIRST_RUN_STORAGE_KEY, Date.now().toString());
  } catch {
    // See above: a lost flag costs one extra redirect, which is not worth
    // surfacing to anybody.
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * The app root's redirect: the create form on a first launch with no trips,
 * the trip list otherwise.
 *
 * @returns A spinner while the decision is open; the page it redirects to is
 *   rendered by the route it navigates to
 *
 * @example
 * ```tsx
 * // In the router's index route
 * { index: true, element: <TripsEntryRedirect /> }
 * ```
 */
export function TripsEntryRedirect(): ReactElement {
  const navigate = useNavigate();
  const { trips, isLoading, error } = useTripContext();
  const { isResolved } = useAuth();
  const { remoteOnly, isChecking } = useRemoteTrips(trips.length);

  /**
   * Whether the wait has run out. Started on mount and never restarted: the
   * deadline is on the whole decision, not on each input of it.
   */
  const [hasTimedOut, setHasTimedOut] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHasTimedOut(true);
    }, DECISION_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  /**
   * The route to go to, or `null` while the answer is still arriving.
   *
   * A trip on the device settles it immediately: there is a list to show, and
   * nothing the server or the session says can change that. Everything else is
   * a reason to send the visitor to the list, so an unfinished lookup is worth
   * waiting for — up to the deadline.
   */
  const destination = useMemo((): string | null => {
    if (trips.length > 0) {
      return TRIP_LIST_PATH;
    }

    // Still arriving: wait, or take the deadline's answer. A wait that ran out
    // goes to the list, never to the form — what has not answered may be an
    // account full of trips, and the form would hide every one of them.
    if (isLoading || !isResolved || isChecking) {
      return hasTimedOut ? TRIP_LIST_PATH : null;
    }

    // `error` is the local trips failing to load at all, which is a list
    // problem to show on the list rather than a reason to say there are none.
    const hasNothingToOpen = error === null && remoteOnly.length === 0;

    return hasNothingToOpen && !hasBeenSentToTheForm()
      ? TRIP_CREATE_PATH
      : TRIP_LIST_PATH;
  }, [error, hasTimedOut, isChecking, isLoading, isResolved, remoteOnly.length, trips.length]);

  /**
   * Navigates once the decision is made.
   *
   * In an effect with `navigate` rather than a rendered `<Navigate>`, so the
   * flag is written before the route changes rather than racing the unmount
   * that the redirect causes.
   */
  useEffect(() => {
    if (destination === null) {
      return;
    }

    if (destination === TRIP_CREATE_PATH) {
      markSentToTheForm();
    }

    void navigate(destination, { replace: true });
  }, [destination, navigate]);

  return <LoadingState variant="fullPage" />;
}
