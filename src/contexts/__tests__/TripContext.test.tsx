/**
 * TripContext Tests
 *
 * Tests for the TripContext provider including:
 * - Initial state and loading
 * - Trip list management
 * - Current trip selection
 * - Persistence behavior
 * - Error handling
 *
 * @module contexts/__tests__/TripContext.test
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { TripProvider, useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import {
  createTrip,
  getTripById,
  deleteTrip,
  updateTrip,
} from '@/lib/db/repositories/trip-repository';
import {
  getSettings,
  setCurrentTrip as repositorySetCurrentTrip,
} from '@/lib/db/repositories/settings-repository';
import type { Trip, TripId } from '@/types';
import { isoDate } from '@/test/utils';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Wrapper component that provides TripContext.
 */
function TripContextWrapper({ children }: { children: ReactNode }) {
  return <TripProvider>{children}</TripProvider>;
}

/**
 * Helper to create a test trip and return its ID.
 */
async function createTestTrip(name = 'Test Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-30'),
  });
  return trip.id;
}

/**
 * Small delay to allow live queries to update, wrapped in act()
 * to avoid "not wrapped in act(...)" warnings.
 */
async function waitForLiveQuery(ms = 50): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/**
 * Runs a rejecting context action and hands back what it threw.
 *
 * The catch has to be *inside* `act`: `await expect(act(...)).rejects` lets the
 * rejection escape act before it flushes, so the `setError` the action made on
 * its way out never reaches `result.current` and the error state reads null.
 * That is what made the old `resolves.not.toThrow()` shape so tempting, and it
 * is exactly the state these tests need to see.
 */
async function callAndCatch(action: () => Promise<unknown>): Promise<unknown> {
  let caught: unknown = null;
  await act(async () => {
    try {
      await action();
    } catch (err) {
      caught = err;
    }
  });
  return caught;
}

// ============================================================================
// Initial State Tests
// ============================================================================

