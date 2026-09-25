/**
 * @fileoverview What the transports page writes when somebody acts on a row.
 *
 * The sibling file covers what the page renders. This one covers the handlers:
 * deleting a leg, editing and cancelling a car journey, taking the driver's
 * seat, and what each one does when the write fails — which is to say nothing,
 * loudly, rather than claiming a success the database never saw.
 *
 * Dates are derived from the moment the test runs, for the reason the sibling
 * file gives: a hardcoded date silently moves rows into the past accordion.
 *
 * @module features/transports/pages/__tests__/TransportListPage.actions.test
 */

import { format } from 'date-fns';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen, userEvent, within } from '@/test/utils';
import type { Person, Ride, Transport, Trip } from '@/types';

// ============================================================================
// Fixture dates
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number, hours: number, minutes = 0): string {
  const date = new Date(Date.now() + days * DAY_MS);
  date.setHours(hours, minutes, 0, 0);
  return format(date, "yyyy-MM-dd'T'HH:mm:ss");
}

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
  startDate: dayFromNow(7) as Trip['startDate'],
  endDate: dayFromNow(17) as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockPerson: Person = {
  id: 'person-1' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

const mockArrival: Transport = {
  id: 'transport-1' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: 'person-1' as Transport['personId'],
  type: 'arrival',
  datetime: daysFromNow(7, 14, 30) as Transport['datetime'],
  location: 'Paris CDG',
  needsPickup: true,
  transportMode: 'plane',
};

/** A car nobody is driving yet, which is what makes the claim button appear. */
const driverlessRide: Ride = {
  id: 'ride-1' as Ride['id'],
  tripId: 'trip-1' as Ride['tripId'],
  direction: 'pickup',
  meetDatetime: daysFromNow(7, 13, 30) as Ride['meetDatetime'],
  location: 'Paris CDG',
} as Ride;

// ============================================================================
// Mocks
// ============================================================================

const mockNavigate = vi.fn();
const mockDeleteTransport = vi.fn();
const mockDeleteRide = vi.fn();
const mockUpdateRide = vi.fn();
const mockNotifySuccess = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-1' }),
  };
});

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('@/contexts/RideContext', () => ({ useRideContext: vi.fn() }));
vi.mock('@/contexts/PersonContext', () => ({ usePersonContext: vi.fn() }));
vi.mock('@/contexts/TransportContext', () => ({ useTransportContext: vi.fn() }));

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: mockNotifySuccess, errorToast: vi.fn() }),
  useTripIdentity: vi.fn(),
}));

// The dialog reports which leg it was opened on, so an edit can be asserted
// without driving the real form.
vi.mock('@/features/transports/components/TransportDialog', () => ({
  TransportDialog: ({ open, transportId }: { open: boolean; transportId?: string }) =>
    open ? <div data-testid="transport-dialog" data-transport-id={transportId ?? ''} /> : null,
}));

vi.mock('@/features/transports/components/UpcomingPickups', () => ({
  UpcomingPickups: () => <div data-testid="upcoming-pickups" />,
}));

vi.mock('@/features/transports/components/RideDialog', () => ({
  RideDialog: ({ open, rideId }: { open: boolean; rideId?: string }) =>
    open ? <div data-testid="ride-dialog" data-ride-id={rideId ?? ''} /> : null,
}));

vi.mock('@/features/transports/components/RideChangeFeed', () => ({
  RideChangeFeed: () => <div data-testid="ride-change-feed" />,
}));

vi.mock('@/features/transports/components/DriverAlert', () => ({
  DriverAlert: () => <div data-testid="driver-alert" />,
}));

vi.mock('@/features/transports/components/AddRunsToCalendarButton', () => ({
  AddRunsToCalendarButton: () => <div data-testid="add-runs-to-calendar" />,
}));

import { TransportListPage } from '../TransportListPage';
import { useTripIdentity } from '@/hooks';
import { useTripContext } from '@/contexts/TripContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';

// ============================================================================
// Helpers
// ============================================================================

function mockIdentity(myPersonId: Person['id'] | undefined): void {
  vi.mocked(useTripIdentity).mockReturnValue({
    myPersonId,
    source: myPersonId === undefined ? undefined : 'explicit',
    isResolved: true,
    setMyPersonId: vi.fn(),
  });
}

