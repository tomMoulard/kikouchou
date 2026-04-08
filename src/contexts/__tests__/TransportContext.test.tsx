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
