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
// for is not unassigned, even though the leg carries no `driverId`. Empty here,
// so every case below keeps testing the leg-level behaviour it was written for.
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
  beforeEach(() => {
    i18nState.language = 'en';
    vi.useFakeTimers();
    // 10:00 on 15 July 2026 *where the test runs* — see `at` above
    vi.setSystemTime(new Date(at(2026, 7, 15, 10)));
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

  it('assigns the chosen driver and swaps the card for the resolving state', async () => {
    vi.useRealTimers();

    const user = userEvent.setup();
    const mockUpdateTransport = vi.fn().mockResolvedValue(undefined);
    const mockSuccessToast = vi.fn();
    const { useTransportContext } = await import('@/contexts/TransportContext');
    const { usePersonContext } = await import('@/contexts/PersonContext');
    const { useOfflineAwareToast } = await import('@/hooks');

    vi.mocked(useOfflineAwareToast).mockReturnValue({
      successToast: mockSuccessToast,
    } as never);

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
      updateTransport: mockUpdateTransport,
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

    render(<UpcomingPickups />);
    await user.click(screen.getByText('pickups.volunteerDrive'));
    await chooseDriver(user, 'Bob');
    await user.click(screen.getByRole('button', { name: 'common.confirm' }));

    // The chosen driver reaches the store, keyed by the right transport
    await waitFor(() => {
      expect(mockUpdateTransport).toHaveBeenCalledWith('t1', { driverId: 'p2' });
    });
    expect(mockSuccessToast).toHaveBeenCalledWith('pickups.volunteerSuccess');

    // The alert card is replaced by the resolving card naming the driver
    await waitFor(() => {
      expect(screen.queryByText('pickups.volunteerDrive')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('restores the pickup card and warns when the assignment fails', async () => {
    vi.useRealTimers();

    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { toast: toastMock } = await import('sonner');
    const mockUpdateTransport = vi.fn().mockRejectedValue(new Error('Network error'));
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
      updateTransport: mockUpdateTransport,
      arrivals: [],
      departures: [],
      transports: [],
      createTransport: vi.fn(),
      deleteTransport: vi.fn(),
    } as never);

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
});