function setRides(rides: readonly Ride[]): void {
  vi.mocked(useRideContext).mockReturnValue({
    rides,
    vehicles: [],
    isLoading: false,
    error: null,
    deleteRide: mockDeleteRide,
    updateRide: mockUpdateRide,
    setTransportRide: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useRideContext>);
}

function resetMocks(): void {
  mockIdentity(undefined);
  vi.mocked(useTripContext).mockReturnValue({
    currentTrip: mockTrip,
    isLoading: false,
    error: null,
    setCurrentTrip: vi.fn().mockResolvedValue(undefined),
    trips: [mockTrip],
    checkConnection: vi.fn(),
  } as unknown as ReturnType<typeof useTripContext>);
  vi.mocked(usePersonContext).mockReturnValue({
    persons: [mockPerson],
    isLoading: false,
    error: null,
    getPersonById: vi.fn((id: string) => (id === 'person-1' ? mockPerson : undefined)),
  } as unknown as ReturnType<typeof usePersonContext>);
  vi.mocked(useTransportContext).mockReturnValue({
    arrivals: [mockArrival],
    departures: [],
    upcomingPickups: [],
    nowMs: Date.now(),
    isLoading: false,
    error: null,
    deleteTransport: mockDeleteTransport,
  } as unknown as ReturnType<typeof useTransportContext>);
  setRides([]);
}

/**
 * Puts Alice's arrival in the car, so the journey survives the scope filter
 * once this browser says it is Alice.
 */
function ridingInTheCar(): void {
  vi.mocked(useTransportContext).mockReturnValue({
    arrivals: [{ ...mockArrival, rideId: driverlessRide.id }],
    departures: [],
    upcomingPickups: [],
    nowMs: Date.now(),
    isLoading: false,
    error: null,
    deleteTransport: mockDeleteTransport,
  } as unknown as ReturnType<typeof useTransportContext>);
}

/** Opens the actions menu of the first leg card and picks an item. */
async function chooseOnFirstLeg(
  user: ReturnType<typeof userEvent.setup>,
  item: string,
): Promise<void> {
  const menus = screen.getAllByRole('button', { name: /common\.actions/i });
  await user.click(menus[0]!);
  await user.click(screen.getByText(item));
}

// ============================================================================
// Tests
// ============================================================================

describe('TransportListPage — a leg', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteTransport.mockResolvedValue(undefined);
    mockDeleteRide.mockResolvedValue(undefined);
    mockUpdateRide.mockResolvedValue(undefined);
    resetMocks();
  });

  it('opens the dialog on the leg that was edited', async () => {
    const user = userEvent.setup();
    render(<TransportListPage />, { withProviders: false });

    await chooseOnFirstLeg(user, 'common.edit');

    expect(await screen.findByTestId('transport-dialog')).toHaveAttribute(
      'data-transport-id',
      mockArrival.id,
    );
  });

  it('deletes the leg once the prompt is confirmed', async () => {
    const user = userEvent.setup();
    render(<TransportListPage />, { withProviders: false });

    await chooseOnFirstLeg(user, 'common.delete');
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: /common\.delete/i }));

    expect(mockDeleteTransport).toHaveBeenCalledWith(mockArrival.id);
  });

  it('keeps the leg when the prompt is dismissed', async () => {
    const user = userEvent.setup();
    render(<TransportListPage />, { withProviders: false });

    await chooseOnFirstLeg(user, 'common.delete');
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: /common\.cancel/i }));

    expect(mockDeleteTransport).not.toHaveBeenCalled();
  });

  it('does not claim the leg was deleted when the write failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDeleteTransport.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    render(<TransportListPage />, { withProviders: false });

    await chooseOnFirstLeg(user, 'common.delete');
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: /common\.delete/i }));

    expect(mockDeleteTransport).toHaveBeenCalled();
    expect(mockNotifySuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('drops a leg whose datetime cannot be read rather than failing the page', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [
        mockArrival,
        { ...mockArrival, id: 'transport-broken' as Transport['id'], datetime: 'not-a-date' },
      ],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: mockDeleteTransport,
    } as unknown as ReturnType<typeof useTransportContext>);

    render(<TransportListPage />, { withProviders: false });

    expect(screen.getAllByText('Paris CDG').length).toBe(1);
  });
});

describe('TransportListPage — a car journey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteTransport.mockResolvedValue(undefined);
    mockDeleteRide.mockResolvedValue(undefined);
    mockUpdateRide.mockResolvedValue(undefined);
    resetMocks();
    setRides([driverlessRide]);
  });

  it('opens the ride dialog on the journey that was edited', async () => {
    const user = userEvent.setup();
    render(<TransportListPage />, { withProviders: false });

    const menus = screen.getAllByRole('button', { name: /common\.actions/i });
    await user.click(menus[0]!);
    await user.click(await screen.findByText('rides.edit'));

    expect(await screen.findByTestId('ride-dialog')).toHaveAttribute(
      'data-ride-id',
      driverlessRide.id,
    );
  });

  it('cancels the journey once the prompt is confirmed', async () => {
    const user = userEvent.setup();
    render(<TransportListPage />, { withProviders: false });

    const menus = screen.getAllByRole('button', { name: /common\.actions/i });
    await user.click(menus[0]!);
    await user.click(await screen.findByText('rides.cancel'));
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: /common\.delete|rides\.cancel/i }));

    expect(mockDeleteRide).toHaveBeenCalledWith(driverlessRide.id);
  });

  it('does not claim the journey was cancelled when the write failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDeleteRide.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    render(<TransportListPage />, { withProviders: false });

    const menus = screen.getAllByRole('button', { name: /common\.actions/i });
    await user.click(menus[0]!);
    await user.click(await screen.findByText('rides.cancel'));
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: /common\.delete|rides\.cancel/i }));

    expect(mockDeleteRide).toHaveBeenCalled();
    expect(mockNotifySuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('puts the guest holding the device at the wheel', async () => {
    mockIdentity(mockPerson.id);
    ridingInTheCar();
    const user = userEvent.setup();
    render(<TransportListPage />, { withProviders: false });

    await user.click(await screen.findByRole('button', { name: 'proposedRuns.claim' }));

    expect(mockUpdateRide).toHaveBeenCalledWith(driverlessRide.id, {
      driverId: mockPerson.id,
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('proposedRuns.claimed');
  });

  it('does not claim the seat was taken when the write failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUpdateRide.mockRejectedValue(new Error('offline'));
    mockIdentity(mockPerson.id);
    ridingInTheCar();
    const user = userEvent.setup();
    render(<TransportListPage />, { withProviders: false });

    await user.click(await screen.findByRole('button', { name: 'proposedRuns.claim' }));

    expect(mockUpdateRide).toHaveBeenCalled();
    expect(mockNotifySuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
