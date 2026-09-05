/**
 * TransportContext Tests
 *
 * Tests for the TransportContext provider including:
 * - Initial state and loading
 * - CRUD operations (create, update, delete)
 * - Computed arrays (arrivals, departures, upcomingPickups)
 * - getTransportsByPerson lookup
 * - Trip scoping
 * - Error handling
 *
 * @module contexts/__tests__/TransportContext.test
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { TripProvider, useTripContext } from '@/contexts/TripContext';
import { TransportProvider, useTransportContext } from '@/contexts/TransportContext';
import { PersonProvider } from '@/contexts/PersonContext';
import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createTransport } from '@/lib/db/repositories/transport-repository';
import type { PersonId, TripId, Transport, TransportId } from '@/types';
import { isoDate, hexColor } from '@/test/utils';

// ============================================================================
// Test Helpers
// ============================================================================

function AllContextsWrapper({ children }: { children: ReactNode }) {
  return (
    <TripProvider>
      <PersonProvider>
        <TransportProvider>{children}</TransportProvider>
      </PersonProvider>
    </TripProvider>
  );
}

function useCombinedContexts() {
  const trip = useTripContext();
  const transport = useTransportContext();
  return { trip, transport };
}

async function createTestTripData(name = 'Test Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-30'),
  });
  return trip.id;
}

async function createTestPerson(tripId: TripId, name = 'Alice'): Promise<PersonId> {
  const person = await createPerson(tripId, { name, color: hexColor('#ef4444') });
  return person.id;
}

async function waitForLiveQuery(ms = 100): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('TransportContext', () => {
  describe('Initial State', () => {
    it('starts with empty transports when no trip selected', async () => {
      const { result } = renderHook(() => useTransportContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.transports).toEqual([]);
      expect(result.current.arrivals).toEqual([]);
      expect(result.current.departures).toEqual([]);
      expect(result.current.upcomingPickups).toEqual([]);
    });

    it('starts with error as null', async () => {
      const { result } = renderHook(() => useTransportContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('Loading transports for a trip', () => {
    it('loads transports and classifies them', async () => {
      const tripId = await createTestTripData();
      const personId = await createTestPerson(tripId);

      await createTransport(tripId, {
        type: 'arrival',
        personId,
        datetime: '2024-07-15T10:00:00.000Z',
        location: '',
        needsPickup: false,
      });
      await createTransport(tripId, {
        type: 'departure',
        personId,
        datetime: '2024-07-20T14:00:00.000Z',
        location: '',
        needsPickup: false,
      });

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
        expect(result.current.transport.transports).toHaveLength(2);
      });

      expect(result.current.transport.arrivals).toHaveLength(1);
      expect(result.current.transport.departures).toHaveLength(1);
    });

    it('clears transports when trip changes', async () => {
      const tripId1 = await createTestTripData('Trip 1');
      const tripId2 = await createTestTripData('Trip 2');
      const personId = await createTestPerson(tripId1);
      await createTransport(tripId1, {
        type: 'arrival',
        personId,
        datetime: '2024-07-15T10:00:00.000Z',
        location: 'Airport',
        needsPickup: false,
      });

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
        expect(result.current.transport.transports).toHaveLength(1);
      });

      await act(async () => {
        await result.current.trip.setCurrentTrip(tripId2);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.transport.transports).toHaveLength(0);
      });
    });
  });

  describe('createTransport', () => {
    it('creates transport with valid data', async () => {
      const tripId = await createTestTripData();
      const personId = await createTestPerson(tripId);

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

      let created: Transport | undefined;
      await act(async () => {
        created = await result.current.transport.createTransport({
          type: 'arrival',
          personId,
          datetime: '2024-07-15T10:00:00.000Z',
          location: 'Airport',
          needsPickup: true,
        });
      });

      expect(created).toBeDefined();
      expect(created!.type).toBe('arrival');
      expect(created!.location).toBe('Airport');
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => useTransportContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.createTransport({
            type: 'arrival',
            personId: 'p_123' as PersonId,
            datetime: '2024-07-15T10:00:00.000Z',
            location: '',
            needsPickup: false,
          });
        })
      ).rejects.toThrow('no trip selected');
    });
  });

  describe('updateTransport', () => {
    it('updates transport location', async () => {
      const tripId = await createTestTripData();
      const personId = await createTestPerson(tripId);

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

      let transport: Transport | undefined;
      await act(async () => {
        transport = await result.current.transport.createTransport({
          type: 'arrival',
          personId,
          datetime: '2024-07-15T10:00:00.000Z',
          location: 'Airport',
          needsPickup: false,
        });
      });

      await act(async () => {
        await result.current.transport.updateTransport(transport!.id, {
          location: 'Train Station',
        });
      });

      await waitForLiveQuery();

      await waitFor(() => {
        const updated = result.current.transport.transports.find(
          (t) => t.id === transport!.id
        );
        expect(updated?.location).toBe('Train Station');
      });
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => useTransportContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.updateTransport('t_123' as TransportId, {
            location: 'x',
          });
        })
      ).rejects.toThrow('no trip selected');
    });
  });

  describe('deleteTransport', () => {
    it('deletes transport', async () => {
      const tripId = await createTestTripData();
      const personId = await createTestPerson(tripId);

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

      let transport: Transport | undefined;
      await act(async () => {
        transport = await result.current.transport.createTransport({
          type: 'departure',
          personId,
          datetime: '2024-07-20T14:00:00.000Z',
          location: '',
          needsPickup: false,
        });
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.transport.transports).toHaveLength(1);
      });

      await act(async () => {
        await result.current.transport.deleteTransport(transport!.id);
      });

      await waitForLiveQuery();

      await waitFor(() => {
        expect(result.current.transport.transports).toHaveLength(0);
      });
    });

    it('throws error when no trip selected', async () => {
      const { result } = renderHook(() => useTransportContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.deleteTransport('t_123' as TransportId);
        })
      ).rejects.toThrow('no trip selected');
    });
  });

  describe('getTransportsByPerson', () => {
    it('returns transports for a person', async () => {
      const tripId = await createTestTripData();
      const person1 = await createTestPerson(tripId, 'Alice');
      const person2 = await createTestPerson(tripId, 'Bob');

      await createTransport(tripId, {
        type: 'arrival',
        personId: person1,
        datetime: '2024-07-15T10:00:00.000Z',
        location: '',
        needsPickup: false,
      });
      await createTransport(tripId, {
        type: 'departure',
        personId: person1,
        datetime: '2024-07-20T14:00:00.000Z',
        location: '',
        needsPickup: false,
      });
      await createTransport(tripId, {
        type: 'arrival',
        personId: person2,
        datetime: '2024-07-16T12:00:00.000Z',
        location: '',
        needsPickup: false,
      });

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
        expect(result.current.transport.transports).toHaveLength(3);
      });

      const person1Transports = result.current.transport.getTransportsByPerson(person1);
      expect(person1Transports).toHaveLength(2);

      const person2Transports = result.current.transport.getTransportsByPerson(person2);
      expect(person2Transports).toHaveLength(1);
    });

    it('returns empty array for person with no transports', async () => {
      const { result } = renderHook(() => useTransportContext(), {
        wrapper: AllContextsWrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const transports = result.current.getTransportsByPerson('unknown' as PersonId);
      expect(transports).toEqual([]);
    });
  });

  /**
   * Transports carry no `updatedAt`, so the comparator is the only thing
   * between a change and the UI. Three fields were missing — `coordinates`,
   * `startLocation` and `startCoordinates` — which is to say the three the map
   * draws from: moving a pin or naming a starting point left the old marker and
   * the old route on screen until some other field happened to change too.
   *
   * The nested pairs get a case per axis. Moving both at once passes for a deep
   * compare that reads only one of them.
   */
  describe('comparator covers every mutable field', () => {
    const mutations: readonly {
      readonly field: string;
      /** Applied before the hook mounts, when the case needs a starting value. */
      readonly seed?: Partial<Transport>;
      /** A plain patch, or one that needs the second guest's id. */
      readonly patch: Partial<Transport> | ((otherPersonId: PersonId) => Partial<Transport>);
      readonly read: (transport: Transport | undefined) => unknown;
      readonly expected?: unknown;
      /** Set when the expected value is the second guest's id. */
      readonly expectOther?: boolean;
    }[] = [
      {
        field: 'type',
        patch: { type: 'departure' },
        read: (t) => t?.type,
        expected: 'departure',
      },
      // Both person references get a case. `personId` decides whose row this
      // is and `driverId` who collects them, and neither is reachable from any
      // other test in this file.
      {
        field: 'personId',
        patch: (otherPersonId) => ({ personId: otherPersonId }),
        read: (t) => t?.personId,
        expectOther: true,
      },
      {
        field: 'driverId',
        patch: (otherPersonId) => ({ driverId: otherPersonId }),
        read: (t) => t?.driverId,
        expectOther: true,
      },
      {
        field: 'datetime',
        patch: { datetime: '2024-07-20T08:15:00.000Z' as Transport['datetime'] },
        read: (t) => t?.datetime,
        expected: '2024-07-20T08:15:00.000Z',
      },
      {
        field: 'location',
        patch: { location: 'Gare Montparnasse' },
        read: (t) => t?.location,
        expected: 'Gare Montparnasse',
      },
      {
        field: 'needsPickup',
        patch: { needsPickup: true },
        read: (t) => t?.needsPickup,
        expected: true,
      },
      {
        field: 'transportMode',
        patch: { transportMode: 'train' },
        read: (t) => t?.transportMode,
        expected: 'train',
      },
      {
        field: 'transportNumber',
        patch: { transportNumber: 'TGV 8541' },
        read: (t) => t?.transportNumber,
        expected: 'TGV 8541',
      },
      {
        field: 'notes',
        patch: { notes: 'Platform 12' },
        read: (t) => t?.notes,
        expected: 'Platform 12',
      },
      {
        field: 'coordinates, from absent to present',
        patch: { coordinates: { lat: 48.8566, lon: 2.3522 } },
        read: (t) => t?.coordinates,
        expected: { lat: 48.8566, lon: 2.3522 },
      },
      {
        field: 'coordinates.lat alone',
        seed: { coordinates: { lat: 48.8566, lon: 2.3522 } },
        patch: { coordinates: { lat: 43.2965, lon: 2.3522 } },
        read: (t) => t?.coordinates?.lat,
        expected: 43.2965,
      },
      {
        field: 'coordinates.lon alone',
        seed: { coordinates: { lat: 48.8566, lon: 2.3522 } },
        patch: { coordinates: { lat: 48.8566, lon: 5.3698 } },
        read: (t) => t?.coordinates?.lon,
        expected: 5.3698,
      },
      {
        field: 'startLocation',
        patch: { startLocation: 'Home' },
        read: (t) => t?.startLocation,
        expected: 'Home',
      },
      {
        field: 'startCoordinates, from absent to present',
        patch: { startCoordinates: { lat: 45.764, lon: 4.8357 } },
        read: (t) => t?.startCoordinates,
        expected: { lat: 45.764, lon: 4.8357 },
      },
      {
        field: 'startCoordinates.lat alone',
        seed: { startCoordinates: { lat: 45.764, lon: 4.8357 } },
        patch: { startCoordinates: { lat: 44.8378, lon: 4.8357 } },
        read: (t) => t?.startCoordinates?.lat,
        expected: 44.8378,
      },
      {
        field: 'startCoordinates.lon alone',
        seed: { startCoordinates: { lat: 45.764, lon: 4.8357 } },
        patch: { startCoordinates: { lat: 45.764, lon: -0.5792 } },
        read: (t) => t?.startCoordinates?.lon,
        expected: -0.5792,
      },
    ];

    for (const { field, seed, patch, read, expected, expectOther } of mutations) {
      it(`propagates a change to ${field}`, async () => {
        const tripId = await createTestTripData();
        const personId = await createTestPerson(tripId);
        // The two person-reference cases point at this second guest.
        const otherPersonId = await createTestPerson(tripId, 'Second Guest');
        const created = await createTransport(tripId, {
          type: 'arrival',
          personId,
          datetime: '2024-07-15T10:00:00.000Z' as Transport['datetime'],
          location: 'Airport',
          needsPickup: false,
        });
        if (seed) {
          await db.transports.update(created.id, seed);
        }

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
          expect(result.current.transport.transports).toHaveLength(1);
        });

        // The seeded cases move one axis of a pair the context must already be
        // holding. Without this the ref can still lag a query emission, the
        // comparison under test becomes absent-vs-present, and a comparator
        // that ignores that one axis slips through.
        if (seed) {
          await waitFor(() => {
            const seeded = result.current.transport.transports.find(
              (t) => t.id === created.id,
            );
            expect({
              coordinates: seeded?.coordinates,
              startCoordinates: seeded?.startCoordinates,
            }).toEqual({
              coordinates: seed.coordinates,
              startCoordinates: seed.startCoordinates,
            });
          });
        }

        await act(async () => {
          await db.transports.update(
            created.id,
            typeof patch === 'function' ? patch(otherPersonId) : patch,
          );
        });

        await waitFor(() => {
          const updated = result.current.transport.transports.find(
            (t) => t.id === created.id,
          );
          expect(read(updated)).toEqual(
            expectOther === true ? otherPersonId : expected,
          );
        });
      });
    }

    it('propagates a coordinates change made through the context', async () => {
      const tripId = await createTestTripData();
      const personId = await createTestPerson(tripId);
      const created = await createTransport(tripId, {
        type: 'arrival',
        personId,
        datetime: '2024-07-15T10:00:00.000Z' as Transport['datetime'],
        location: 'Airport',
        needsPickup: false,
      });

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
        expect(result.current.transport.transports).toHaveLength(1);
      });

      await act(async () => {
        await result.current.transport.updateTransport(created.id, {
          coordinates: { lat: 48.8566, lon: 2.3522 },
          startLocation: 'Home',
        });
      });

      await waitFor(() => {
        const updated = result.current.transport.transports.find(
          (t) => t.id === created.id,
        );
        expect(updated?.coordinates).toEqual({ lat: 48.8566, lon: 2.3522 });
        expect(updated?.startLocation).toBe('Home');
      });
    });
  });

  describe('useTransportContext Hook', () => {
    it('throws error when used outside provider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        renderHook(() => useTransportContext());
      }).toThrow('useTransportContext must be used within a TransportProvider');

      consoleSpy.mockRestore();
    });
  });
});
