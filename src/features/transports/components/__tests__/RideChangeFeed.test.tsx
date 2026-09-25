/**
 * @fileoverview Tests for the moved-travel-time feed.
 *
 * The detection lives in `useRideChanges` and is tested against a real Dexie
 * table there; this file mocks the hook and asks only what the feed *renders* —
 * which times it shows, what it announces, and that nothing is marked read
 * without a tap.
 *
 * Every fixture time goes through {@link localInstant}, so the wall clock the
 * feed prints is the wall clock asserted here whatever timezone the suite runs
 * in. A `…Z` literal would read 17:00 in Paris and 15:00 on CI.
 *
 * @module features/transports/components/__tests__/RideChangeFeed.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hexColor,
  localInstant,
  render,
  screen,
  userEvent,
} from '@/test/utils';
import type { RideChange } from '@/features/transports/hooks/useRideChanges';
import type { ResolvedRide } from '@/features/transports/utils/ride-model';
import type {
  ISODateTimeString,
  Person,
  PersonId,
  RideId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Mocks
// ============================================================================

const mockAcknowledge = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockAcknowledgeAll = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

/** What the mocked hook reports, rewritten per test. */
const feed = vi.hoisted(() => ({
  changes: [] as unknown[],
  isLoading: false,
  unwatchedCount: 0,
}));

vi.mock('@/features/transports/hooks/useRideChanges', () => ({
  useRideChanges: () => ({
    changes: feed.changes,
    isLoading: feed.isLoading,
    unwatchedCount: feed.unwatchedCount,
    acknowledge: mockAcknowledge,
    acknowledgeAll: mockAcknowledgeAll,
  }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { RideChangeFeed } from '../RideChangeFeed';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;
const ALICE = 'person-alice' as PersonId;

/** 17:00 on the user's own clock, however the machine is set. */
const WAS = localInstant('2026-07-15', '17:00');
/** 19:00 on the same clock. */
const NOW = localInstant('2026-07-15', '19:00');

/**
 * Builds a resolved car journey, thin enough for rendering.
 *
 * @param meetDatetime - The rendez-vous
 * @returns The journey
 */
function makeJourney(meetDatetime: ISODateTimeString): ResolvedRide {
  return {
    id: 'ride-a' as RideId,
    ride: undefined,
    direction: 'pickup',
    meetDatetime,
    meetAtMs: new Date(meetDatetime).getTime(),
    location: 'Gare Montparnasse',
    coordinates: undefined,
    leadTimeMinutes: 30,
    leaveAtMs: null,
    driver: undefined,
    driverId: undefined,
    vehicle: undefined,
    legs: [],
    isSelfDriven: false,
    isLegacy: false,
  };
}

/**
 * Builds one feed entry.
 *
 * @param overrides - The parts a test cares about
 * @returns The change
 */
function makeChange(overrides: Partial<RideChange> = {}): RideChange {
  const person: Person = {
    id: ALICE,
    tripId: TRIP_ID,
    name: 'Alice',
    color: hexColor('#3b82f6'),
  };
  const transport: Transport = {
    id: 'leg-alice' as TransportId,
    tripId: TRIP_ID,
    personId: ALICE,
    type: 'arrival',
    datetime: NOW,
    location: 'Gare Montparnasse',
    needsPickup: true,
  };

  return {
    transport,
    person,
    seenDatetime: WAS,
    datetime: NOW,
    movedLater: true,
    journey: makeJourney(WAS),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('RideChangeFeed', () => {
  beforeEach(() => {
    feed.changes = [];
    feed.isLoading = false;
    feed.unwatchedCount = 0;
  });

  // --------------------------------------------------------------------------
  // Loading
  // --------------------------------------------------------------------------

  it('shows nothing while the answer is still loading', () => {
    feed.isLoading = true;
    feed.changes = [makeChange()];
    feed.unwatchedCount = 4;

    render(<RideChangeFeed />, { withProviders: false });

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('mounts the live region before there is anything to announce', () => {
    render(<RideChangeFeed />, { withProviders: false });

    // A region inserted *with* its first entry is not reliably announced, so
    // the one change that arrives on an already-open page would be silent.
    const status = screen.getByTestId('ride-change-announcement');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent('');
  });

  // --------------------------------------------------------------------------
  // Entries
  // --------------------------------------------------------------------------

  describe('with a change', () => {
    beforeEach(() => {
      feed.changes = [makeChange()];
    });

    it('shows the guest, both times and the car affected', () => {
      render(<RideChangeFeed />, { withProviders: false });

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText(/17:00/)).toBeInTheDocument();
      expect(screen.getByText(/19:00/)).toBeInTheDocument();
      expect(screen.getAllByText(/Gare Montparnasse/).length).toBeGreaterThan(0);
      expect(screen.getByText('rideChanges.movedLater')).toBeInTheDocument();
    });

    it('announces the change in the live region', () => {
      render(<RideChangeFeed />, { withProviders: false });

      expect(screen.getByTestId('ride-change-announcement')).toHaveTextContent(
        'rideChanges.announce',
      );
    });

    it('acknowledges only the leg whose button was pressed', async () => {
      const user = userEvent.setup();
      render(<RideChangeFeed />, { withProviders: false });

      await user.click(
        screen.getByRole('button', { name: 'rideChanges.acknowledge' }),
      );

      expect(mockAcknowledge).toHaveBeenCalledWith('leg-alice');
      expect(mockAcknowledgeAll).not.toHaveBeenCalled();
    });

    it('offers no bulk acknowledgement for a single entry', () => {
      render(<RideChangeFeed />, { withProviders: false });

      expect(
        screen.queryByRole('button', { name: 'rideChanges.acknowledgeAll' }),
      ).not.toBeInTheDocument();
    });

    it('names a guest the trip no longer holds rather than dropping the entry', () => {
      feed.changes = [makeChange({ person: undefined })];

      render(<RideChangeFeed />, { withProviders: false });

      expect(screen.getByText('rideChanges.unknownGuest')).toBeInTheDocument();
      expect(screen.getByText(/19:00/)).toBeInTheDocument();
    });

    it('says a leg moved earlier when it did', () => {
      feed.changes = [
        makeChange({ seenDatetime: NOW, datetime: WAS, movedLater: false }),
      ];

      render(<RideChangeFeed />, { withProviders: false });

      expect(screen.getByText('rideChanges.movedEarlier')).toBeInTheDocument();
    });
  });

  describe('with several changes', () => {
    beforeEach(() => {
      feed.changes = [
        makeChange(),
        makeChange({
          transport: {
            ...makeChange().transport,
            id: 'leg-chloe' as TransportId,
          },
        }),
      ];
    });

    it('offers one tap to clear them all', async () => {
      const user = userEvent.setup();
      render(<RideChangeFeed />, { withProviders: false });

      await user.click(
        screen.getByRole('button', { name: 'rideChanges.acknowledgeAll' }),
      );

      expect(mockAcknowledgeAll).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // The first watermark
  // --------------------------------------------------------------------------

  describe('when nothing has moved', () => {
    it('offers to start watching the legs this device has never recorded', async () => {
      feed.unwatchedCount = 3;
      const user = userEvent.setup();

      render(<RideChangeFeed />, { withProviders: false });

      expect(screen.getByText('rideChanges.watchHint')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /rideChanges.watch/ }));

      expect(mockAcknowledgeAll).toHaveBeenCalledTimes(1);
    });

    it('shows nothing once every leg is watched', () => {
      const { container } = render(<RideChangeFeed />, { withProviders: false });

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(container.textContent).toBe('');
    });
  });
});
