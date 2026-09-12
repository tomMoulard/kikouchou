/**
 * @fileoverview Tests for the printable trip summary page.
 * @module features/summary/pages/__tests__/TripSummaryPage.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent, waitFor } from '@/test/utils';
import { db } from '@/lib/db/database';
import type { Person, Room, Transport, Trip, TripId } from '@/types';

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
    location: 'Brittany',
    startDate: '2026-07-01',
    endDate: '2026-07-10',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as unknown as Trip;
}

const TRIP_A_ROW = trip(TRIP_A, 'Trip A');
const TRIP_B_ROW = trip(TRIP_B, 'Trip B');

function person(id: string, tripId: TripId, name: string): Person {
  return { id, tripId, name, color: '#3b82f6' } as unknown as Person;
}

function room(id: string, tripId: TripId, name: string): Room {
  return { id, tripId, name, capacity: 2, order: 0 } as unknown as Room;
}

function transport(id: string, tripId: TripId): Transport {
  return {
    id,
    tripId,
    personId: 'p1',
    type: 'arrival',
    datetime: new Date('2026-07-02T14:00').toISOString(),
    location: 'Gare du Nord',
    needsPickup: true,
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

import { TripSummaryPage } from '../TripSummaryPage';
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
    setCurrentTrip: mockSetCurrentTrip,
    checkConnection: mockCheckConnection,
    ...overrides,
  } as ReturnType<typeof useTripContext>);
}

// ============================================================================
// Tests
// ============================================================================

describe('TripSummaryPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSetCurrentTrip.mockResolvedValue(undefined);
    mockCheckConnection.mockResolvedValue(undefined);
    mockTripContext();
  });

  it('prints the trip named in the URL, rooms, travel and guests', async () => {
    await db.trips.bulkPut([TRIP_A_ROW, TRIP_B_ROW]);
    await db.persons.put(person('p1', TRIP_A, 'Marie'));
    await db.rooms.put(room('r1', TRIP_A, 'Master bedroom'));
    await db.transports.put(transport('t1', TRIP_A));

    render(<TripSummaryPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('Trip A')).toBeInTheDocument();
    });
    expect(screen.getByText('Master bedroom')).toBeInTheDocument();
    expect(screen.getByText('Gare du Nord')).toBeInTheDocument();
    // The pickup has nobody driving, and the sheet has to say so.
    expect(screen.getByText('summary.driverMissing')).toBeInTheDocument();
  });

  it('describes the trip in the URL even while another trip is current', async () => {
    // The trip contexts lag the URL during a switch. Paper cannot be corrected.
    mockTripContext({ currentTrip: TRIP_B_ROW });
    await db.trips.bulkPut([TRIP_A_ROW, TRIP_B_ROW]);
    await db.rooms.bulkPut([
      room('r1', TRIP_A, 'Master bedroom'),
      room('r9', TRIP_B, 'Other trip room'),
    ]);

    render(<TripSummaryPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('Master bedroom')).toBeInTheDocument();
    });
    expect(screen.queryByText('Other trip room')).not.toBeInTheDocument();
  });

  it('hands the sheet to the browser print dialog', async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    vi.stubGlobal('print', print);
    await db.trips.put(TRIP_A_ROW);

    render(<TripSummaryPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('summary.print')).toBeInTheDocument();
    });
    await user.click(screen.getByText('summary.print'));

    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('offers the sheet even when nothing has been filled in yet', async () => {
    // An empty trip is exactly when somebody wants the checklist on the wall.
    await db.trips.put(TRIP_A_ROW);

    render(<TripSummaryPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('summary.noRooms')).toBeInTheDocument();
    });
    expect(screen.getByText('summary.noTravel')).toBeInTheDocument();
    expect(screen.getByText('summary.noGuests')).toBeInTheDocument();
  });

  it('answers a trip this device does not have with a not-found state', async () => {
    render(<TripSummaryPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
    });
  });

  it('renders an in-page alert when the read fails', async () => {
    await db.trips.put(TRIP_A_ROW);
    vi.spyOn(db.persons, 'where').mockImplementation(() => {
      throw new Error('IndexedDB is gone');
    });

    render(<TripSummaryPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('IndexedDB is gone')).toBeInTheDocument();
    });
  });
});
