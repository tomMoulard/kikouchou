/**
 * @fileoverview Tests for the unassigned-pickup alert panel.
 *
 * Two things this file is careful about:
 *
 * - **Time is frozen and timezone-free.** The panel's whole job is to say how
 *   urgent a pickup is — overdue, today, tomorrow, later — so every fixture is
 *   built from a *local* wall clock via {@link at}. A literal `…Z` string means
 *   a different day in Kiritimati (UTC+14) than in Midway (UTC-11), which would
 *   silently move a fixture between urgency branches depending on where the
 *   suite runs.
 * - **`t` shows its interpolation.** The mock renders `key(name=value, …)`
 *   instead of the bare key, so "the tomorrow branch ran" and "it was handed
 *   14:00" are two different assertions rather than one.
 *
 * @module features/transports/components/__tests__/UpcomingPickups.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpcomingPickups } from '../UpcomingPickups';
import { DEFAULT_LEAD_TIME_MINUTES } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

/**
 * The stored instant of a local wall clock, the way `TransportForm` writes one.
 *
 * Pinning the wall clock rather than the UTC string is what keeps the urgency
 * branches ("is this tomorrow?") stable in every timezone.
 *
 * @param year - Full year
 * @param month - 1-based month
 * @param day - Day of month
 * @param hours - Local hour
 * @param minutes - Local minute
 * @returns The ISO instant
 */
function at(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes = 0,
): string {
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

/** Mutable i18n state the mocked `useTranslation` reads, per test. */
const i18nState = vi.hoisted(() => ({ language: 'en' }));

/**
 * The mocked ride context for the current test.
 *
 * Rebuilt by `beforeEach` rather than declared once: the writes are what the
 * arrangement tests assert on, and a shared `vi.fn()` would carry one test's
 * calls into the next. A test that needs existing cars assigns `rides` before
 * rendering.
 */
let rideContext: {
  rides: unknown[];
  createRide: ReturnType<typeof vi.fn>;
  updateRide: ReturnType<typeof vi.fn>;
  setTransportRide: ReturnType<typeof vi.fn>;
};

/**
 * One pickup, with only the fields this panel reads spelled out.
 *
 * @param id - Transport id
 * @param overrides - Fields to set on top of an arrival at Station A
 * @returns The transport, loosely typed for the mocked context
 */
function pickup(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    tripId: 'trip-1',
    personId: 'p1',
    type: 'arrival',
    datetime: at(2126, 7, 15, 14),
    location: 'Station A',
    needsPickup: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/**
 * Publishes a set of upcoming pickups through the mocked transport context.
 *
 * @param pickups - The pickups the panel should see
 * @returns The context's `updateTransport`, so a test can prove it stayed unused
 */
async function mockUpcomingPickups(
  pickups: readonly Record<string, unknown>[],
): Promise<ReturnType<typeof vi.fn>> {
  const { useTransportContext } = await import('@/contexts/TransportContext'),
    updateTransport = vi.fn();

  vi.mocked(useTransportContext).mockReturnValue({
    upcomingPickups: pickups as never,
    nowMs: Date.now(),
    updateTransport,
    arrivals: [],
    departures: [],
    transports: [],
    createTransport: vi.fn(),
    deleteTransport: vi.fn(),
  } as never);

  return updateTransport;
}

/**
 * Publishes Alice (travelling) and Bob (available to drive).
 */
async function mockAliceAndBob(): Promise<void> {
  const { usePersonContext } = await import('@/contexts/PersonContext');

  vi.mocked(usePersonContext).mockReturnValue({
    persons: [
      { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444' },
      { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6' },
    ] as never,
    createPerson: vi.fn(),
    updatePerson: vi.fn(),
    deletePerson: vi.fn(),
    reorderPersons: vi.fn(),
  } as never);
}

/**
 * Installs a spy as the offline-aware success toast.
 *
 * @returns The spy the panel will call
 */
async function mockSuccessToast(): Promise<ReturnType<typeof vi.fn>> {
  const { useOfflineAwareToast } = await import('@/hooks'),
    successToast = vi.fn();

  vi.mocked(useOfflineAwareToast).mockReturnValue({ successToast } as never);

  return successToast;
}

/**
 * The DOM APIs Radix's `Select` calls but jsdom does not implement. Without
 * them the driver picker throws the moment it opens, which is why the
 * assignment tests used to stop at "the confirm button is disabled".
 */
function installSelectPolyfills(): void {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
}

installSelectPolyfills();

/**
 * Picks a driver in the open dialog's `Select` by its visible name.
 *
 * Driven from the keyboard: Radix opens the listbox on Enter and commits the
 * highlighted option on Enter, which needs none of the pointer geometry jsdom
 * lacks.
 *
 * @param user - The userEvent instance
 * @param name - The driver's name as shown in the option
 */
async function chooseDriver(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: 'pickups.selectDriver' }));
  const option = await screen.findByRole('option', { name });
  await user.click(option);
}

// Mock contexts
vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: vi.fn(() => ({
    upcomingPickups: [],
    updateTransport: vi.fn(),
  })),
}));

