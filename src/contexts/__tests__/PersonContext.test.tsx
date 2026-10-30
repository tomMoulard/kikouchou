/**
 * PersonContext Tests
 *
 * Tests for the PersonContext provider including:
 * - Initial state and loading
 * - CRUD operations (create, update, delete)
 * - getPersonById lookup
 * - Trip scoping
 * - Error handling
 *
 * @module contexts/__tests__/PersonContext.test
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { TripProvider, useTripContext } from '@/contexts/TripContext';
import { PersonProvider, usePersonContext } from '@/contexts/PersonContext';
import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import type { PersonId, TripId, Person, HexColor } from '@/types';
import { isoDate, hexColor } from '@/test/utils';

// ============================================================================
// Test Helpers
// ============================================================================

function AllContextsWrapper({ children }: { children: ReactNode }) {
  return (
    <TripProvider>
      <PersonProvider>{children}</PersonProvider>
    </TripProvider>
  );
}

function useCombinedContexts() {
  const trip = useTripContext();
  const person = usePersonContext();
  return { trip, person };
}

async function createTestTripData(name = 'Test Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-30'),
  });
  return trip.id;
}

async function createTestPerson(tripId: TripId, name = 'Test Person'): Promise<Person> {
  return await createPerson(tripId, { name, color: hexColor('#ef4444') });
}

async function waitForLiveQuery(ms = 100): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('PersonContext', () => {
  describe('Initial State', () => {
    it('starts with empty persons when no trip selected', async () => {
      const { result } = renderHook(() => usePersonContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.persons).toEqual([]);
    });

    it('starts with error as null', async () => {
      const { result } = renderHook(() => usePersonContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('Loading persons for a trip', () => {
    it('loads persons when trip is selected', async () => {
      const tripId = await createTestTripData();
      await createTestPerson(tripId, 'Alice');
      await createTestPerson(tripId, 'Bob');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.person.persons).toHaveLength(2);
      });
    });

    it('clears persons when trip changes', async () => {
      const tripId1 = await createTestTripData('Trip 1');
      const tripId2 = await createTestTripData('Trip 2');
      await createTestPerson(tripId1, 'Alice');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId1);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.person.persons).toHaveLength(1);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId2);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.person.persons).toHaveLength(0);
      });
    });
  });

  describe('createPerson', () => {
    it('creates person with valid data when trip is selected', async () => {
      const tripId = await createTestTripData();

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      let createdPerson: Person | undefined;
      await act(async () => {
        createdPerson = await result.current.person.createPerson({
          name: 'Charlie',
          color: '#3b82f6' as HexColor,
        });
      });

      expect(createdPerson).toBeDefined();
      expect(createdPerson!.name).toBe('Charlie');
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => usePersonContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.createPerson({
            name: 'X',
            color: '#000000' as HexColor,
          });
        })
      ).rejects.toThrow('no trip selected');
    });
  });

  describe('updatePerson', () => {
    it('updates person name', async () => {
      const tripId = await createTestTripData();
      const person = await createTestPerson(tripId, 'Original');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      await act(async () => {
        await result.current.person.updatePerson(person.id, { name: 'Updated' });
      });

      await waitForLiveQuery();

      await waitFor(() => {
        const updated = result.current.person.persons.find((p) => p.id === person.id);
        expect(updated?.name).toBe('Updated');
      });
    });

    it('updates person stay dates in context state', async () => {
      const tripId = await createTestTripData();
      const person = await createTestPerson(tripId, 'Traveler');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      await act(async () => {
        await result.current.person.updatePerson(person.id, {
          stayStartDate: isoDate('2026-04-23'),
          stayEndDate: isoDate('2026-04-24'),
        });
      });

      await waitForLiveQuery();

      await waitFor(() => {
        const updated = result.current.person.persons.find((p) => p.id === person.id);
        expect(updated?.stayStartDate).toBe(isoDate('2026-04-23'));
        expect(updated?.stayEndDate).toBe(isoDate('2026-04-24'));
      });
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => usePersonContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.updatePerson('p_123' as PersonId, { name: 'x' });
        })
      ).rejects.toThrow('no trip selected');
    });
  });

  describe('deletePerson', () => {
    it('deletes person', async () => {
      const tripId = await createTestTripData();
      const person = await createTestPerson(tripId, 'To Delete');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.person.persons).toHaveLength(1);
      });

      await act(async () => {
        await result.current.person.deletePerson(person.id);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.person.persons).toHaveLength(0);
      });
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => usePersonContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.deletePerson('p_123' as PersonId);
        })
      ).rejects.toThrow('no trip selected');
    });
  });

  describe('getPersonById', () => {
    it('returns person by ID', async () => {
      const tripId = await createTestTripData();
      const person = await createTestPerson(tripId, 'Alice');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.person.persons).toHaveLength(1);
      });

      const found = result.current.person.getPersonById(person.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe('Alice');
    });

    it('returns undefined for unknown ID', async () => {
      const { result } = renderHook(() => usePersonContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const found = result.current.getPersonById('unknown' as PersonId);
      expect(found).toBeUndefined();
    });
  });

  /**
   * Persons carry no `updatedAt`, so the comparator is the only thing between a
   * change and the UI: a field it forgets is a field that never re-renders.
   * `headcount` was in fact missing, and it is the field every derived total
   * (meals, groceries) is computed from — editing it left those on the old
   * number until some other field happened to change too.
   */
  describe('comparator covers every mutable field', () => {
    const mutations: readonly {
      readonly field: string;
      readonly patch: Partial<Person>;
      readonly read: (person: Person | undefined) => unknown;
      readonly expected: unknown;
    }[] = [
      {
        field: 'name',
        patch: { name: 'Renamed' },
        read: (person) => person?.name,
        expected: 'Renamed',
      },
      {
        field: 'color',
        patch: { color: hexColor('#22c55e') },
        read: (person) => person?.color,
        expected: '#22c55e',
      },
      {
        field: 'stayStartDate',
        patch: { stayStartDate: isoDate('2024-07-16') },
        read: (person) => person?.stayStartDate,
        expected: '2024-07-16',
      },
      {
        field: 'stayEndDate',
        patch: { stayEndDate: isoDate('2024-07-28') },
        read: (person) => person?.stayEndDate,
        expected: '2024-07-28',
      },
      {
        field: 'notes',
        patch: { notes: 'Gluten free' },
        read: (person) => person?.notes,
        expected: 'Gluten free',
      },
      {
        field: 'headcount',
        patch: { headcount: 2 },
        read: (person) => person?.headcount,
        expected: 2,
      },
      {
        field: 'childSeat',
        patch: { childSeat: 'booster' },
        read: (person) => person?.childSeat,
        expected: 'booster',
      },
    ];

    for (const { field, patch, read, expected } of mutations) {
      it(`propagates a change to ${field}`, async () => {
        const tripId = await createTestTripData();
        const person = await createTestPerson(tripId, 'Original');

        const { result } = renderHook(() => useCombinedContexts(), {
          wrapper: AllContextsWrapper,
        });

        await waitFor(() => {
          expect(result.current.trip.isLoading).toBe(false);
        });

        await act(async () => {
          await result.current.trip.setCurrentTrip(tripId);
        });

        await waitFor(() => {
          expect(result.current.person.persons).toHaveLength(1);
        });

        // `waitFor` below already polls, so the sleep buys nothing — but the
        // write does need act(), or the live query's setState lands loose.
        await act(async () => {
          await db.persons.update(person.id, patch);
        });

        await waitFor(() => {
          const updated = result.current.person.persons.find(
            (p) => p.id === person.id,
          );
          expect(read(updated)).toEqual(expected);
        });
      });
    }

    it('propagates a headcount change made through the context', async () => {
      const tripId = await createTestTripData();
      const person = await createTestPerson(tripId, 'Alice+Auré');

      const { result } = renderHook(() => useCombinedContexts(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.trip.isLoading).toBe(false);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId);
      });

      await waitFor(() => {
        expect(result.current.person.persons).toHaveLength(1);
      });

      await act(async () => {
        await result.current.person.updatePerson(person.id, { headcount: 2 });
      });
      await waitForLiveQuery();

      await waitFor(() => {
        const updated = result.current.person.persons.find(
          (p) => p.id === person.id,
        );
        expect(updated?.headcount).toBe(2);
      });
    });
  });

  describe('usePersonContext Hook', () => {
    it('throws error when used outside provider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => usePersonContext());
      }).toThrow('usePersonContext must be used within a PersonProvider');

      consoleSpy.mockRestore();
    });
  });
});
