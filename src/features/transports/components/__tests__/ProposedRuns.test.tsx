/**
 * @fileoverview Tests for the runs the app proposes and the two ways to accept.
 *
 * What matters here is what reaches the database, because that is what the
 * whole panel exists to spare the user from typing: one car per proposal, the
 * passengers pointed at it afterwards, and — when the guest on this device
 * says "I'll drive" — their own name in the driver's seat without a dropdown
 * ever appearing.
 *
 * @module features/transports/components/__tests__/ProposedRuns.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent, waitFor } from '@/test/utils';
import { DEFAULT_LEAD_TIME_MINUTES } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

/** The stored instant of a local wall clock, in July 2126 — always ahead. */
function at(day: number, hours: number, minutes = 0): string {
  return new Date(2126, 6, day, hours, minutes, 0, 0).toISOString();
}

const ALICE = { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444' };
const BOB = { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6' };
const TOM = { id: 'p3', tripId: 'trip-1', name: 'Tom', color: '#22c55e' };

function pickup(id: string, personId: string, hours: number) {
  return {
    id,
    tripId: 'trip-1',
    personId,
    type: 'arrival',
    datetime: at(15, hours),
    location: 'Lyon Part-Dieu',
    needsPickup: true,
  };
}

// ============================================================================
// Mocks
// ============================================================================

const rideContext = {
  rides: [] as unknown[],
  vehicles: [] as unknown[],
  createRide: vi.fn(),
  updateRide: vi.fn(),
  setTransportRide: vi.fn(),
};

const transportContext = {
  upcomingPickups: [] as unknown[],
  nowMs: Date.now(),
};

const personContext = { persons: [ALICE, BOB, TOM] };

/** Which guest this browser is; undefined means nobody in particular. */
let myPersonId: string | undefined;

vi.mock('@/contexts/RideContext', () => ({
  useRideContext: () => rideContext,
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => transportContext,
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => personContext,
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: vi.fn() }),
  useTripIdentity: () => ({
    myPersonId,
    source: undefined,
    isResolved: true,
    setMyPersonId: vi.fn(),
  }),
}));

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

import { ProposedRuns } from '../ProposedRuns';

// ============================================================================
// Tests
// ============================================================================

describe('ProposedRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rideContext.rides = [];
    rideContext.createRide.mockResolvedValue({ id: 'ride-new' });
    rideContext.setTransportRide.mockResolvedValue(undefined);
    rideContext.updateRide.mockResolvedValue(undefined);
    transportContext.upcomingPickups = [];
    myPersonId = undefined;
  });

  it('says nothing when every leg already has a driver', () => {
    render(<ProposedRuns />, { withProviders: false });

    expect(screen.queryByText('proposedRuns.title')).not.toBeInTheDocument();
  });

  it('proposes one car for two guests landing at the same station', () => {
    transportContext.upcomingPickups = [pickup('t1', 'p1', 17), pickup('t2', 'p2', 17)];
    myPersonId = undefined;

    render(<ProposedRuns />, { withProviders: false });

    expect(screen.getByText('proposedRuns.title')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(1);
    // Both travellers are named on the card, because it is read by whoever is
    // deciding whether to drive. The seat count is a `count` interpolation,
    // which the test i18n stub drops, so it is pinned in `proposed-runs.test`
    // where the arithmetic lives.
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('arranges the car and moves the passengers into it on Confirm', async () => {
    transportContext.upcomingPickups = [pickup('t1', 'p1', 17), pickup('t2', 'p2', 17)];

    render(<ProposedRuns />, { withProviders: false });
    await userEvent.setup().click(screen.getByRole('button', { name: 'proposedRuns.confirm' }));

    await waitFor(() => {
      expect(rideContext.createRide).toHaveBeenCalledWith({
        direction: 'pickup',
        meetDatetime: at(15, 17),
        location: 'Lyon Part-Dieu',
        leadTimeMinutes: DEFAULT_LEAD_TIME_MINUTES,
      });
    });
    // The driver's seat is left open: confirming is the host saying the
    // journey is real, not that they are driving it.
    expect(rideContext.createRide.mock.calls[0]?.[0]).not.toHaveProperty('driverId');
    expect(rideContext.setTransportRide).toHaveBeenCalledWith('t1', 'ride-new');
    expect(rideContext.setTransportRide).toHaveBeenCalledWith('t2', 'ride-new');
  });

  it('puts the guest on this device in the driver seat on "I\'ll drive"', async () => {
    transportContext.upcomingPickups = [pickup('t1', 'p1', 17)];
    myPersonId = 'p3';

    render(<ProposedRuns />, { withProviders: false });
    await userEvent.setup().click(screen.getByRole('button', { name: 'proposedRuns.claim' }));

    await waitFor(() => {
      expect(rideContext.createRide).toHaveBeenCalledWith(
        expect.objectContaining({ driverId: 'p3' }),
      );
    });
  });

  it('offers no claim to a browser that is nobody in particular', () => {
    transportContext.upcomingPickups = [pickup('t1', 'p1', 17)];
    myPersonId = undefined;

    render(<ProposedRuns />, { withProviders: false });

    expect(
      screen.queryByRole('button', { name: 'proposedRuns.claim' }),
    ).not.toBeInTheDocument();
    // Confirm is still there: the host's answer needs no identity.
    expect(screen.getByRole('button', { name: 'proposedRuns.confirm' })).toBeInTheDocument();
  });

  it('accepts every proposal in one press', async () => {
    transportContext.upcomingPickups = [
      pickup('t1', 'p1', 17),
      { ...pickup('t2', 'p2', 21), location: 'Airport T2' },
    ];

    render(<ProposedRuns />, { withProviders: false });
    await userEvent.setup().click(screen.getByRole('button', { name: 'proposedRuns.confirmAll' }));

    await waitFor(() => {
      expect(rideContext.createRide).toHaveBeenCalledTimes(2);
    });
  });

  it('fills the car these legs already sit in rather than building a rival', async () => {
    rideContext.rides = [
      {
        id: 'ride-1',
        tripId: 'trip-1',
        direction: 'pickup',
        meetDatetime: at(15, 17),
        location: 'Lyon Part-Dieu',
      },
    ];
    transportContext.upcomingPickups = [
      { ...pickup('t1', 'p1', 17), rideId: 'ride-1' },
      pickup('t2', 'p2', 17),
    ];
    myPersonId = 'p3';

    render(<ProposedRuns />, { withProviders: false });
    await userEvent.setup().click(screen.getByRole('button', { name: 'proposedRuns.claim' }));

    await waitFor(() => {
      expect(rideContext.updateRide).toHaveBeenCalledWith('ride-1', { driverId: 'p3' });
    });
    expect(rideContext.createRide).not.toHaveBeenCalled();
    // Only the leg that was outside the car is moved into it.
    expect(rideContext.setTransportRide).toHaveBeenCalledExactlyOnceWith('t2', 'ride-1');
  });
});
