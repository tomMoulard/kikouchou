/**
 * RideContext Tests
 *
 * Covers the provider's write surface: what each mutation lands in Dexie, what
 * it reports when the row is not this trip's to touch, and the two lookups the
 * ride pages read through.
 *
 * The database is the real one (fake-indexeddb, wiped per test by
 * `src/test/setup.ts`), so a mutation that claims to have saved is asserted
 * against the rows that actually exist.
 *
 * @module contexts/__tests__/RideContext.test
 */

import type { ReactNode } from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { PersonProvider } from '@/contexts/PersonContext';
import { RideProvider, useRideContext } from '@/contexts/RideContext';
import { TransportProvider } from '@/contexts/TransportContext';
import { TripProvider, useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { createTransport } from '@/lib/db/repositories/transport-repository';
import {
  createTestPerson,
  createTestRide,
  createTestTrip,
  createTestVehicle,
  localInstant,
} from '@/test/utils';
import type { RideId, TransportId, TripId, VehicleId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <TripProvider>
      <PersonProvider>
        <TransportProvider>
          <RideProvider>{children}</RideProvider>
        </TransportProvider>
      </PersonProvider>
    </TripProvider>
  );
}

function useCombined() {
  return { trip: useTripContext(), rides: useRideContext() };
}

/** Lets the Dexie live queries publish before the assertions read them. */
async function waitForLiveQuery(ms = 100): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function renderWithTrip(tripId: TripId) {
  const { result } = renderHook(() => useCombined(), { wrapper: Wrapper });

  await waitFor(() => {
    expect(result.current.trip.isLoading).toBe(false);
  });

  await act(async () => {
    await result.current.trip.setCurrentTrip(tripId);
  });

  await waitFor(() => {
    expect(result.current.trip.currentTrip?.id).toBe(tripId);
  });

  await waitForLiveQuery();

  return result;
}

/** Renders with the trip list loaded and nothing selected. */
async function renderWithoutTrip() {
  const { result } = renderHook(() => useCombined(), { wrapper: Wrapper });

  await waitFor(() => {
    expect(result.current.trip.isLoading).toBe(false);
  });

  return result;
}

// ============================================================================
// Tests
// ============================================================================

describe('RideContext — reading', () => {
  it('starts empty when no trip is selected', async () => {
    const result = await renderWithoutTrip();

    expect(result.current.rides.rides).toEqual([]);
    expect(result.current.rides.vehicles).toEqual([]);
    expect(result.current.rides.error).toBeNull();
  });

  it('publishes the rides and vehicles of the current trip', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    await createTestRide(tripId, {
      meetDatetime: localInstant('2026-07-02', '09:00'),
      location: 'Gare de Lyon',
    });
    await createTestVehicle(tripId, { name: 'The van', seatCount: 7 });

    const result = await renderWithTrip(tripId);

    expect(result.current.rides.rides.map((ride) => ride.location)).toEqual(['Gare de Lyon']);
    expect(result.current.rides.vehicles.map((vehicle) => vehicle.name)).toEqual(['The van']);
  });

  it('leaves another trip’s rides out', async () => {
    const tripId = await createTestTrip({ name: 'Mine', startDate: '2026-07-01' });
    const otherTripId = await createTestTrip({ name: 'Theirs', startDate: '2026-07-01' });
    await createTestRide(otherTripId, {
      meetDatetime: localInstant('2026-07-02', '09:00'),
      location: 'Orly',
    });

    const result = await renderWithTrip(tripId);

    expect(result.current.rides.rides).toEqual([]);
  });

  it('finds a ride and a vehicle by id, and says so when there is none', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    const rideId = await createTestRide(tripId, {
      meetDatetime: localInstant('2026-07-02', '09:00'),
      location: 'Gare de Lyon',
    });
    const vehicleId = await createTestVehicle(tripId, { name: 'The van' });

    const result = await renderWithTrip(tripId);

    expect(result.current.rides.getRideById(rideId)?.location).toBe('Gare de Lyon');
    expect(result.current.rides.getVehicleById(vehicleId)?.name).toBe('The van');
    expect(result.current.rides.getRideById('gone' as RideId)).toBeUndefined();
    expect(result.current.rides.getVehicleById('gone' as VehicleId)).toBeUndefined();
  });

  it('republishes a vehicle whose child seats changed shape', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    const vehicleId = await createTestVehicle(tripId, {
      name: 'The van',
      childSeats: ['booster'],
    });

    const result = await renderWithTrip(tripId);
    expect(result.current.rides.getVehicleById(vehicleId)?.childSeats).toEqual(['booster']);

    await act(async () => {
      await result.current.rides.updateVehicle(vehicleId, { childSeats: [] });
    });
    await waitForLiveQuery();

    expect(result.current.rides.getVehicleById(vehicleId)?.childSeats).toEqual([]);
  });
});

