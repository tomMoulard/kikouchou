/**
 * @fileoverview Tests for the "plan your own trip" decision.
 *
 * Each case is one of the three conditions that keep the card off a screen
 * where it would be noise: a trip this browser owns, a trip that has not
 * started, and a dismissal that must outlive the visit.
 *
 * Every date derives from today. A literal month goes stale, and a trip fixture
 * that was "in the future" when the test was written stops testing anything
 * once that month passes.
 *
 * @module features/trips/hooks/__tests__/usePlanOwnTripPrompt.test
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installLocalStorageDouble } from '@/test/local-storage';
import { getGuestIdentityStorageKey } from '@/lib/sharing/guest-identity';
import { toLocalISODateString } from '@/lib/db/utils';
import { usePlanOwnTripPrompt } from '../usePlanOwnTripPrompt';
import type { PersonId, ShareId, Trip, TripId, UnixTimestamp } from '@/types';

// jsdom exposes no `localStorage` in this suite, and the guest identity the
// decision reads lives there.
const storage = installLocalStorageDouble();

// ============================================================================
// Fixtures
// ============================================================================

/** Days from today, as the local calendar day the app stores. */
function dayFromToday(offset: number): Trip['startDate'] {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  return toLocalISODateString(day);
}

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  const now = Date.now() as UnixTimestamp;
  return {
    id: 'trip-1' as TripId,
    name: 'Brittany',
    startDate: dayFromToday(-2),
    endDate: dayFromToday(5),
    shareId: 'share-1' as ShareId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Marks a trip as one this browser joined through a share link. */
function joinAsGuest(trip: Trip): void {
  localStorage.setItem(
    getGuestIdentityStorageKey(trip.shareId),
    JSON.stringify({ personId: 'person-1' as PersonId, tripId: trip.id }),
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('usePlanOwnTripPrompt', () => {
  beforeEach(() => {
    storage.clear();
  });

  afterEach(() => {
    storage.clear();
  });

  it('invites a guest whose joined trip has started', () => {
    const trip = makeTrip();
    joinAsGuest(trip);

    const { result } = renderHook(() => usePlanOwnTripPrompt([trip]));

    expect(result.current.isVisible).toBe(true);
  });

  it('stays away when a trip belongs to this browser', () => {
    // No guest identity: this is a trip the visitor created, so they already
    // know the organiser's side of the app exists.
    const trip = makeTrip();

    const { result } = renderHook(() => usePlanOwnTripPrompt([trip]));

    expect(result.current.isVisible).toBe(false);
  });

  it('stays away when one trip of several belongs to this browser', () => {
    const joined = makeTrip();
    const own = makeTrip({
      id: 'trip-2' as TripId,
      shareId: 'share-2' as ShareId,
    });
    joinAsGuest(joined);

    const { result } = renderHook(() => usePlanOwnTripPrompt([joined, own]));

    expect(result.current.isVisible).toBe(false);
  });

  it('waits until a joined trip has started', () => {
    const trip = makeTrip({
      startDate: dayFromToday(10),
      endDate: dayFromToday(17),
    });
    joinAsGuest(trip);

    const { result } = renderHook(() => usePlanOwnTripPrompt([trip]));

    // Somebody who joined this morning has no basis for the decision yet.
    expect(result.current.isVisible).toBe(false);
  });

  it('stays away with no trips at all', () => {
    const { result } = renderHook(() => usePlanOwnTripPrompt([]));

    expect(result.current.isVisible).toBe(false);
  });

  it('remembers a dismissal past the end of the visit', () => {
    const trip = makeTrip();
    joinAsGuest(trip);

    const first = renderHook(() => usePlanOwnTripPrompt([trip]));
    act(() => {
      first.result.current.dismiss();
    });
    expect(first.result.current.isVisible).toBe(false);

    // A fresh mount is the next visit: the answer has to survive it.
    const second = renderHook(() => usePlanOwnTripPrompt([trip]));
    expect(second.result.current.isVisible).toBe(false);
  });

  it('ignores a dismissal older than the cooldown', () => {
    const trip = makeTrip();
    joinAsGuest(trip);
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      'kikouchou-own-trip-prompt-dismissed',
      fortyDaysAgo.toString(),
    );

    const { result } = renderHook(() => usePlanOwnTripPrompt([trip]));

    expect(result.current.isVisible).toBe(true);
  });

  it('shows the card when the stored dismissal is unreadable', () => {
    const trip = makeTrip();
    joinAsGuest(trip);
    localStorage.setItem('kikouchou-own-trip-prompt-dismissed', 'not a number');

    const { result } = renderHook(() => usePlanOwnTripPrompt([trip]));

    // A malformed value is not a dismissal. Treating it as one would hide the
    // card forever on the browser that wrote it.
    expect(result.current.isVisible).toBe(true);
  });
});
