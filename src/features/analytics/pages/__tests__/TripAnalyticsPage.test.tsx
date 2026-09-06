/**
 * @fileoverview Tests for TripAnalyticsPage.
 * @module features/analytics/pages/__tests__/TripAnalyticsPage.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/utils';
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
  return { id, tripId, name: id, color: '#3b82f6', ...(headcount === undefined ? {} : { headcount }) } as unknown as Person;
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
  rideId?: string,
): Transport {
  return {
    id,
    tripId,
    personId: 'p1',
    type,
    datetime: '2026-07-02T14:00:00.000Z',
    location: 'Gare du Nord',
    needsPickup: false,
    ...(rideId === undefined ? {} : { rideId }),
  } as unknown as Transport;
}

// ============================================================================
// Mocks
// ============================================================================

const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);
const mockCheckConnection = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-a' }),
  };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(),
}));

import { TripAnalyticsPage } from '../TripAnalyticsPage';
import { useTripContext } from '@/contexts/TripContext';

// ============================================================================
// Helpers
// ============================================================================

function mockTripContext(overrides: Partial<ReturnType<typeof useTripContext>> = {}): void {
  vi.mocked(useTripContext).mockReturnValue({
    trips: [TRIP_A_ROW, TRIP_B_ROW],
    currentTrip: TRIP_A_ROW,
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
    checkConnection: mockCheckConnection,
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

describe('TripAnalyticsPage', () => {
  beforeEach(() => {
    // `restoreAllMocks` and not just `clearAllMocks`: one test spies on
    // `db.persons.where` to force a failure, and a leaked spy made every later
    // test render the error state instead of what it was asserting.
    vi.restoreAllMocks();
    mockSetCurrentTrip.mockResolvedValue(undefined);
    mockCheckConnection.mockResolvedValue(undefined);
    mockTripContext();
  });

  it('counts people rather than guest rows', async () => {
    await db.persons.bulkPut([
      person('p1', TRIP_A, 2),
      person('p2', TRIP_A, 3),
      person('p3', TRIP_A),
    ]);

    render(<TripAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(statValue('analytics.people')).toBe('6');
    });
  });

  it('reports the trip in the URL even while another trip is current', async () => {
    // The contexts lag the URL during a trip switch; this page must not.
    mockTripContext({ currentTrip: TRIP_B_ROW });
    await db.persons.bulkPut([person('p1', TRIP_A, 4)]);
    await db.persons.bulkPut([person('p9', TRIP_B, 99)]);

    render(<TripAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(statValue('analytics.people')).toBe('4');
    });
  });

  it('shows one transport-leg total that equals arrivals plus departures', async () => {
    await db.persons.bulkPut([person('p1', TRIP_A, 1)]);
    await db.transports.bulkPut([
      transport('t1', TRIP_A, 'arrival'),
      transport('t2', TRIP_A, 'arrival'),
      transport('t3', TRIP_A, 'departure'),
    ]);

    render(<TripAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(statValue('analytics.transports')).toBe('3');
    });
  });

  it('counts a shared car once, beside the legs it serves', async () => {
    // Guillaume's Espace meets two trains. One ride, one car, two legs — the
    // three figures the page must keep apart, since a reader who added them
    // would see three journeys where there is one car.
    await db.vehicles.bulkPut([vehicle('v1', TRIP_A)]);
    await db.rides.bulkPut([ride('ride-1', TRIP_A)]);
    await db.transports.bulkPut([
      transport('t1', TRIP_A, 'arrival', 'ride-1'),
      transport('t2', TRIP_A, 'arrival', 'ride-1'),
    ]);

    render(<TripAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(statValue('analytics.rides')).toBe('1');
    });
    expect(statValue('analytics.vehicles')).toBe('1');
    expect(statValue('analytics.transports')).toBe('2');
  });

  it('does not call a trip empty when it holds only a car', async () => {
    await db.vehicles.bulkPut([vehicle('v1', TRIP_A)]);

    render(<TripAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(statValue('analytics.vehicles')).toBe('1');
    });
    expect(screen.queryByText('analytics.emptyTrip')).not.toBeInTheDocument();
  });

  it('shows an empty state rather than a wall of zeros', async () => {
    render(<TripAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('analytics.emptyTrip')).toBeInTheDocument();
    });
    expect(screen.queryByText('analytics.people')).not.toBeInTheDocument();
  });

  it('renders an alert when the read fails', async () => {
    await db.rooms.bulkPut([room('r1', TRIP_A, 0)]);
    const boom = new Error('IndexedDB is gone');
    vi.spyOn(db.persons, 'where').mockImplementation(() => {
      throw boom;
    });

    render(<TripAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText('IndexedDB is gone')).toBeInTheDocument();
  });

  it('renders an alert when the trip list itself failed', async () => {
    mockTripContext({ error: new Error('trips unavailable') });

    render(<TripAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('reports a trip that is not on this device as not found', async () => {
    mockTripContext({ trips: [TRIP_B_ROW], currentTrip: TRIP_B_ROW });

    render(<TripAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
    });
  });

  it('shows not found, not a load failure, for a mistyped trip id', async () => {
    // `setCurrentTrip` rejects with `Trip with ID "…" not found` for an id that
    // is not on this device, and the context keeps that as its error. Reporting
    // it as "failed to load", with a Retry that can never succeed, is the wrong
    // answer to a bad URL.
    mockTripContext({
      trips: [TRIP_B_ROW],
      currentTrip: TRIP_B_ROW,
      error: new Error('Trip with ID "trip-a" not found'),
    });

    render(<TripAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retry also clears the sticky trip-context error', async () => {
    mockTripContext({ error: new Error('trips unavailable') });

    const { user } = render(<TripAnalyticsPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /common.retry/i }));

    expect(mockCheckConnection).toHaveBeenCalled();
  });
});
