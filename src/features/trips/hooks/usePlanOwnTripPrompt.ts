/**
 * @fileoverview Decides whether to invite a guest to plan a trip of their own.
 *
 * Someone whose only trips arrived through a share link has used the app
 * without ever creating anything — they were added to a house somebody else
 * organised. That is the one visitor worth telling that the organiser's side
 * exists, and this hook is the whole decision about when to tell them.
 *
 * Three conditions, and each one is there to keep the card off a screen where
 * it would be noise:
 *
 * 1. **This browser has organised nothing, and is a guest on every trip it
 *    holds.** Creating a trip sets a flag, and the guest identity the share
 *    wizard writes marks a joined one — see `lib/sharing/guest-identity`.
 *    Both are needed. There is no local field saying who owns a trip
 *    (`remoteTripId` is set on an owner's uploaded trip and on a joined one
 *    alike), and the identity alone stopped being enough once the create form
 *    grew a "You" row: filling it writes the creator an identity through that
 *    same key, so an organiser's own trip looked exactly like a joined one.
 * 2. **At least one of those trips has started.** Pitching "plan your own" to
 *    somebody who joined ten minutes ago and has not yet seen a trip run is
 *    asking for a decision they have no basis for. Once a trip is under way
 *    they know what the app does.
 * 3. **It has not been dismissed recently.** Same 30-day cooldown shape as
 *    `InstallPrompt`, for the same reason: an offer nobody asked for gets one
 *    answer and then goes away.
 *
 * The guest identity is read during render rather than watched. Nothing else in
 * the app writes those keys while the trip list is on screen — the wizard owns
 * them, and it lives on its own routes — and the `trips` array changes on every
 * join, which is the transition that matters.
 *
 * @module features/trips/hooks/usePlanOwnTripPrompt
 */

import { useCallback, useMemo, useState } from 'react';

import { useToday } from '@/hooks';
import { toLocalISODateString } from '@/lib/db/utils';
import { getTripGuestPersonId } from '@/lib/sharing/guest-identity';
import type { Trip } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/** LocalStorage key holding the dismissal timestamp. */
const DISMISSAL_STORAGE_KEY = 'kikouchou-own-trip-prompt-dismissed';

/**
 * LocalStorage key set the first time this browser creates a trip.
 *
 * Written by `createTripWithDetails`. Somebody who has organised a trip is not
 * the visitor this card is for, whatever their trips look like afterwards.
 */
export const ORGANISED_STORAGE_KEY = 'kikouchou-has-organised-a-trip';

/**
 * Records that this browser has organised a trip.
 *
 * Called by `createTripWithDetails`. Failure is ignored on purpose: the flag
 * only suppresses a suggestion, and losing it costs the reader one dismissal.
 */
export function markTripOrganised(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(ORGANISED_STORAGE_KEY, Date.now().toString());
  } catch {
    // Storage refused. See above: nothing here is worth surfacing.
  }
}

/** How long a dismissal hides the card (30 days). */
const DISMISSAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * What the trip list needs to render, or not render, the card.
 */
export interface UsePlanOwnTripPromptResult {
  /** Whether the invitation should be on screen. */
  readonly isVisible: boolean;
  /** Records the dismissal and hides the card for 30 days. */
  readonly dismiss: () => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Reads whether the card was dismissed inside the cooldown window.
 *
 * @returns True when the card must stay hidden
 */
function isDismissedRecently(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const dismissedAt = window.localStorage.getItem(DISMISSAL_STORAGE_KEY);
    if (!dismissedAt) {
      return false;
    }

    const timestamp = parseInt(dismissedAt, 10);
    if (Number.isNaN(timestamp)) {
      return false;
    }

    return Date.now() - timestamp < DISMISSAL_DURATION_MS;
  } catch {
    // Private browsing, disabled storage: show the card rather than suppress it.
    return false;
  }
}

/**
 * Reads whether this browser has ever created a trip.
 *
 * @returns True when the visitor has organised at least one trip
 */
function hasOrganisedATrip(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(ORGANISED_STORAGE_KEY) !== null;
  } catch {
    // Storage refused. Fall back to the guest-identity test below, which is
    // what decided this on its own before the flag existed.
    return false;
  }
}

/**
 * Persists the dismissal timestamp.
 */
function storeDismissal(): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(DISMISSAL_STORAGE_KEY, Date.now().toString());
  } catch {
    // Storage refused: the dismissal lasts for this session only.
  }
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Decides whether to invite this visitor to create a trip of their own.
 *
 * @param trips - The trips on this device, as the trip list has them
 * @returns Visibility and the dismiss handler
 *
 * @example
 * ```tsx
 * const { isVisible, dismiss } = usePlanOwnTripPrompt(trips);
 * if (!isVisible) { return null; }
 * ```
 */
export function usePlanOwnTripPrompt(
  trips: readonly Trip[],
): UsePlanOwnTripPromptResult {
  const { today } = useToday();
  const [isDismissed, setIsDismissed] = useState<boolean>(() =>
    isDismissedRecently(),
  );

  /**
   * True when this browser has organised nothing and is a guest on every trip
   * it holds.
   *
   * The guest-identity test alone stopped being enough once the create form
   * grew a "You" row: filling it writes the creator an identity through the
   * same key the share wizard uses, so an organiser's own trip started looking
   * exactly like a joined one and the card appeared on the trip they had just
   * made. The flag settles it, because only creating a trip sets it.
   */
  const isGuestOnly = useMemo(
    () =>
      !hasOrganisedATrip() &&
      trips.length > 0 &&
      trips.every((trip) => getTripGuestPersonId(trip) !== undefined),
    [trips],
  );

  /**
   * True once a joined trip has started.
   *
   * `toLocalISODateString`, not `toISODateString`: `Trip.startDate` is a day the
   * viewer sees on their own calendar, and reading `today` in UTC would compare
   * it against yesterday for everybody ahead of UTC.
   */
  const hasSeenATripRun = useMemo(() => {
    const todayKey = toLocalISODateString(today);
    return trips.some((trip) => trip.startDate <= todayKey);
  }, [today, trips]);

  const dismiss = useCallback((): void => {
    storeDismissal();
    setIsDismissed(true);
  }, []);

  return {
    isVisible: !isDismissed && isGuestOnly && hasSeenATripRun,
    dismiss,
  };
}
