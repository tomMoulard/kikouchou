/**
 * @fileoverview Tests for the driver's departure banner.
 *
 * The contexts are mocked so each case can place one ride against one clock;
 * what is being asserted is the *copy and the recipients*, which is where the
 * requirement actually lives:
 *
 * - only the driver is told, because nobody else can act on it;
 * - a self-driven ride says "leave for CDG", not "leave to pick up passengers";
 * - the wall-clock time is on the card, so it survives a screenshot and a phone
 *   left face-up on a table;
 * - a ride whose leave time cannot be placed is never announced;
 * - the announcement fires once per device, watermarked through `rideNotices`.
 *
 * `t` renders `key(name=value, …)` rather than the bare key, so "the self-driven
 * branch ran" and "it was handed CDG" are two assertions rather than one.
 *
 * @module features/transports/components/__tests__/DriverAlert.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import { DriverAlert } from '../DriverAlert';
import type {
  Person,
  PersonId,
  Ride,
  RideId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

/** The frozen reference instant every fixture is measured from. */
const NOW_MS = Date.UTC(2026, 6, 15, 10, 0, 0);

const MINUTE_MS = 60_000;

/**
 * An instant a given number of minutes from {@link NOW_MS}.
 *
 * @param minutes - Minutes ahead (negative for behind)
 * @returns The UTC ISO instant
 */
function minutesFromNow(minutes: number): string {
  return new Date(NOW_MS + minutes * MINUTE_MS).toISOString();
}

function makePerson(id: string): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name: id,
    color: '#3b82f6' as Person['color'],
  };
}

const GUILLAUME = makePerson('Guillaume'),
  ALICE = makePerson('Alice'),
  TOM = makePerson('Tom');

function makeRide(id: string, meetDatetime: string, overrides: Partial<Ride> = {}): Ride {
  return {
    id: id as RideId,
    tripId: TRIP_ID,
    direction: 'pickup',
    meetDatetime: meetDatetime as Ride['meetDatetime'],
    location: 'Lyon Part-Dieu',
    driverId: GUILLAUME.id,
    ...overrides,
  };
}

function makeLeg(
  id: string,
  personId: PersonId,
  rideId: string,
  datetime: string,
): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP_ID,
    personId,
    type: 'arrival',
    datetime: datetime as Transport['datetime'],
    location: 'Lyon Part-Dieu',
    needsPickup: true,
    rideId: rideId as RideId,
  };
}

// ============================================================================
// Mocks
// ============================================================================

/** Mutable state the mocked contexts read, reset per test. */
const state = vi.hoisted(() => ({
  transports: [] as Transport[],
  rides: [] as Ride[],
  persons: [] as Person[],
  myPersonId: undefined as string | undefined,
  nowMs: 0,
}));

/** Notices already on this device, keyed as `rideNoticeKey` composes them. */
const notices = vi.hoisted(() => ({ fired: new Map<string, unknown>() }));

const markNoticeFired = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ currentTrip: { id: TRIP_ID } }),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => ({
    transports: state.transports,
    nowMs: state.nowMs,
  }),
}));

vi.mock('@/contexts/RideContext', () => ({
  useRideContext: () => ({ rides: state.rides, vehicles: [] }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({ persons: state.persons }),
}));

vi.mock('@/hooks/useTripIdentity', () => ({
  useTripIdentity: () => ({
    myPersonId: state.myPersonId,
    source: 'explicit',
    isResolved: true,
    setMyPersonId: vi.fn(),
  }),
}));

vi.mock('@/lib/db', () => ({
  rideNoticeKey: (kind: string, subjectId: string) => `${kind}:${subjectId}`,
  getRideNotices: vi.fn(async () => notices.fired),
  markNoticeFired: markNoticeFired,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options === undefined) {
        return key;
      }
      if ('count' in options) {
        return `${key}(count=${String(options.count)})`;
      }
      const params = Object.entries(options);
      return params.length === 0
        ? key
        : `${key}(${params.map(([name, value]) => `${name}=${String(value)}`).join(', ')})`;
    },
    i18n: { language: 'en' },
  }),
}));

// ============================================================================
// Tests
// ============================================================================