describe('RideContext — writing', () => {
  it('creates a ride and a vehicle for the current trip', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    const result = await renderWithTrip(tripId);

    await act(async () => {
      await result.current.rides.createRide({
        direction: 'pickup',
        meetDatetime: localInstant('2026-07-02', '09:00'),
        location: 'Gare de Lyon',
      });
      await result.current.rides.createVehicle({ name: 'The van', seatCount: 7 });
    });
    await waitForLiveQuery();

    expect(result.current.rides.error).toBeNull();
    await expect(db.rides.where('tripId').equals(tripId).count()).resolves.toBe(1);
    await expect(db.vehicles.where('tripId').equals(tripId).count()).resolves.toBe(1);
  });

  it('updates and then deletes a ride', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    const rideId = await createTestRide(tripId, {
      meetDatetime: localInstant('2026-07-02', '09:00'),
      location: 'Gare de Lyon',
    });
    const result = await renderWithTrip(tripId);

    await act(async () => {
      await result.current.rides.updateRide(rideId, { location: 'Orly' });
    });
    await waitForLiveQuery();
    expect(result.current.rides.getRideById(rideId)?.location).toBe('Orly');

    await act(async () => {
      await result.current.rides.deleteRide(rideId);
    });
    await waitForLiveQuery();
    expect(result.current.rides.rides).toEqual([]);
    expect(result.current.rides.error).toBeNull();
  });

  it('updates and then deletes a vehicle', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    const vehicleId = await createTestVehicle(tripId, { name: 'The van' });
    const result = await renderWithTrip(tripId);

    await act(async () => {
      await result.current.rides.updateVehicle(vehicleId, { name: 'The big van' });
    });
    await waitForLiveQuery();
    expect(result.current.rides.getVehicleById(vehicleId)?.name).toBe('The big van');

    await act(async () => {
      await result.current.rides.deleteVehicle(vehicleId);
    });
    await waitForLiveQuery();
    expect(result.current.rides.vehicles).toEqual([]);
    expect(result.current.rides.error).toBeNull();
  });

  it('puts a transport on a ride and takes it off again', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    const personId = await createTestPerson(tripId, { name: 'Alice' });
    const rideId = await createTestRide(tripId, {
      meetDatetime: localInstant('2026-07-02', '09:00'),
      location: 'Gare de Lyon',
    });
    const transport = await createTransport(tripId, {
      personId,
      type: 'arrival',
      datetime: localInstant('2026-07-02', '09:30'),
      location: 'Gare de Lyon',
      needsPickup: true,
    });

    const result = await renderWithTrip(tripId);

    await act(async () => {
      await result.current.rides.setTransportRide(transport.id, rideId);
    });
    await expect(db.transports.get(transport.id)).resolves.toMatchObject({ rideId });

    await act(async () => {
      await result.current.rides.setTransportRide(transport.id, undefined);
    });
    const cleared = await db.transports.get(transport.id);
    expect(cleared?.rideId).toBeUndefined();
    expect(result.current.rides.error).toBeNull();
  });
});

describe('RideContext — refusals', () => {
  it('refuses every write while no trip is selected', async () => {
    const result = await renderWithoutTrip();
    const { rides } = result.current;

    await expect(
      rides.createRide({
        direction: 'pickup',
        meetDatetime: localInstant('2026-07-02', '09:00'),
        location: 'Gare de Lyon',
      }),
    ).rejects.toThrow('No trip selected');
    await expect(rides.updateRide('r' as RideId, { location: 'Orly' })).rejects.toThrow(
      'No trip selected',
    );
    await expect(rides.deleteRide('r' as RideId)).rejects.toThrow('No trip selected');
    await expect(rides.createVehicle({ name: 'The van' })).rejects.toThrow('No trip selected');
    await expect(rides.updateVehicle('v' as VehicleId, { name: 'x' })).rejects.toThrow(
      'No trip selected',
    );
    await expect(rides.deleteVehicle('v' as VehicleId)).rejects.toThrow('No trip selected');
    await expect(
      rides.setTransportRide('t' as TransportId, 'r' as RideId),
    ).rejects.toThrow('No trip selected');
  });

  it('reports a ride that belongs to another trip rather than touching it', async () => {
    const tripId = await createTestTrip({ name: 'Mine', startDate: '2026-07-01' });
    const otherTripId = await createTestTrip({ name: 'Theirs', startDate: '2026-07-01' });
    const strangerRideId = await createTestRide(otherTripId, {
      meetDatetime: localInstant('2026-07-02', '09:00'),
      location: 'Orly',
    });

    const result = await renderWithTrip(tripId);

    await act(async () => {
      await expect(
        result.current.rides.updateRide(strangerRideId, { location: 'Hijacked' }),
      ).rejects.toThrow();
    });

    await waitFor(() => {
      expect(result.current.rides.error).toBeInstanceOf(Error);
    });
    await expect(db.rides.get(strangerRideId)).resolves.toMatchObject({ location: 'Orly' });
  });

  it('reports a vehicle that belongs to another trip rather than touching it', async () => {
    const tripId = await createTestTrip({ name: 'Mine', startDate: '2026-07-01' });
    const otherTripId = await createTestTrip({ name: 'Theirs', startDate: '2026-07-01' });
    const strangerVehicleId = await createTestVehicle(otherTripId, { name: 'Their van' });

    const result = await renderWithTrip(tripId);

    await act(async () => {
      await expect(result.current.rides.deleteVehicle(strangerVehicleId)).rejects.toThrow();
    });

    await waitFor(() => {
      expect(result.current.rides.error).toBeInstanceOf(Error);
    });
    await expect(db.vehicles.get(strangerVehicleId)).resolves.toBeDefined();
  });

  it('reports a transport that is not on this trip', async () => {
    const tripId = await createTestTrip({ name: 'Mine', startDate: '2026-07-01' });
    const result = await renderWithTrip(tripId);

    await act(async () => {
      await expect(
        result.current.rides.setTransportRide('no-such-transport' as TransportId, undefined),
      ).rejects.toThrow();
    });

    await waitFor(() => {
      expect(result.current.rides.error).toBeInstanceOf(Error);
    });
  });
});

describe('useRideContext', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to be read outside a RideProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useRideContext());
    }).toThrow('useRideContext must be used within a RideProvider');
  });
});
