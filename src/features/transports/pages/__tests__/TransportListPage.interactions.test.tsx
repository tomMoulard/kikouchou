/**
 * @fileoverview The transports page's pointer-free paths and its URL handling.
 *
 * Beside the menus covered in `TransportListPage.actions.test`, a leg card can
 * be opened from the keyboard, a leg can be dropped into a car, and the page
 * cleans `?new=1` out of the URL after acting on it. What the card says to a
 * screen reader changes with who is driving, which is asserted here rather than
 * left to the eye.
 *
 * The drop is driven through the `DndContext` props the page registers: dnd-kit
 * pointer sensors do not work in jsdom, so a synthetic drag would assert the
 * test harness rather than the page.
 *
 * @module features/transports/pages/__tests__/TransportListPage.interactions.test
 */

import type { ReactElement } from 'react';
import { format } from 'date-fns';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act } from 'react';
import type { Active, DndContextProps, Over } from '@dnd-kit/core';

import { render, screen, userEvent, waitFor } from '@/test/utils';
import type { Person, Ride, Transport, TransportId, Trip } from '@/types';
import type { DroppableRideData } from '@/features/transports/components/DroppableRide';

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

const alice: Person = {
  id: 'person-1' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

const bob: Person = {
  id: 'person-2' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Bob',
  color: '#ef4444' as Person['color'],
};

const mockArrival: Transport = {
  id: 'transport-1' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: alice.id,
  type: 'arrival',
  datetime: daysFromNow(7, 14, 30) as Transport['datetime'],
  location: 'Paris CDG',
  needsPickup: true,
  transportMode: 'plane',
};

/** Alice collects herself: the card says so instead of naming a driver. */
const selfDrivenArrival: Transport = {
  ...mockArrival,
  id: 'transport-self' as Transport['id'],
  driverId: alice.id,
} as Transport;

/** Bob collects Alice, which is the other half of the same sentence. */
const drivenArrival: Transport = {
  ...mockArrival,
  id: 'transport-driven' as Transport['id'],
  driverId: bob.id,
} as Transport;

const ride: Ride = {
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
const mockSetCurrentTrip = vi.fn();
const mockSetTransportRide = vi.fn();
const mockNotifySuccess = vi.fn();

/** The props the page last gave dnd-kit. */
let dndProps: DndContextProps | null = null;

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: (props: DndContextProps): ReactElement => {
      dndProps = props;
      return <actual.DndContext {...props} />;
    },
  };
});

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