describe('TripContext', () => {
  // Several cases below spy on `db.trips.count` and make it reject. A
  // `mockRestore()` after the assertions only runs when they pass, and the
  // global setup calls `vi.clearAllMocks()`, which clears call records but
  // keeps implementations — so one failure would leave the database rejecting
  // for the rest of the file and blame an innocent test for it.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial State', () => {
    it('provides trips list from database', async () => {
      // Create test data
      await createTestTrip('Trip 1');
      await createTestTrip('Trip 2');

      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      // Wait for loading to complete
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.trips).toHaveLength(2);
    });

    it('starts with currentTrip as null when no trip selected', async () => {
      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.currentTrip).toBeNull();
    });

    it('starts with isLoading true', () => {
      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      // Initially loading should be true
      expect(result.current.isLoading).toBe(true);
    });

    it('starts with error as null', async () => {
      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeNull();
    });
  });

  // ============================================================================
  // Trip List Tests
  // ============================================================================

  describe('Trip List', () => {
    it('returns trips sorted by startDate descending', async () => {
      // Create trips with different dates
      await createTrip({
        name: 'Early Trip',
        startDate: isoDate('2024-01-15'),
        endDate: isoDate('2024-01-20'),
      });
      await createTrip({
        name: 'Late Trip',
        startDate: isoDate('2024-12-15'),
        endDate: isoDate('2024-12-20'),
      });

      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Latest trip should be first
      expect(result.current.trips[0]?.name).toBe('Late Trip');
      expect(result.current.trips[1]?.name).toBe('Early Trip');
    });

    it('returns empty array when no trips exist', async () => {
      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.trips).toEqual([]);
    });
  });

  // ============================================================================
  // setCurrentTrip Tests
  // ============================================================================

  describe('setCurrentTrip', () => {
    it('sets current trip when valid ID provided', async () => {
      const tripId = await createTestTrip();

      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.setCurrentTrip(tripId);
      });

      // Wait for live query to update
      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.currentTrip).not.toBeNull();
        expect(result.current.currentTrip?.id).toBe(tripId);
      });
    });

    it('clears current trip when null provided', async () => {
      const tripId = await createTestTrip();
      await repositorySetCurrentTrip(tripId);

      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.currentTrip?.id).toBe(tripId);
      });

      await act(async () => {
        await result.current.setCurrentTrip(null);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.currentTrip).toBeNull();
      });
    });

    it('treats empty string as null', async () => {
      const tripId = await createTestTrip();
      await repositorySetCurrentTrip(tripId);

      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.currentTrip?.id).toBe(tripId);
      });

      await act(async () => {
        await result.current.setCurrentTrip('');
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.currentTrip).toBeNull();
      });
    });

    it('throws error when trip ID not found', async () => {
      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.setCurrentTrip('nonexistent_trip_id');
        })
      ).rejects.toThrow('Trip with ID "nonexistent_trip_id" not found');
    });

    it('sets error state when setCurrentTrip fails', async () => {
      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Call setCurrentTrip with invalid ID - it should throw
      const caughtError = await callAndCatch(() =>
        result.current.setCurrentTrip('nonexistent_trip_id'),
      );

      // Verify error was thrown...
      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).toContain('nonexistent_trip_id');

      // ...and, as the name of this test promises, that it also landed in the
      // context so a consumer can render it. The two are separate paths: the
      // provider could throw and never call setError.
      expect(result.current.error).toBe(caughtError);
    });

    it('persists selection to settings', async () => {
      const tripId = await createTestTrip();

      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.setCurrentTrip(tripId);
      });

      // Wait for live query to process the state update
      await waitFor(() => {
        expect(result.current.currentTrip?.id).toBe(tripId);
      });

      // The selection has to survive a reload, so it must be in settings — not
      // merely in the trips table, which it was before setCurrentTrip ran.
      const settings = await getSettings();
      expect(settings.currentTripId).toBe(tripId);

      // And the trip it points at still exists.
      const trip = await getTripById(tripId);
      expect(trip?.id).toBe(tripId);
    });

    it('clears the persisted selection when set to null', async () => {
      const tripId = await createTestTrip();
      await repositorySetCurrentTrip(tripId);

      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.currentTrip?.id).toBe(tripId);
      });

      await act(async () => {
        await result.current.setCurrentTrip(null);
      });

      // Settle the live query's follow-up render first: reading settings is
      // itself a Dexie call, and the re-render it wakes would otherwise land
      // outside act.
      await waitFor(() => {
        expect(result.current.currentTrip).toBeNull();
      });

      const settings = await getSettings();
      expect(settings.currentTripId).toBeUndefined();
    });

    it('leaves the persisted selection untouched when the trip ID is unknown', async () => {
      const tripId = await createTestTrip();
      await repositorySetCurrentTrip(tripId);

      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.currentTrip?.id).toBe(tripId);
      });

      const caught = await callAndCatch(() =>
        result.current.setCurrentTrip('nonexistent_trip_id'),
      );
      expect(caught).toBeInstanceOf(Error);

      // The validation and the write share a transaction, so a rejected
      // validation must roll the write back rather than leave settings pointing
      // at a trip that does not exist.
      const settings = await getSettings();
      expect(settings.currentTripId).toBe(tripId);
      expect(result.current.currentTrip?.id).toBe(tripId);
    });
  });

  // ============================================================================
  // Stale Reference Cleanup Tests
  // ============================================================================

  describe('Stale Reference Cleanup', () => {
    it('clears current trip when referenced trip is deleted', async () => {
      const tripId = await createTestTrip();
      await repositorySetCurrentTrip(tripId);

      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.currentTrip?.id).toBe(tripId);
      });

      // Delete the trip
      await deleteTrip(tripId);

      // Wait for live query to detect the deletion
      await waitForLiveQuery(100);

      await waitFor(() => {
        expect(result.current.currentTrip).toBeNull();
      }, { timeout: 2000 });
    });
  });

  // ============================================================================
  // checkConnection Tests
  // ============================================================================

  /**
   * `checkConnection` is an error-recovery affordance: the UI calls it after a
   * database failure to find out whether IndexedDB came back. So the assertions
   * here are about what it *does* — reopen a closed database, read from it, drop
   * the stale error, and re-throw when the read still fails — rather than about
   * it merely resolving, which an empty function body also does.
   */
  describe('checkConnection', () => {
    it('reads from the database rather than resolving unconditionally', async () => {
      const countSpy = vi.spyOn(db.trips, 'count');

      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      countSpy.mockClear();

      await act(async () => {
        await result.current.checkConnection();
      });

      expect(countSpy).toHaveBeenCalledTimes(1);
      expect(result.current.error).toBeNull();
    });

    it('reopens a closed database', async () => {
      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Closing under act: TripProvider's live query catches the failure and
      // calls setError, and an unwrapped one landing after the check below
      // would repopulate `error` and fail this intermittently.
      await act(async () => {
        db.close();
      });
      expect(db.isOpen()).toBe(false);

      await act(async () => {
        await result.current.checkConnection();
      });

      expect(db.isOpen()).toBe(true);
      await waitFor(() => {
        expect(result.current.error).toBeNull();
      });
    });

    it('clears a stale error left by an earlier failure', async () => {
      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Put the context into the error state the recovery affordance exists for.
      const setupError = await callAndCatch(() =>
        result.current.setCurrentTrip('nonexistent_trip_id'),
      );
      expect(setupError).toBeInstanceOf(Error);
      expect(result.current.error).not.toBeNull();

      await act(async () => {
        await result.current.checkConnection();
      });

      expect(result.current.error).toBeNull();
    });

    it('re-throws and records the error when the database is unreachable', async () => {
      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const failure = new Error('IndexedDB is gone');
      vi.spyOn(db.trips, 'count').mockRejectedValue(failure);

      // Callers await this inside a try/catch, so the rejection has to reach them.
      const caught = await callAndCatch(() => result.current.checkConnection());

      expect(caught).toBe(failure);
      expect(result.current.error).toBe(failure);
    });

    it('wraps a non-Error rejection in an Error', async () => {
      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      vi.spyOn(db.trips, 'count').mockRejectedValue('not an error object');

      const caught = await callAndCatch(() => result.current.checkConnection());

      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe('Failed to connect to database');
      expect(result.current.error).toBe(caught);
    });
  });

  // ============================================================================
  // Hook Error Tests
  // ============================================================================

  describe('useTripContext Hook', () => {
    it('throws error when used outside provider', () => {
      // Suppress React error boundary logs for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useTripContext());
      }).toThrow('useTripContext must be used within a TripProvider');

      consoleSpy.mockRestore();
    });
  });

  // ============================================================================
  // Referential Equality Tests (CR-18)
  // ============================================================================

  describe('Referential Equality Optimization', () => {
    it('preserves currentTrip reference when other trips change', async () => {
      // Create two trips
      const tripId1 = await createTestTrip('Trip 1');
      await createTestTrip('Trip 2');
      await repositorySetCurrentTrip(tripId1);

      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.currentTrip?.id).toBe(tripId1);
      });

      // Capture the initial currentTrip reference
      const initialCurrentTrip = result.current.currentTrip;

      // Create a third trip (should update trips array but not currentTrip)
      await act(async () => {
        await createTestTrip('Trip 3');
      });
      await waitForLiveQuery(100);

      // Wait for trips array to update
      await waitFor(() => {
        expect(result.current.trips).toHaveLength(3);
      });

      // currentTrip reference should be preserved (same object)
      expect(result.current.currentTrip).toBe(initialCurrentTrip);
    });

    it('updates currentTrip reference when current trip data changes', async () => {
      const tripId = await createTestTrip('Original Name');
      await repositorySetCurrentTrip(tripId);

      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.currentTrip?.name).toBe('Original Name');
      });

      // Capture the initial currentTrip reference
      const initialCurrentTrip = result.current.currentTrip;

      // Update the current trip's data
      const { updateTrip } = await import('@/lib/db/repositories/trip-repository');
      await updateTrip(tripId, { name: 'Updated Name' });
      await waitForLiveQuery(100);

      // Wait for the update to propagate
      await waitFor(() => {
        expect(result.current.currentTrip?.name).toBe('Updated Name');
      });

      // currentTrip reference should be different now (data changed)
      expect(result.current.currentTrip).not.toBe(initialCurrentTrip);
    });

    /**
     * The comparator decides whether a live-query result reaches consumers at
     * all, so a field it forgets is a field the UI never sees change. Exercising
     * one field cannot catch that — each needs its own case.
     *
     * Every case here writes with `db.trips.update` rather than the repository's
     * `updateTrip`, and deliberately so: `updateTrip` stamps a fresh `updatedAt`
     * on the way past, and `updatedAt` is itself compared, so a change routed
     * through it propagates whichever other fields the comparator forgot. The
     * test would pass for a comparator that listed nothing but the timestamp.
     *
     * A bare `db.trips.update` is not a synthetic shape either: it is how
     * `lib/sync/remote-trip.ts` writes `remoteTripId` when a trip is linked to or
     * unlinked from the server, and how the Yjs bridge projects a peer's row
     * back into Dexie — writes carrying somebody else's timestamp, or none.
     */
    describe('comparator covers every mutable field', () => {
      const mutations: readonly {
        readonly field: string;
        /** Applied before the hook mounts, when the case needs a starting value. */
        readonly seed?: Partial<Trip>;
        readonly patch: Partial<Trip>;
        readonly read: (trip: Trip | null) => unknown;
        readonly expected: unknown;
      }[] = [
        {
          field: 'name',
          patch: { name: 'Renamed by a peer' },
          read: (trip) => trip?.name,
          expected: 'Renamed by a peer',
        },
        {
          field: 'location',
          patch: { location: 'Brittany' },
          read: (trip) => trip?.location,
          expected: 'Brittany',
        },
        {
          field: 'startDate',
          patch: { startDate: isoDate('2024-07-01') },
          read: (trip) => trip?.startDate,
          expected: '2024-07-01',
        },
        {
          field: 'endDate',
          patch: { endDate: isoDate('2024-08-05') },
          read: (trip) => trip?.endDate,
          expected: '2024-08-05',
        },
        {
          field: 'description',
          patch: { description: 'Check-in after 3pm' },
          read: (trip) => trip?.description,
          expected: 'Check-in after 3pm',
        },
        {
          field: 'updatedAt',
          patch: { updatedAt: 1_800_000_000_000 },
          read: (trip) => trip?.updatedAt,
          expected: 1_800_000_000_000,
        },
        {
          field: 'coordinates, from absent to present',
          patch: { coordinates: { lat: 48.8566, lon: 2.3522 } },
          read: (trip) => trip?.coordinates,
          expected: { lat: 48.8566, lon: 2.3522 },
        },
        // The two axes get a case each. Moving both at once passes for a
        // comparator that reads only one of them, which is precisely the kind of
        // half-written deep compare worth catching.
        {
          field: 'coordinates.lat alone',
          seed: { coordinates: { lat: 48.8566, lon: 2.3522 } },
          patch: { coordinates: { lat: 43.2965, lon: 2.3522 } },
          read: (trip) => trip?.coordinates?.lat,
          expected: 43.2965,
        },
        {
          field: 'coordinates.lon alone',
          seed: { coordinates: { lat: 48.8566, lon: 2.3522 } },
          patch: { coordinates: { lat: 48.8566, lon: 5.3698 } },
          read: (trip) => trip?.coordinates?.lon,
          expected: 5.3698,
        },
        {
          field: 'remoteTripId',
          patch: { remoteTripId: 'remote_abc' },
          read: (trip) => trip?.remoteTripId,
          expected: 'remote_abc',
        },
      ];

      for (const { field, seed, patch, read, expected } of mutations) {
        it(`propagates a change to ${field}`, async () => {
          const tripId = await createTestTrip('Comparator Trip');
          await repositorySetCurrentTrip(tripId);
          if (seed) {
            await db.trips.update(tripId, seed);
          }

          const { result } = renderHook(() => useTripContext(), {
            wrapper: TripContextWrapper,
          });

          await waitFor(() => {
            expect(result.current.currentTrip?.id).toBe(tripId);
          });

          // `waitFor` below already polls, so no sleep is needed — only the
          // act wrapper, so the live query's state update is not left loose.
          await act(async () => {
            await db.trips.update(tripId, patch);
          });

          await waitFor(() => {
            expect(read(result.current.currentTrip)).toEqual(expected);
          });
        });
      }

      it('still propagates a change made through the repository', async () => {
        const tripId = await createTestTrip('Repository Trip');
        await repositorySetCurrentTrip(tripId);

        const { result } = renderHook(() => useTripContext(), {
          wrapper: TripContextWrapper,
        });

        await waitFor(() => {
          expect(result.current.currentTrip?.id).toBe(tripId);
        });

        await updateTrip(tripId, { location: 'Saint-Malo' });
        await waitForLiveQuery(100);

        await waitFor(() => {
          expect(result.current.currentTrip?.location).toBe('Saint-Malo');
        });
      });
    });
  });
});
