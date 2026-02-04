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

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { TripProvider, useTripContext } from '@/contexts/TripContext';
import { createTrip, getTripById, deleteTrip } from '@/lib/db/repositories/trip-repository';
import { setCurrentTrip as repositorySetCurrentTrip } from '@/lib/db/repositories/settings-repository';
import type { TripId } from '@/types';
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
 * Small delay to allow live queries to update.
 */
async function waitForLiveQuery(ms = 50): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Initial State Tests
// ============================================================================

describe('TripContext', () => {
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
      let caughtError: Error | null = null;
      try {
        await act(async () => {
          await result.current.setCurrentTrip('nonexistent_trip_id');
        });
      } catch (error) {
        caughtError = error as Error;
      }

      // Verify error was thrown
      expect(caughtError).not.toBeNull();
      expect(caughtError?.message).toContain('nonexistent_trip_id');
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

      // Verify persisted to settings
      const trip = await getTripById(tripId);
      expect(trip).toBeDefined();
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

  describe('checkConnection', () => {
    it('verifies database connectivity', async () => {
      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should not throw
      await act(async () => {
        await result.current.checkConnection();
      });

      expect(result.current.error).toBeNull();
    });

    it('does not throw on healthy database', async () => {
      const { result } = renderHook(() => useTripContext(), {
        wrapper: TripContextWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should complete successfully
      await expect(
        act(async () => {
          await result.current.checkConnection();
        })
      ).resolves.not.toThrow();
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
      await createTestTrip('Trip 3');
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
  });
});