vi.mock('@/features/transports/components/TransportDialog', () => ({
  TransportDialog: ({
    open,
    transportId,
    onOpenChange,
  }: {
    open: boolean;
    transportId?: string;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="transport-dialog" data-transport-id={transportId ?? ''}>
        <button data-testid="close-transport-dialog" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null,
}));

vi.mock('@/features/transports/components/UpcomingPickups', () => ({
  UpcomingPickups: () => <div data-testid="upcoming-pickups" />,
}));

vi.mock('@/features/transports/components/RideDialog', () => ({
  RideDialog: ({
    open,
    rideId,
    onOpenChange,
  }: {
    open: boolean;
    rideId?: string;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="ride-dialog" data-ride-id={rideId ?? ''}>
        <button data-testid="close-ride-dialog" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null,
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

function setTransports(
  arrivals: readonly Transport[],
  departures: readonly Transport[] = [],
): void {
  vi.mocked(useTransportContext).mockReturnValue({
    arrivals,
    departures,
    upcomingPickups: [],
    nowMs: Date.now(),
    isLoading: false,
    error: null,
    deleteTransport: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useTransportContext>);
}

function resetMocks(): void {
  mockIdentity(undefined);
  vi.mocked(useTripContext).mockReturnValue({
    currentTrip: mockTrip,
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
    trips: [mockTrip],
    checkConnection: vi.fn(),
  } as unknown as ReturnType<typeof useTripContext>);
  vi.mocked(usePersonContext).mockReturnValue({
    persons: [alice, bob],
    isLoading: false,
    error: null,
    getPersonById: vi.fn((id: string) => {
      if (id === alice.id) return alice;
      if (id === bob.id) return bob;
      return undefined;
    }),
  } as unknown as ReturnType<typeof usePersonContext>);
  setTransports([mockArrival]);
  vi.mocked(useRideContext).mockReturnValue({
    rides: [],
    vehicles: [],
    isLoading: false,
    error: null,
    deleteRide: vi.fn().mockResolvedValue(undefined),
    updateRide: vi.fn().mockResolvedValue(undefined),
    setTransportRide: mockSetTransportRide,
  } as unknown as ReturnType<typeof useRideContext>);
}

function renderPage(route = '/trips/trip-1/transports') {
  return render(<TransportListPage />, { initialRoute: route, withProviders: false });
}

/** dnd-kit's `active` for a leg handle. */
function draggedLeg(transportId: TransportId): Active {
  return {
    id: `leg-${transportId}`,
    data: { current: { transportId } },
    rect: { current: { initial: null, translated: null } },
  } as unknown as Active;
}

/** dnd-kit's `over` for a car. */
function overRide(rideId: Ride['id']): Over {
  const data: DroppableRideData = { rideId };
  return {
    id: `ride-${rideId}`,
    data: { current: data },
    rect: {},
    disabled: false,
  } as unknown as Over;
}

function drop(active: Active, over: Over | null): void {
  act(() => {
    dndProps?.onDragEnd?.({ active, over } as Parameters<
      NonNullable<DndContextProps['onDragEnd']>
    >[0]);
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('TransportListPage — the keyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dndProps = null;
    mockSetTransportRide.mockResolvedValue(undefined);
    mockSetCurrentTrip.mockResolvedValue(undefined);
    resetMocks();
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens a leg with %s', async (_name, key) => {
    const user = userEvent.setup();
    renderPage();

    const card = screen.getAllByRole('article')[0]!;
    card.focus();
    await user.keyboard(key);

    expect(await screen.findByTestId('transport-dialog')).toHaveAttribute(
      'data-transport-id',
      mockArrival.id,
    );
  });

  it('ignores a key that is not an activation', async () => {
    const user = userEvent.setup();
    renderPage();

    const card = screen.getAllByRole('article')[0]!;
    card.focus();
    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('transport-dialog')).not.toBeInTheDocument();
  });
});

describe('TransportListPage — what the card says', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dndProps = null;
    mockSetTransportRide.mockResolvedValue(undefined);
    mockSetCurrentTrip.mockResolvedValue(undefined);
    resetMocks();
  });

  it('says a guest is collecting themselves', () => {
    setTransports([selfDrivenArrival]);
    renderPage();

    expect(screen.getAllByRole('article')[0]!.getAttribute('aria-label')).toContain(
      'rides.selfDriven',
    );
  });

  it('names the driver when somebody else is collecting', () => {
    setTransports([drivenArrival]);
    renderPage();

    expect(screen.getAllByRole('article')[0]!.getAttribute('aria-label')).toContain('Bob');
  });
});

describe('TransportListPage — dropping a leg into a car', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dndProps = null;
    mockSetTransportRide.mockResolvedValue(undefined);
    mockSetCurrentTrip.mockResolvedValue(undefined);
    resetMocks();
    vi.mocked(useRideContext).mockReturnValue({
      rides: [ride],
      vehicles: [],
      isLoading: false,
      error: null,
      deleteRide: vi.fn().mockResolvedValue(undefined),
      updateRide: vi.fn().mockResolvedValue(undefined),
      setTransportRide: mockSetTransportRide,
    } as unknown as ReturnType<typeof useRideContext>);
  });

  it('puts the leg in the car it was dropped on', async () => {
    renderPage();

    drop(draggedLeg(mockArrival.id), overRide(ride.id));

    await waitFor(() => {
      expect(mockSetTransportRide).toHaveBeenCalledWith(mockArrival.id, ride.id);
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('transports.addedToRide');
  });

  it('writes nothing when the leg is dropped on nothing', () => {
    renderPage();

    drop(draggedLeg(mockArrival.id), null);

    expect(mockSetTransportRide).not.toHaveBeenCalled();
  });

  it('does not claim the leg joined the car when the write failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSetTransportRide.mockRejectedValue(new Error('offline'));
    renderPage();

    drop(draggedLeg(mockArrival.id), overRide(ride.id));

    await waitFor(() => {
      expect(mockSetTransportRide).toHaveBeenCalled();
    });
    expect(mockNotifySuccess).not.toHaveBeenCalledWith('transports.addedToRide');
    consoleError.mockRestore();
  });
});

describe('TransportListPage — the URL and the header', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dndProps = null;
    mockSetTransportRide.mockResolvedValue(undefined);
    mockSetCurrentTrip.mockResolvedValue(undefined);
    resetMocks();
  });

  it('opens the new-transport dialog and takes the flag out of the URL', async () => {
    renderPage('/trips/trip-1/transports?new=1');

    expect(await screen.findByTestId('transport-dialog')).toBeInTheDocument();
    // Left in place, reloading the page or going back would pop it open again.
    await waitFor(() => {
      expect(window.location.search).not.toContain('new=1');
    });
  });

  it('forgets what it was editing when the dialog closes', async () => {
    const user = userEvent.setup();
    renderPage();

    const menus = screen.getAllByRole('button', { name: /common\.actions/i });
    await user.click(menus[0]!);
    await user.click(await screen.findByText('common.edit'));
    await user.click(await screen.findByTestId('close-transport-dialog'));

    await waitFor(() => {
      expect(screen.queryByTestId('transport-dialog')).not.toBeInTheDocument();
    });
  });

  it('opens a blank dialog from the header', async () => {
    const user = userEvent.setup();
    renderPage();

    const newButtons = screen.getAllByRole('button', { name: /transports.new/i });
    await user.click(newButtons[0]!);

    expect(await screen.findByTestId('transport-dialog')).toHaveAttribute(
      'data-transport-id',
      '',
    );
  });

  it('goes to the map and back to the calendar', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /transports.mapView/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-1/transports/map');
  });

  it('reports a trip switch that failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSetCurrentTrip.mockRejectedValue(new Error('gone'));
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: null,
      isLoading: false,
      error: null,
      setCurrentTrip: mockSetCurrentTrip,
      trips: [mockTrip],
      checkConnection: vi.fn(),
    } as unknown as ReturnType<typeof useTripContext>);

    renderPage();

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalled();
    });
    consoleError.mockRestore();
  });
});