// The panel asks the rides too: a leg sitting in a car somebody volunteered
// for is not unassigned, even though the leg carries no `driverId`. The value
// is rebuilt per test by `beforeEach` below, so a case that arranges a car
// never leaks its call history — or its rides — into the next one.
vi.mock('@/contexts/RideContext', () => ({
  useRideContext: vi.fn(() => ({ rides: [] })),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(() => ({
    persons: [],
  })),
}));

vi.mock('@/hooks', () => ({
  useFormSubmission: vi.fn(() => ({
    isSubmitting: false,
    submitError: undefined,
    handleSubmit: vi.fn(),
    clearError: vi.fn(),
  })),
  useOfflineAwareToast: vi.fn(() => ({
    successToast: vi.fn(),
  })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    /**
     * Renders `key(name=value, …)` for an interpolated call rather than the
     * bare key. Without the values a test can only prove which branch ran, not
     * that the branch was handed the right time or station.
     */
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      if (typeof fallback === 'object' && fallback !== null) {
        if ('count' in fallback) {
          return `${fallback.count}`;
        }
        const params = Object.entries(fallback).filter(
          ([name]) => name !== 'defaultValue',
        );
        if (params.length > 0) {
          return `${key}(${params.map(([name, value]) => `${name}=${String(value)}`).join(', ')})`;
        }
      }
      return key;
    },
    i18n: {
      get language() {
        return i18nState.language;
      },
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('UpcomingPickups', () => {
  beforeEach(async () => {
    i18nState.language = 'en';
    vi.useFakeTimers();
    // 10:00 on 15 July 2026 *where the test runs* — see `at` above
    vi.setSystemTime(new Date(at(2026, 7, 15, 10)));

    const { useRideContext } = await import('@/contexts/RideContext');
    rideContext = {
      rides: [],
      createRide: vi.fn().mockResolvedValue({ id: 'ride-new' }),
      updateRide: vi.fn().mockResolvedValue(undefined),
      setTransportRide: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(useRideContext).mockReturnValue(rideContext as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when no pickups need a ride', () => {
    const { container } = render(<UpcomingPickups />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when pickups exist but all have drivers', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [
        {
          id: 't1',
          tripId: 'trip-1',
          personId: 'p1',
          type: 'arrival',
          datetime: at(2026, 7, 15, 14),
          location: 'Station A',
          mode: 'train',
          transportNumber: '',
          needsPickup: true,
          driverId: 'driver-1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    const { container } = render(<UpcomingPickups />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('pickups.allCovered')).not.toBeInTheDocument();
  });

  it('renders pickup cards for unassigned pickups', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
        order: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: at(2026, 7, 15, 14),
        location: 'Station A',
        mode: 'train',
        transportNumber: 'TGV 1234',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    // Should show the "needs driver" header (may appear in multiple places)
    const headers = screen.getAllByText('pickups.needsDriver');
    expect(headers.length).toBeGreaterThanOrEqual(1);
    // Should show the volunteer button
    expect(screen.getByText('pickups.volunteerDrive')).toBeInTheDocument();
    // Should show transport number
    expect(screen.getByText('TGV 1234')).toBeInTheDocument();
    // Should show station
    expect(screen.getByText('Station A')).toBeInTheDocument();
    // A pickup later today reads as a distance, not a clock time: it is 10:00
    // and the train is at 14:00
    expect(screen.getByText('in about 4 hours')).toBeInTheDocument();
    expect(screen.getByText('transports.arrival')).toBeInTheDocument();
  });

  it('renders departure type pickups', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Bob',
        color: '#3b82f6',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't2',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'departure',
        datetime: at(2026, 7, 16, 8),
        location: 'Airport',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    expect(screen.getByText('Airport')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders pickup without transport number', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't3',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: at(2026, 7, 15, 14),
        location: 'Bus Stop',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    expect(screen.getByText('Bus Stop')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders unknown person when person is not found', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't4',
        tripId: 'trip-1',
        personId: 'nonexistent',
        type: 'arrival',
        datetime: at(2026, 7, 15, 14),
        location: 'Station X',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    expect(screen.getByText('Station X')).toBeInTheDocument();
  });

  it('opens driver dialog when volunteer button is clicked', async () => {
    // Use real timers for this test — radix Dialog relies on real requestAnimationFrame
    vi.useRealTimers();

    const user = userEvent.setup();
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [
        { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444' },
        { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6' },
      ] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: at(2126, 7, 15, 14),
        location: 'Station A',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    // Click volunteer button
    const volunteerBtn = screen.getByText('pickups.volunteerDrive');
    await user.click(volunteerBtn);

    // Driver dialog should open — title + aria-label both use this key
    await waitFor(() => {
      expect(screen.getAllByText('pickups.selectDriver').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders grouped pickups at the same station', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [
        { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444' },
        { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6' },
      ] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [
        {
          id: 't1',
          tripId: 'trip-1',
          personId: 'p1',
          type: 'arrival',
          datetime: at(2026, 7, 15, 14),
          location: 'Station A',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 't2',
          tripId: 'trip-1',
          personId: 'p2',
          type: 'arrival',
          datetime: at(2026, 7, 15, 14, 30),
          location: 'Station A',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    // Both pickups should render
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    // Combined trip badge should appear for grouped pickups
    expect(screen.getByText('pickups.combinedTrip')).toBeInTheDocument();
  });

  it('applies custom className', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: at(2026, 7, 15, 14),
        location: 'Station A',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    const { container } = render(<UpcomingPickups className="custom-test" />);
    expect(container.querySelector('.custom-test')).toBeInTheDocument();
  });

  /**
   * The panel no longer re-decides what counts as upcoming: `TransportContext`
   * owns that against one reference instant it refreshes each minute. So a
   * pickup that has just fallen due stays on screen, flagged as overdue, until
   * that tick drops it — instead of vanishing from this panel alone at the very
   * moment somebody needs to drive, while the analytics badge still counted it.
   */
  it('keeps a pickup the context still lists, flagged as overdue', async () => {
    // Set time to after the pickup, as if the minute tick had not landed yet
    vi.setSystemTime(new Date(at(2026, 7, 16, 10)));

    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't5',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: at(2026, 7, 15, 14),
        location: 'Station Late',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    expect(screen.getByText('Station Late')).toBeInTheDocument();
    expect(screen.getAllByText('pickups.overdue').length).toBeGreaterThan(0);
  });

  it('keeps confirm disabled until a driver is picked', async () => {
    // Real timers: Radix's dialog and select rely on real rAF
    vi.useRealTimers();

    const user = userEvent.setup();
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [
        { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444' },
        { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6' },
      ] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: at(2126, 7, 15, 14),
        location: 'Station A',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    await user.click(screen.getByText('pickups.volunteerDrive'));

    const confirmBtn = await screen.findByRole('button', { name: 'common.confirm' });
    expect(confirmBtn).toBeDisabled();

    await chooseDriver(user, 'Bob');

    expect(confirmBtn).toBeEnabled();
  });

  it('arranges a car for the volunteer instead of writing a driverId', async () => {
    vi.useRealTimers();

    const user = userEvent.setup();
    const successToast = await mockSuccessToast();

    await mockAliceAndBob();
    const updateTransport = await mockUpcomingPickups([pickup('t1')]);

    render(<UpcomingPickups />);
    await user.click(screen.getByText('pickups.volunteerDrive'));
    await chooseDriver(user, 'Bob');
    await user.click(screen.getByRole('button', { name: 'common.confirm' }));

    // A volunteer arranges a *car*: `Transport.driverId` is the pre-ride shape
    // and nothing writes it any more, so the leg is only ever pointed at a ride
    await waitFor(() => {
      expect(rideContext.createRide).toHaveBeenCalledWith({
        direction: 'pickup',
        meetDatetime: at(2126, 7, 15, 14),
        location: 'Station A',
        leadTimeMinutes: DEFAULT_LEAD_TIME_MINUTES,
        driverId: 'p2',
      });
    });
    expect(rideContext.setTransportRide).toHaveBeenCalledWith('t1', 'ride-new');
    expect(updateTransport).not.toHaveBeenCalled();
    expect(successToast).toHaveBeenCalledWith('pickups.volunteerSuccess');

    // The alert card is replaced by the resolving card naming the driver
    await waitFor(() => {
      expect(screen.queryByText('pickups.volunteerDrive')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('gives the driverless car the leg already sits in its volunteer', async () => {
    vi.useRealTimers();

    const user = userEvent.setup();

    await mockAliceAndBob();
    await mockUpcomingPickups([pickup('t1', { rideId: 'r1' })]);
    rideContext.rides = [
      {
        id: 'r1',
        tripId: 'trip-1',
        direction: 'pickup',
        meetDatetime: at(2126, 7, 15, 14),
        location: 'Station A',
      },
    ];

    render(<UpcomingPickups />);
    await user.click(screen.getByText('pickups.volunteerDrive'));
    await chooseDriver(user, 'Bob');
    await user.click(screen.getByRole('button', { name: 'common.confirm' }));

    // The car everybody was already booked into gains the driver — a second
    // car would strand whoever else was in the first one
    await waitFor(() => {
      expect(rideContext.updateRide).toHaveBeenCalledWith('r1', { driverId: 'p2' });
    });
    expect(rideContext.createRide).not.toHaveBeenCalled();
    expect(rideContext.setTransportRide).not.toHaveBeenCalled();
  });

  it('restores the pickup card and warns when the assignment fails', async () => {
    vi.useRealTimers();

    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { toast: toastMock } = await import('sonner');

    await mockAliceAndBob();
    await mockUpcomingPickups([pickup('t1')]);
    rideContext.createRide.mockRejectedValue(new Error('Network error'));

    render(<UpcomingPickups />);
    await user.click(screen.getByText('pickups.volunteerDrive'));
    await chooseDriver(user, 'Bob');
    await user.click(screen.getByRole('button', { name: 'common.confirm' }));

    // The failure is surfaced, not swallowed
    await waitFor(() => {
      expect(vi.mocked(toastMock.error)).toHaveBeenCalledWith('errors.saveFailed');
    });

    // …and the pickup goes back to needing a driver rather than staying stuck
    // in the optimistic "resolved" state
    expect(screen.getByText('pickups.volunteerDrive')).toBeInTheDocument();
    expect(screen.getByText('Station A')).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it('renders pickup with tomorrow datetime', async () => {
    // Set time so pickup is tomorrow
    vi.setSystemTime(new Date(at(2026, 7, 14, 10)));

    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: at(2026, 7, 15, 14),
        location: 'Station A',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    // The tomorrow branch, carrying the wall clock the pickup happens at —
    // not the relative distance used for today, nor the dated form used later
    expect(
      screen.getByText('upcomingPickups.tomorrowAt(time=14:00)'),
    ).toBeInTheDocument();
    expect(screen.queryByText('pickups.overdue')).not.toBeInTheDocument();
  });

  it('renders pickup with date later than tomorrow', async () => {
    // Set time so pickup is 3 days from now
    vi.setSystemTime(new Date(at(2026, 7, 12, 10)));

    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: at(2026, 7, 15, 14),
        location: 'Station A',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    // Beyond tomorrow, a relative distance stops being useful: the panel falls
    // back to the shared `dayAndTime` rendering every other surface uses
    expect(screen.getByText('Wed 15 Jul, 14:00')).toBeInTheDocument();
    expect(screen.queryByText(/upcomingPickups\.tomorrowAt/)).not.toBeInTheDocument();
  });

  it('drops a pickup whose datetime cannot be read, count included', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: 'invalid-date',
        location: 'Station A',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    const { container } = render(<UpcomingPickups />);

    // The old assertion here was `expect(queryByText('Station A')).toBeDefined()`,
    // which holds either way: `queryByText` returns `null` on a miss and
    // `expect(null).toBeDefined()` passes. The shipped rule is that a row that
    // cannot be placed on a timeline is dropped by `selectPickupsNeedingDriver`
    // — so it must vanish from the count *and* the cards together, never from
    // one of them alone.
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText('Station A')).not.toBeInTheDocument();
  });

  it('drops only the unreadable pickup, keeping the readable one counted', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [
        {
          id: 't1',
          tripId: 'trip-1',
          personId: 'p1',
          type: 'arrival',
          datetime: 'invalid-date',
          location: 'Broken Station',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 't2',
          tripId: 'trip-1',
          personId: 'p1',
          type: 'arrival',
          datetime: at(2026, 7, 15, 14),
          location: 'Station A',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    expect(screen.getByText('Station A')).toBeInTheDocument();
    expect(screen.queryByText('Broken Station')).not.toBeInTheDocument();
    // One card, and the badge says one — the invariant the shared selection exists for
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders the relative time in the active language', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    // The panel reads `i18n.language` to pick its date-fns locale; the mock
    // used to hardcode 'en', so this test never once exercised French
    i18nState.language = 'fr';
    vi.setSystemTime(new Date(at(2026, 7, 12, 10)));

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'p1',
        type: 'arrival',
        datetime: at(2026, 7, 15, 14),
        location: 'Gare du Nord',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{
        id: 'p1',
        tripId: 'trip-1',
        name: 'Alice',
        color: '#ef4444',
      }] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    expect(screen.getByText('Gare du Nord')).toBeInTheDocument();
    // French weekday and month, 24-hour clock: 'mer. 15 juil., 14:00'
    expect(screen.getByText('mer. 15 juil., 14:00')).toBeInTheDocument();
  });

  it('renders unassigned count badge', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [
        { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444' },
        { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6' },
      ] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [
        {
          id: 't1',
          tripId: 'trip-1',
          personId: 'p1',
          type: 'arrival',
          datetime: at(2026, 7, 15, 14),
          location: 'Different Station',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 't2',
          tripId: 'trip-1',
          personId: 'p2',
          type: 'arrival',
          datetime: at(2026, 7, 15, 18),
          location: 'Another Station',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    // Different stations, so two ungrouped cards…
    expect(screen.getAllByText('pickups.volunteerDrive')).toHaveLength(2);
    expect(screen.queryByText('pickups.combinedTrip')).not.toBeInTheDocument();
    // …and the header badge has to agree with them. The count and the cards
    // come from the same selection, and this is what pins them together.
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders pickup with multiple transport numbers in a group', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [
        { id: 'p1', tripId: 'trip-1', name: 'Alice', color: '#ef4444' },
        { id: 'p2', tripId: 'trip-1', name: 'Bob', color: '#3b82f6' },
      ] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [
        {
          id: 't1',
          tripId: 'trip-1',
          personId: 'p1',
          type: 'arrival',
          datetime: at(2026, 7, 15, 14),
          location: 'Station A',
          transportNumber: 'TGV 100',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: 't2',
          tripId: 'trip-1',
          personId: 'p2',
          type: 'arrival',
          datetime: at(2026, 7, 15, 14, 30),
          location: 'Station A',
          transportNumber: 'TGV 200',
          needsPickup: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);

    // Both transport numbers should be visible
    expect(screen.getByText('TGV 100')).toBeInTheDocument();
    expect(screen.getByText('TGV 200')).toBeInTheDocument();
    // Combined trip badge should appear
    expect(screen.getByText('pickups.combinedTrip')).toBeInTheDocument();
    // The group header states the station and the window the driver has to
    // cover — the whole point of grouping, and previously never asserted
    expect(
      screen.getByText(
        'pickups.stationWindow(station=Station A, startTime=14:00, endTime=14:30)',
      ),
    ).toBeInTheDocument();
  });

  it('renders pickup with no person as unknown in aria-label', async () => {
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');

    vi.mocked(usePersonContext).mockReturnValue({
      persons: [] as never,
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: vi.fn(),
      reorderPersons: vi.fn(),
    } as never);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups: [{
        id: 't1',
        tripId: 'trip-1',
        personId: 'nonexistent',
        type: 'arrival',
        datetime: at(2026, 7, 15, 14),
        location: 'Station Z',
        needsPickup: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }] as never,
      updateTransport: vi.fn(),
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    // The article should have an aria-label containing "unknown" key
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('aria-label', expect.stringContaining('common.unknown'));
  });

  // ==========================================================================
  // Turning a suggestion into a car
  // ==========================================================================

  it('builds one car from a three-leg group and puts every leg in it', async () => {
    vi.useRealTimers();

    const user = userEvent.setup();
    const successToast = await mockSuccessToast();

    await mockUpcomingPickups([
      pickup('t1', { datetime: at(2126, 7, 15, 14) }),
      pickup('t2', { personId: 'p2', datetime: at(2126, 7, 15, 14, 20) }),
      pickup('t3', { personId: 'p3', datetime: at(2126, 7, 15, 14, 40) }),
    ]);

    render(<UpcomingPickups />);
    await user.click(screen.getByText('pickups.oneCar'));

    // The car meets the first guest to land, at the station the group shares
    await waitFor(() => {
      expect(rideContext.createRide).toHaveBeenCalledWith({
        direction: 'pickup',
        meetDatetime: at(2126, 7, 15, 14),
        location: 'Station A',
        leadTimeMinutes: DEFAULT_LEAD_TIME_MINUTES,
      });
    });

    // …and all three legs point at it, each through its own scalar write
    await waitFor(() => {
      expect(rideContext.setTransportRide).toHaveBeenCalledTimes(3);
    });
    expect(rideContext.setTransportRide.mock.calls).toEqual([
      ['t1', 'ride-new'],
      ['t2', 'ride-new'],
      ['t3', 'ride-new'],
    ]);
    expect(successToast).toHaveBeenCalledWith('pickups.rideCreated');
  });

  it('keeps the car and reports the shortfall when one leg cannot be added', async () => {
    vi.useRealTimers();

    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { toast: toastMock } = await import('sonner');
    const successToast = await mockSuccessToast();

    await mockUpcomingPickups([
      pickup('t1', { datetime: at(2126, 7, 15, 14) }),
      pickup('t2', { personId: 'p2', datetime: at(2126, 7, 15, 14, 20) }),
      pickup('t3', { personId: 'p3', datetime: at(2126, 7, 15, 14, 40) }),
    ]);
    rideContext.setTransportRide.mockImplementation((transportId: string) =>
      transportId === 't2'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(undefined),
    );

    render(<UpcomingPickups />);
    await user.click(screen.getByText('pickups.oneCar'));

    // A refused leg does not take the rest of the group with it, and the car
    // stays: half a car is recoverable, a lost car is not
    await waitFor(() => {
      expect(vi.mocked(toastMock.error)).toHaveBeenCalledWith('pickups.rideCreatedPartial');
    });
    expect(rideContext.createRide).toHaveBeenCalledTimes(1);
    expect(rideContext.setTransportRide).toHaveBeenCalledTimes(3);
    expect(successToast).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it('offers a car per direction for a mixed group rather than picking one', async () => {
    vi.useRealTimers();

    const user = userEvent.setup();

    await mockUpcomingPickups([
      pickup('t1', { datetime: at(2126, 7, 15, 14) }),
      pickup('t2', {
        personId: 'p2',
        type: 'departure',
        datetime: at(2126, 7, 15, 14, 30),
      }),
    ]);

    render(<UpcomingPickups />);

    // One ride has one direction, so this group is two cars — and the panel
    // says so instead of silently arranging the arrivals only
    expect(screen.getByText('pickups.mixedDirections')).toBeInTheDocument();
    expect(screen.getByText('pickups.oneCarArrivals')).toBeInTheDocument();
    expect(screen.getByText('pickups.oneCarDepartures')).toBeInTheDocument();
    expect(screen.queryByText('pickups.oneCar')).not.toBeInTheDocument();

    await user.click(screen.getByText('pickups.oneCarArrivals'));

    await waitFor(() => {
      expect(rideContext.createRide).toHaveBeenCalledWith({
        direction: 'pickup',
        meetDatetime: at(2126, 7, 15, 14),
        location: 'Station A',
        leadTimeMinutes: DEFAULT_LEAD_TIME_MINUTES,
      });
    });
    await waitFor(() => {
      expect(rideContext.setTransportRide).toHaveBeenCalledTimes(1);
    });
    expect(rideContext.setTransportRide).toHaveBeenCalledWith('t1', 'ride-new');
  });

  it('adds a waiting guest to a car already going their way', async () => {
    vi.useRealTimers();

    const user = userEvent.setup();
    const successToast = await mockSuccessToast();

    await mockUpcomingPickups([pickup('t1')]);
    rideContext.rides = [
      {
        id: 'r1',
        tripId: 'trip-1',
        direction: 'pickup',
        meetDatetime: at(2126, 7, 15, 14),
        location: 'Station A',
      },
    ];

    render(<UpcomingPickups />);
    await user.click(screen.getByText('pickups.addToRide'));

    expect(
      screen.getByText('pickups.addToRideDescription(location=Station A)'),
    ).toBeInTheDocument();

    // Choosing the car is the action: no second confirmation between the guest
    // and their lift
    await user.click(screen.getByRole('button', { name: /rides\.noDriver/ }));

    await waitFor(() => {
      expect(rideContext.setTransportRide).toHaveBeenCalledWith('t1', 'r1');
    });
    expect(successToast).toHaveBeenCalledWith('pickups.addedToRide');
    expect(rideContext.createRide).not.toHaveBeenCalled();
  });

  it('does not offer a car going the other way, elsewhere, or already left', async () => {
    await mockUpcomingPickups([pickup('t1')]);
    rideContext.rides = [
      {
        id: 'r-dropoff',
        tripId: 'trip-1',
        direction: 'dropoff',
        meetDatetime: at(2126, 7, 15, 14),
        location: 'Station A',
      },
      {
        id: 'r-elsewhere',
        tripId: 'trip-1',
        direction: 'pickup',
        meetDatetime: at(2126, 7, 15, 14),
        location: 'Station B',
      },
      {
        id: 'r-gone',
        tripId: 'trip-1',
        direction: 'pickup',
        meetDatetime: at(2025, 7, 15, 14),
        location: 'Station A',
      },
    ];

    render(<UpcomingPickups />);

    // A button opening an empty list is a dead end, so it is not rendered
    expect(screen.queryByText('pickups.addToRide')).not.toBeInTheDocument();
    expect(screen.getByText('pickups.volunteerDrive')).toBeInTheDocument();
  });

  it('stops offering to build a car once the group already has one', async () => {
    await mockUpcomingPickups([
      pickup('t1', { rideId: 'r1', datetime: at(2126, 7, 15, 14) }),
      pickup('t2', { personId: 'p2', rideId: 'r1', datetime: at(2126, 7, 15, 14, 20) }),
    ]);
    rideContext.rides = [
      {
        id: 'r1',
        tripId: 'trip-1',
        direction: 'pickup',
        meetDatetime: at(2126, 7, 15, 14),
        location: 'Station A',
      },
    ];

    render(<UpcomingPickups />);

    // The car exists and still needs a driver, so the cards stay — but a
    // second tap must not build a second car and empty the first
    expect(screen.getByText('pickups.combinedTrip')).toBeInTheDocument();
    expect(screen.queryByText('pickups.oneCar')).not.toBeInTheDocument();
    expect(screen.getAllByText('pickups.volunteerDrive')).toHaveLength(2);
  });

  it('extends the half-filled car instead of starting another', async () => {
    vi.useRealTimers();

    const user = userEvent.setup();

    await mockUpcomingPickups([
      pickup('t1', { rideId: 'r1', datetime: at(2126, 7, 15, 14) }),
      pickup('t2', { personId: 'p2', datetime: at(2126, 7, 15, 14, 20) }),
    ]);
    rideContext.rides = [
      {
        id: 'r1',
        tripId: 'trip-1',
        direction: 'pickup',
        meetDatetime: at(2126, 7, 15, 14),
        location: 'Station A',
      },
    ];

    render(<UpcomingPickups />);
    await user.click(screen.getByText('pickups.oneCar'));

    // Only the leg without a car is written, and to the car its group-mate is
    // already in — a new one would leave that passenger behind
    await waitFor(() => {
      expect(rideContext.setTransportRide).toHaveBeenCalledWith('t2', 'r1');
    });
    expect(rideContext.setTransportRide).toHaveBeenCalledTimes(1);
    expect(rideContext.createRide).not.toHaveBeenCalled();
  });

  it('still builds a car when the legs name one this device does not hold', async () => {
    vi.useRealTimers();

    const user = userEvent.setup();

    // The QR-changeset path ships legs before rides, so an invitee holds legs
    // pointing at cars they have never seen. Read as membership, that would
    // hide the button — or aim every write at a ride that is not there
    await mockUpcomingPickups([
      pickup('t1', { rideId: 'r-not-here', datetime: at(2126, 7, 15, 14) }),
      pickup('t2', {
        personId: 'p2',
        rideId: 'r-not-here',
        datetime: at(2126, 7, 15, 14, 20),
      }),
    ]);

    render(<UpcomingPickups />);
    await user.click(screen.getByText('pickups.oneCar'));

    await waitFor(() => {
      expect(rideContext.createRide).toHaveBeenCalledTimes(1);
    });
    expect(rideContext.setTransportRide.mock.calls).toEqual([
      ['t1', 'ride-new'],
      ['t2', 'ride-new'],
    ]);
  });
});
