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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installLocalStorageDouble } from '@/test/local-storage';
import { getGuestIdentityStorageKey } from '@/lib/sharing/guest-identity';
import { ORGANISED_STORAGE_KEY, markTripOrganised } from '../usePlanOwnTripPrompt';
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

  // Filling the create form's "You" row writes the organiser an identity
  // through the same key the share wizard uses, so their own trip looked
  // exactly like a joined one and the trip list offered to teach them how to
  // plan a trip.
  describe('for somebody who organised the trip themselves', () => {
    it('stays hidden once this browser has created a trip', () => {
      const trip = makeTrip();
      joinAsGuest(trip);
      markTripOrganised();

      const { result } = renderHook(() => usePlanOwnTripPrompt([trip]));

      expect(result.current.isVisible).toBe(false);
    });

    it('still shows for a guest who has organised nothing', () => {
      const trip = makeTrip();
      joinAsGuest(trip);

      const { result } = renderHook(() => usePlanOwnTripPrompt([trip]));

      expect(result.current.isVisible).toBe(true);
    });
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

  describe('at the edges', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('lets the card back exactly when the cooldown ends', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date());
      const trip = makeTrip();
      joinAsGuest(trip);
      localStorage.setItem(
        'kikouchou-own-trip-prompt-dismissed',
        (Date.now() - 30 * 24 * 60 * 60 * 1000).toString(),
      );

      const { result } = renderHook(() => usePlanOwnTripPrompt([trip]));

      expect(result.current.isVisible).toBe(true);
    });

    it('shows the card when the dismissal cannot be read', () => {
      const trip = makeTrip();
      joinAsGuest(trip);
      // A fresh dismissal is stored: only the refused read can bring the card back.
      localStorage.setItem('kikouchou-own-trip-prompt-dismissed', Date.now().toString());
      const read = localStorage.getItem.bind(localStorage);
      vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
        if (key === 'kikouchou-own-trip-prompt-dismissed') {
          throw new DOMException('SecurityError');
        }
        return read(key);
      });

      const { result } = renderHook(() => usePlanOwnTripPrompt([trip]));

      expect(result.current.isVisible).toBe(true);
    });

    it('falls back to the guest test when the organiser flag cannot be read', () => {
      const trip = makeTrip();
      joinAsGuest(trip);
      // The flag is set: only the refused read can let the guest test decide.
      markTripOrganised();
      const read = localStorage.getItem.bind(localStorage);
      vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
        if (key === ORGANISED_STORAGE_KEY) {
          throw new DOMException('SecurityError');
        }
        return read(key);
      });

      const { result } = renderHook(() => usePlanOwnTripPrompt([trip]));

      expect(result.current.isVisible).toBe(true);
    });

    it('counts a trip that starts today as started', () => {
      const trip = makeTrip({ startDate: dayFromToday(0), endDate: dayFromToday(3) });
      joinAsGuest(trip);

      const { result } = renderHook(() => usePlanOwnTripPrompt([trip]));

      expect(result.current.isVisible).toBe(true);
    });

    it('needs one started trip, not all of them', () => {
      const started = makeTrip();
      const later = makeTrip({
        id: 'trip-2' as TripId,
        shareId: 'share-2' as ShareId,
        startDate: dayFromToday(10),
        endDate: dayFromToday(12),
      });
      joinAsGuest(started);
      joinAsGuest(later);

      const { result } = renderHook(() => usePlanOwnTripPrompt([started, later]));

      expect(result.current.isVisible).toBe(true);
    });

    it('follows the trip list as a joined trip arrives', () => {
      const own = makeTrip();
      const joined = makeTrip({ id: 'trip-2' as TripId, shareId: 'share-2' as ShareId });
      joinAsGuest(joined);

      const { result, rerender } = renderHook(
        ({ trips }: { trips: readonly Trip[] }) => usePlanOwnTripPrompt(trips),
        { initialProps: { trips: [own] as readonly Trip[] } },
      );
      expect(result.current.isVisible).toBe(false);

      rerender({ trips: [joined] });
      expect(result.current.isVisible).toBe(true);
    });

    it('follows the trip list as a joined trip starts', () => {
      const future = makeTrip({ startDate: dayFromToday(10), endDate: dayFromToday(12) });
      const started = makeTrip();
      joinAsGuest(future);

      const { result, rerender } = renderHook(
        ({ trips }: { trips: readonly Trip[] }) => usePlanOwnTripPrompt(trips),
        { initialProps: { trips: [future] as readonly Trip[] } },
      );
      expect(result.current.isVisible).toBe(false);

      rerender({ trips: [started] });
      expect(result.current.isVisible).toBe(true);
    });
  });
});
