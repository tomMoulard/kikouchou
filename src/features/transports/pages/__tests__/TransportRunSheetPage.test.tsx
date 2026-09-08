/**
 * @fileoverview Tests for the run sheet page.
 *
 * The dates here are derived from the moment the test runs, never written out:
 * the page dims past legs and counts only upcoming pickups as needing a
 * driver, so a pinned date turns into a failing test on the day it passes.
 *
 * @module features/transports/pages/__tests__/TransportRunSheetPage.test
 */

import { format } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent } from '@/test/utils';
import type { Person, Transport, Trip } from '@/types';

// ============================================================================
// Fixture dates
// ============================================================================

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A transport datetime `days` from now, at a fixed local wall clock.
 *
 * @param days - Days ahead (negative for the past)
 * @param hours - Local hour of day
 * @param minutes - Local minute
 * @returns An offset-less ISO datetime string
 */
function daysFromNow(days: number, hours: number, minutes = 0): string {
  const date = new Date(Date.now() + days * DAY_MS);
  date.setHours(hours, minutes, 0, 0);
  return format(date, "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * A trip day `days` from now.
 *
 * @param days - Days ahead (negative for the past)
 * @returns A `yyyy-MM-dd` local day
 */
function dayFromNow(days: number): string {
  return format(new Date(Date.now() + days * DAY_MS), 'yyyy-MM-dd');
}

// ============================================================================
// Fixtures
// ============================================================================

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Paris',
  startDate: dayFromNow(1) as Trip['startDate'],
  endDate: dayFromNow(10) as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const alice: Person = {
  id: 'person-alice' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

const bob: Person = {
  id: 'person-bob' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Bob',
  color: '#ef4444' as Person['color'],
};

/** Alice arrives and still has nobody to fetch her. */
const unassignedPickup: Transport = {
  id: 'transport-unassigned' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: alice.id,
  type: 'arrival',
  datetime: daysFromNow(2, 14, 30) as Transport['datetime'],
  location: 'Paris CDG',
  needsPickup: true,
  transportMode: 'plane',
  transportNumber: 'AF1234',
};

/** Bob leaves, and Alice drives him. */
const coveredDeparture: Transport = {
  id: 'transport-covered' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: bob.id,
  driverId: alice.id,
  type: 'departure',
  datetime: daysFromNow(3, 9, 0) as Transport['datetime'],
  location: 'Gare de Lyon',
  needsPickup: true,
};

// ============================================================================
// Mocks
// ============================================================================

const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-1' }),
  };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: vi.fn(),
}));

// The sheet asks the rides whether a pickup is covered. No rides here: every
// case in this file is about legs, and a leg with no car is exactly the one
// the sheet flags.
vi.mock('@/contexts/RideContext', () => ({
  useRideContext: () => ({ rides: [], vehicles: [] }),
}));

vi.mock('@/lib/sharing/guest-identity', () => ({
  getTripGuestPersonId: vi.fn(() => undefined),
}));

vi.mock('@/features/transports/components/TransportDialog', () => ({
  TransportDialog: ({ open }: { readonly open: boolean }) =>
    open ? <div data-testid="transport-dialog" /> : null,
}));

import { TransportRunSheetPage } from '../TransportRunSheetPage';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';
import { getTripGuestPersonId } from '@/lib/sharing/guest-identity';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Points every context at the given transports.
 *
 * `upcomingPickups` mirrors what `TransportContext` publishes: the legs
 * flagged `needsPickup` that are still ahead of the reference instant.
 *
 * @param transports - The trip's transports
 */
