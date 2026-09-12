/**
 * @fileoverview Tests for AllTripsAnalyticsPage.
 * @module features/analytics/pages/__tests__/AllTripsAnalyticsPage.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor, within } from '@/test/utils';
import { loadTripStats } from '@/features/analytics/lib/trip-stats';
import { db } from '@/lib/db/database';
import type { Person, Ride, Room, Transport, Trip, TripId, Vehicle } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_A = 'trip-a' as TripId;
const TRIP_B = 'trip-b' as TripId;

function trip(id: TripId, name: string): Trip {
  return {
    id,
    shareId: `share-${id}`,
    name,
    location: 'Paris',
    startDate: '2026-07-01',
    endDate: '2026-07-10',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as unknown as Trip;
}

const TRIP_A_ROW = trip(TRIP_A, 'Trip A');
const TRIP_B_ROW = trip(TRIP_B, 'Trip B');

function person(id: string, tripId: TripId, headcount?: number): Person {
  return {
    id,
    tripId,
    name: id,
    color: '#3b82f6',
    ...(headcount === undefined ? {} : { headcount }),
  } as unknown as Person;
}

function room(id: string, tripId: TripId, order: number): Room {
  return { id, tripId, name: id, capacity: 2, order } as unknown as Room;
}

function vehicle(id: string, tripId: TripId): Vehicle {
  return { id, tripId, name: id, seatCount: 5 } as unknown as Vehicle;
}

function ride(id: string, tripId: TripId): Ride {
  return {
    id,
    tripId,
    direction: 'pickup',
    meetDatetime: '2026-07-02T14:00:00.000Z',
    location: 'Gare du Nord',
  } as unknown as Ride;
}

function transport(
  id: string,
  tripId: TripId,
  type: 'arrival' | 'departure',
): Transport {
  return {
    id,
    tripId,
    personId: 'p1',
    type,
    datetime: '2026-07-02T14:00:00.000Z',
    location: 'Gare du Nord',
    needsPickup: false,
  } as unknown as Transport;
}

// ============================================================================
// Mocks
// ============================================================================

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(),
}));

vi.mock('@/features/trips/components/TripsLocationMap', () => ({
  TripsLocationMap: () => <div data-testid="trips-location-map" />,
}));

import { AllTripsAnalyticsPage } from '../AllTripsAnalyticsPage';
import { useTripContext } from '@/contexts/TripContext';

// ============================================================================
// Helpers
// ============================================================================

function mockTripContext(
  overrides: Partial<ReturnType<typeof useTripContext>> = {},
): void {
  vi.mocked(useTripContext).mockReturnValue({
    trips: [TRIP_A_ROW, TRIP_B_ROW],
    currentTrip: TRIP_A_ROW,
    isLoading: false,
    error: null,
    setCurrentTrip: vi.fn().mockResolvedValue(undefined),
    checkConnection: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useTripContext>);
}

/** The value rendered under a stat card's label. */
function statValue(label: string): string | null {
  const heading = screen.getAllByText(label)[0];
  return heading?.closest('[data-slot="card"]')?.querySelector('p')?.textContent ?? null;
}

// ============================================================================
// Tests
// ============================================================================

describe('AllTripsAnalyticsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockTripContext();
  });

  it('totals headcount across trips, not guest rows', async () => {
    await db.persons.bulkPut([
      person('p1', TRIP_A, 2),
      person('p2', TRIP_A, 3),
      person('p3', TRIP_B, 4),
    ]);

    render(<AllTripsAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(statValue('analytics.totalPeople')).toBe('9');
    });
  });

  it('totals transport legs the same way the trip page does', async () => {
    await db.transports.bulkPut([
      transport('t1', TRIP_A, 'arrival'),
      transport('t2', TRIP_A, 'departure'),
      transport('t3', TRIP_B, 'arrival'),
    ]);

    render(<AllTripsAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(statValue('analytics.totalTransports')).toBe('3');
    });

    // The number a trip's own page would show, from the same reader.
    const tripA = await loadTripStats(TRIP_A, new Date().toISOString());
    const tripB = await loadTripStats(TRIP_B, new Date().toISOString());
    expect(tripA.transportCount + tripB.transportCount).toBe(3);
  });

  it('totals rides and cars across trips, apart from the legs', async () => {
    await db.vehicles.bulkPut([vehicle('v1', TRIP_A), vehicle('v2', TRIP_B)]);
    await db.rides.bulkPut([
      ride('ride-1', TRIP_A),
      ride('ride-2', TRIP_A),
      ride('ride-3', TRIP_B),
    ]);

    render(<AllTripsAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(statValue('analytics.totalRides')).toBe('3');
    });
    expect(statValue('analytics.totalVehicles')).toBe('2');

    // The sum a reader would get from the two trips' own pages.
    const now = new Date().toISOString();
    const tripA = await loadTripStats(TRIP_A, now);
    const tripB = await loadTripStats(TRIP_B, now);
    expect(tripA.rideCount + tripB.rideCount).toBe(3);
    expect(tripA.vehicleCount + tripB.vehicleCount).toBe(2);
  });

  it('lists one breakdown row per trip', async () => {
    await db.persons.bulkPut([person('p1', TRIP_A, 2)]);
    await db.rooms.bulkPut([room('r1', TRIP_A, 0)]);

    render(<AllTripsAnalyticsPage />, { withProviders: false });

    const breakdown = await screen.findByRole('list', {
      name: 'analytics.tripBreakdown',
    });
    await waitFor(() => {
      expect(within(breakdown).getAllByRole('listitem')).toHaveLength(2);
    });
    expect(within(breakdown).getByText('Trip A')).toBeInTheDocument();
    expect(within(breakdown).getByText('Trip B')).toBeInTheDocument();
  });

  it('renders an alert when the read fails', async () => {
    const boom = new Error('IndexedDB is gone');
    vi.spyOn(db.persons, 'where').mockImplementation(() => {
      throw boom;
    });

    render(<AllTripsAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText('IndexedDB is gone')).toBeInTheDocument();
  });

  it('renders an alert when the trip list itself failed', async () => {
    mockTripContext({ error: new Error('trips unavailable') });

    render(<AllTripsAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows the empty state when there are no trips', async () => {
    mockTripContext({ trips: [], currentTrip: null });

    render(<AllTripsAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('analytics.emptyTrips')).toBeInTheDocument();
    });
  });
});