describe('DriverAlert', () => {
  beforeEach(() => {
    state.transports = [];
    state.rides = [];
    state.persons = [GUILLAUME, ALICE, TOM];
    state.myPersonId = GUILLAUME.id;
    state.nowMs = NOW_MS;
    notices.fired = new Map();
    markNoticeFired.mockClear();
  });

  // No fake clock here, deliberately. The component never reads `Date.now()`:
  // its reference instant arrives from `TransportContext`, which is exactly the
  // property that stops it disagreeing with the transport list. Freezing the
  // system clock would only starve `waitFor` of the timers it polls on.

  /** Seeds one ride carrying one leg. */
  function seedRide(ride: Ride, passengerId: PersonId = ALICE.id): void {
    state.rides = [ride];
    state.transports = [
      makeLeg('leg-1', passengerId, ride.id, ride.meetDatetime),
    ];
  }

  it('renders nothing when this device drives nothing', () => {
    const { container } = render(<DriverAlert />);

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when nobody has said who this device is', () => {
    seedRide(makeRide('r1', minutesFromNow(10)));
    state.myPersonId = undefined;

    const { container } = render(<DriverAlert />);

    expect(container.firstChild).toBeNull();
  });

  it('tells the driver to leave now, and names the passenger', () => {
    seedRide(makeRide('r1', minutesFromNow(10)));

    render(<DriverAlert />);

    expect(
      screen.getByText(/driverAlert\.leaveNowPickup\(.*names=Alice/),
    ).toBeInTheDocument();
  });

  it('says nothing to the passenger of the very same ride', () => {
    seedRide(makeRide('r1', minutesFromNow(10)));
    state.myPersonId = ALICE.id;

    const { container } = render(<DriverAlert />);

    expect(container.firstChild).toBeNull();
  });

  it('drops the pick-up wording when the driver is one of the travellers', () => {
    // Tom and Aurélia taking the hire car to the airport: the driver owns a leg,
    // so there is nobody to pick up — it is "leave for CDG".
    seedRide(
      makeRide('r1', minutesFromNow(10), { direction: 'dropoff', location: 'CDG' }),
      GUILLAUME.id,
    );

    render(<DriverAlert />);

    expect(
      screen.getByText(/driverAlert\.leaveNowSelf\(.*location=CDG/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/driverAlert\.leaveNowDropoff/)).not.toBeInTheDocument();
  });

  it('uses the drop-off wording for a car taking other people away', () => {
    seedRide(makeRide('r1', minutesFromNow(10), { direction: 'dropoff' }));

    render(<DriverAlert />);

    expect(
      screen.getByText(/driverAlert\.leaveNowDropoff\(.*names=Alice/),
    ).toBeInTheDocument();
  });

  it('states the wall-clock leave time, not only a relative phrase', () => {
    // Meeting 40 minutes out with a 30-minute lead: set off in ten minutes.
    seedRide(makeRide('r1', minutesFromNow(40), { leadTimeMinutes: 30 }));

    render(<DriverAlert />);

    const expectedLeaveClock = new Date(NOW_MS + 10 * MINUTE_MS).toLocaleTimeString(
      'en-GB',
      { hour: '2-digit', minute: '2-digit' },
    );

    expect(
      screen.getByText(new RegExp(`rides\\.leaveAt\\(.*${expectedLeaveClock}`)),
    ).toBeInTheDocument();
  });

  it('shows a ride that is still hours away as upcoming, politely', () => {
    seedRide(makeRide('r1', minutesFromNow(180)));

    render(<DriverAlert />);

    expect(screen.getByText(/driverAlert\.upcomingPickup/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces a due ride assertively, so a screen reader interrupts', () => {
    seedRide(makeRide('r1', minutesFromNow(10)));

    render(<DriverAlert />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('says the driver should have left once the meeting time has passed', () => {
    seedRide(makeRide('r1', minutesFromNow(-5)));

    render(<DriverAlert />);

    expect(screen.getByText(/driverAlert\.latePickup/)).toBeInTheDocument();
  });

  it('never announces a ride whose meeting time cannot be placed', () => {
    seedRide(makeRide('r1', 'not-a-datetime'));

    const { container } = render(<DriverAlert />);

    expect(container.firstChild).toBeNull();
  });

  describe('the fire-once watermark', () => {
    it('records a due ride and hands it to the announcement seam', async () => {
      seedRide(makeRide('r1', minutesFromNow(10)));
      const onAnnounce = vi.fn();

      render(<DriverAlert onAnnounce={onAnnounce} />);

      await waitFor(() => {
        expect(markNoticeFired).toHaveBeenCalledWith('trip-1', 'leave', 'r1', NOW_MS);
      });
      expect(onAnnounce).toHaveBeenCalledTimes(1);
      expect(onAnnounce.mock.calls[0]?.[0]).toMatchObject({
        rideId: 'r1',
        status: 'leaveNow',
      });
    });

    it('stays quiet about a ride this device already announced', async () => {
      seedRide(makeRide('r1', minutesFromNow(10)));
      notices.fired.set('leave:r1', { key: 'leave:r1', tripId: 'trip-1' });
      const onAnnounce = vi.fn();

      render(<DriverAlert onAnnounce={onAnnounce} />);

      // The banner still renders — it is a live view of state, not an event —
      // but nothing is announced a second time.
      expect(screen.getByRole('alert')).toBeInTheDocument();
      await waitFor(() => {
        expect(onAnnounce).not.toHaveBeenCalled();
      });
      expect(markNoticeFired).not.toHaveBeenCalled();
    });

    it('does not announce a ride that is merely upcoming', async () => {
      seedRide(makeRide('r1', minutesFromNow(180)));
      const onAnnounce = vi.fn();

      render(<DriverAlert onAnnounce={onAnnounce} />);

      await waitFor(() => {
        expect(screen.getByRole('status')).toBeInTheDocument();
      });
      expect(onAnnounce).not.toHaveBeenCalled();
      expect(markNoticeFired).not.toHaveBeenCalled();
    });

    it('announces again when the car has been moved to a later time', async () => {
      // Fired at 09:30 for a 10:00 meeting; the group then moved the car to
      // 12:00. Keyed on the ride id alone this would stay silent for the life
      // of the trip — the departure the driver was told about is not the one
      // they now have to make.
      seedRide(makeRide('r1', minutesFromNow(130), { leadTimeMinutes: 30 }));
      state.nowMs = NOW_MS + 110 * MINUTE_MS;
      notices.fired.set('leave:r1', {
        key: 'leave:r1',
        tripId: 'trip-1',
        firedAtMs: NOW_MS - 30 * MINUTE_MS,
      });
      const onAnnounce = vi.fn();

      render(<DriverAlert onAnnounce={onAnnounce} />);

      await waitFor(() => {
        expect(onAnnounce).toHaveBeenCalledTimes(1);
      });
    });

    it('stays quiet when the notice cannot be dated', async () => {
      // A row we cannot place is treated as already fired: saying nothing is
      // the safer half of that guess.
      seedRide(makeRide('r1', minutesFromNow(10)));
      notices.fired.set('leave:r1', { key: 'leave:r1', tripId: 'trip-1' });
      const onAnnounce = vi.fn();

      render(<DriverAlert onAnnounce={onAnnounce} />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
      expect(onAnnounce).not.toHaveBeenCalled();
    });

    it('announces once even when the effect runs twice before the write lands', async () => {
      // StrictMode runs every effect twice on the same fiber, with nothing here
      // to cancel the first async run, so both invocations read an empty notice
      // table. The durable watermark cannot close that window on its own.
      seedRide(makeRide('r1', minutesFromNow(10)));
      const onAnnounce = vi.fn();

      render(
        <StrictMode>
          <DriverAlert onAnnounce={onAnnounce} />
        </StrictMode>,
      );

      await waitFor(() => {
        expect(markNoticeFired).toHaveBeenCalled();
      });
      expect(onAnnounce).toHaveBeenCalledTimes(1);
      expect(markNoticeFired).toHaveBeenCalledTimes(1);
    });

    it('watermarks even with no notifier wired to the seam', async () => {
      seedRide(makeRide('r1', minutesFromNow(10)));

      render(<DriverAlert />);

      await waitFor(() => {
        expect(markNoticeFired).toHaveBeenCalledWith('trip-1', 'leave', 'r1', NOW_MS);
      });
    });
  });
});