function setMocks(transports: readonly Transport[]): void {
  const nowMs = Date.now();

  vi.mocked(useTripContext).mockReturnValue({
    currentTrip: mockTrip,
    trips: [mockTrip],
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
  } as unknown as ReturnType<typeof useTripContext>);

  vi.mocked(usePersonContext).mockReturnValue({
    persons: [alice, bob],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof usePersonContext>);

  vi.mocked(useTransportContext).mockReturnValue({
    transports,
    arrivals: transports.filter((leg) => leg.type === 'arrival'),
    departures: transports.filter((leg) => leg.type === 'departure'),
    upcomingPickups: transports.filter(
      (leg) => leg.needsPickup && new Date(leg.datetime).getTime() >= nowMs,
    ),
    nowMs,
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useTransportContext>);
}

// ============================================================================
// Tests
// ============================================================================

describe('TransportRunSheetPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTripGuestPersonId).mockReturnValue(undefined);
    setMocks([unassignedPickup, coveredDeparture]);
  });

  it('lists every leg of the trip, day by day', () => {
    render(<TransportRunSheetPage />, { withProviders: false, initialRoute: '/trips/trip-1/transports/runsheet' });

    expect(screen.getByRole('button', { name: /Paris CDG/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gare de Lyon/ })).toBeInTheDocument();
    // One heading per day, the legs sitting under the day they happen on.
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
  });

  it('flags the leg that still needs a driver, and only that one', () => {
    render(<TransportRunSheetPage />, { withProviders: false, initialRoute: '/trips/trip-1/transports/runsheet' });

    // Alice has nobody to fetch her; Bob's departure already has a driver.
    expect(screen.getByRole('button', { name: /Paris CDG/ })).toHaveAccessibleName(
      /pickups.needsDriver/,
    );
    expect(
      screen.getByRole('button', { name: /Gare de Lyon/ }),
    ).not.toHaveAccessibleName(/pickups.needsDriver/);
  });

  it('names the driver of a leg that has one', () => {
    render(<TransportRunSheetPage />, { withProviders: false, initialRoute: '/trips/trip-1/transports/runsheet' });

    expect(screen.getByText('transports.driver: Alice')).toBeInTheDocument();
  });

  it('shows only the unassigned pickups when the URL asks for them', () => {
    render(<TransportRunSheetPage />, {
      withProviders: false,
      initialRoute: '/trips/trip-1/transports/runsheet?filter=needsDriver',
    });

    expect(screen.getByRole('button', { name: /Paris CDG/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Gare de Lyon/ }),
    ).not.toBeInTheDocument();
  });

  it('falls back to everything when the filter in the URL is nonsense', () => {
    render(<TransportRunSheetPage />, {
      withProviders: false,
      initialRoute: '/trips/trip-1/transports/runsheet?filter=banana',
    });

    expect(screen.getByRole('button', { name: /Paris CDG/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gare de Lyon/ })).toBeInTheDocument();
  });

  it('offers no "mine" filter when this browser is nobody', () => {
    render(<TransportRunSheetPage />, { withProviders: false, initialRoute: '/trips/trip-1/transports/runsheet' });

    expect(
      screen.queryByRole('radio', { name: /transports.runSheetFilterMine/ }),
    ).not.toBeInTheDocument();
  });

  it('shows the identified guest their own legs under "mine"', () => {
    vi.mocked(getTripGuestPersonId).mockReturnValue(alice.id);

    render(<TransportRunSheetPage />, {
      withProviders: false,
      initialRoute: '/trips/trip-1/transports/runsheet?filter=mine',
    });

    // Alice arrives on one leg and drives the other, so both are hers.
    expect(screen.getByRole('button', { name: /Paris CDG/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gare de Lyon/ })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /transports.runSheetFilterMine/ }),
    ).toBeInTheDocument();
  });

  it('shows everything when a "mine" link is opened by somebody with no identity', () => {
    render(<TransportRunSheetPage />, {
      withProviders: false,
      initialRoute: '/trips/trip-1/transports/runsheet?filter=mine',
    });

    expect(screen.getByRole('button', { name: /Paris CDG/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Gare de Lyon/ })).toBeInTheDocument();
  });

  it('opens a leg so a driver can be filled in', async () => {
    const user = userEvent.setup();
    render(<TransportRunSheetPage />, { withProviders: false, initialRoute: '/trips/trip-1/transports/runsheet' });

    expect(screen.queryByTestId('transport-dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Paris CDG/ }));

    expect(screen.getByTestId('transport-dialog')).toBeInTheDocument();
  });

  it('says every pickup is covered rather than showing an empty sheet', () => {
    setMocks([coveredDeparture]);

    render(<TransportRunSheetPage />, {
      withProviders: false,
      initialRoute: '/trips/trip-1/transports/runsheet?filter=needsDriver',
    });

    expect(screen.getByText('transports.runSheetAllCovered')).toBeInTheDocument();
  });

  it('offers the empty state when the trip has no travel at all', () => {
    setMocks([]);

    render(<TransportRunSheetPage />, { withProviders: false, initialRoute: '/trips/trip-1/transports/runsheet' });

    expect(screen.getByText('transports.runSheetEmpty')).toBeInTheDocument();
  });
});
