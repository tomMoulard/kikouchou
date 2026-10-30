/**
 * @fileoverview Tests for the "Your rides" panel.
 *
 * @module features/transports/components/__tests__/MyRides.test
 */

import { format } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
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
 * @returns An offset-less ISO datetime string
 */
function daysFromNow(days: number, hours: number): string {
  const date = new Date(Date.now() + days * DAY_MS);
  date.setHours(hours, 0, 0, 0);
  return format(date, "yyyy-MM-dd'T'HH:mm:ss");
}

// ============================================================================
// Fixtures
// ============================================================================

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Paris',
  startDate: format(new Date(), 'yyyy-MM-dd') as Trip['startDate'],
  endDate: format(new Date(Date.now() + 10 * DAY_MS), 'yyyy-MM-dd') as Trip['endDate'],
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

/** Bob arrives and Alice fetches him. */
const aliceDrivesBob: Transport = {
  id: 'transport-drive' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: bob.id,
  driverId: alice.id,
  type: 'arrival',
  datetime: daysFromNow(2, 14) as Transport['datetime'],
  location: 'Paris CDG',
  needsPickup: true,
};

/** Alice's own way home. */
const aliceLeaves: Transport = {
  id: 'transport-leave' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: alice.id,
  type: 'departure',
  datetime: daysFromNow(4, 9) as Transport['datetime'],
  location: 'Gare de Lyon',
  needsPickup: false,
};

/** A ride Alice drove yesterday. */
const pastRide: Transport = {
  id: 'transport-past' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: bob.id,
  driverId: alice.id,
  type: 'arrival',
  datetime: daysFromNow(-2, 10) as Transport['datetime'],
  location: 'Orly',
  needsPickup: true,
};

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: vi.fn(),
}));

vi.mock('@/lib/sharing/guest-identity', () => ({
  getTripGuestPersonId: vi.fn(() => undefined),
}));

import { MyRides } from '../MyRides';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';
import { getTripGuestPersonId } from '@/lib/sharing/guest-identity';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Points the contexts at a set of transports.
 *
 * @param transports - The trip's transports
 */
function setMocks(transports: readonly Transport[]): void {
  vi.mocked(useTripContext).mockReturnValue({
    currentTrip: mockTrip,
    trips: [mockTrip],
    isLoading: false,
    error: null,
    setCurrentTrip: vi.fn(),
  } as unknown as ReturnType<typeof useTripContext>);

  vi.mocked(usePersonContext).mockReturnValue({
    persons: [alice, bob],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof usePersonContext>);

  vi.mocked(useTransportContext).mockReturnValue({
    transports,
    nowMs: Date.now(),
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useTransportContext>);
}

// ============================================================================
// Tests
// ============================================================================

describe('MyRides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTripGuestPersonId).mockReturnValue(undefined);
    setMocks([aliceDrivesBob, aliceLeaves, pastRide]);
  });

  it('shows nothing to a browser that is nobody', () => {
    const { container } = render(<MyRides />, { withProviders: false });

    expect(container).toBeEmptyDOMElement();
  });

  it('separates the rides the guest drives from their own travel', () => {
    vi.mocked(getTripGuestPersonId).mockReturnValue(alice.id);

    render(<MyRides />, { withProviders: false });

    expect(screen.getByText('transports.myRidesDriving')).toBeInTheDocument();
    expect(screen.getByText('transports.myRidesTravel')).toBeInTheDocument();
    expect(screen.getByText('Paris CDG')).toBeInTheDocument();
    expect(screen.getByText('Gare de Lyon')).toBeInTheDocument();
  });

  it('leaves out a ride that has already happened', () => {
    vi.mocked(getTripGuestPersonId).mockReturnValue(alice.id);

    render(<MyRides />, { withProviders: false });

    expect(screen.queryByText('Orly')).not.toBeInTheDocument();
  });

  it('leaves out the legs of other guests', () => {
    vi.mocked(getTripGuestPersonId).mockReturnValue(bob.id);

    render(<MyRides />, { withProviders: false });

    // Bob travels on the arrival Alice drives, and on nothing else.
    expect(screen.getByText('Paris CDG')).toBeInTheDocument();
    expect(screen.queryByText('Gare de Lyon')).not.toBeInTheDocument();
    expect(screen.queryByText('transports.myRidesDriving')).not.toBeInTheDocument();
  });

  it('says so plainly when the guest has nothing ahead', () => {
    vi.mocked(getTripGuestPersonId).mockReturnValue(alice.id);
    setMocks([pastRide]);

    render(<MyRides />, { withProviders: false });

    expect(screen.getByText('transports.myRidesEmpty')).toBeInTheDocument();
  });
});
