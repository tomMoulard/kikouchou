/**
 * @fileoverview Tests for TransportListPage.
 *
 * Every fixture date here is **derived from the moment the test runs**, never
 * written out. The page splits transports into an upcoming list and a
 * collapsed "past" accordion, so a hardcoded date is a fuse: this file used to
 * pin its transports at 2027 and its trip at 2026-07, and on the day the wall
 * clock passed them the upcoming assertions would start hunting for rows that
 * render but are hidden inside the accordion. `daysFromNow` keeps the
 * upcoming/past split meaningful forever, and in every timezone.
 *
 * @module features/transports/pages/__tests__/TransportListPage.test
 */

import { format } from 'date-fns';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/utils';
import type { Person, Transport, Trip } from '@/types';

// ============================================================================
// Fixture dates
// ============================================================================

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A transport datetime `days` from now, at a fixed local wall clock.
 *
 * Offset-less, matching what `TransportForm`'s `datetime-local` input produces
 * and what the page's `parseISO` reads back as local time.
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
// Mocks
// ============================================================================

const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);

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

/** The guest at the wheel, for the journeys that have one. */
const mockDriver: Person = {
  id: 'person-2' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Bob',
  color: '#ef4444' as Person['color'],
};

/** Two more passengers, so a shared car holds three people rather than one. */
const mockCarol: Person = {
  id: 'person-3' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Carol',
  color: '#22c55e' as Person['color'],
};

const mockDave: Person = {
  id: 'person-4' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Dave',
  color: '#a855f7' as Person['color'],
};

const mockArrival: Transport = {
  id: 'transport-1' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: 'person-1' as Transport['personId'],
  type: 'arrival',
  datetime: daysFromNow(7, 14, 30) as Transport['datetime'],
  location: 'Paris CDG',
  needsPickup: false,
  transportMode: 'plane',
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-1' }),
  };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(() => ({
    currentTrip: mockTrip,
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
    trips: [mockTrip],
    checkConnection: vi.fn(),
  })),
}));

// Same reason as the panel: a driven ride covers its legs, so the page's alert
// gate reads the rides as well as the legs. The list draws those rides too, so
// it takes the cars along with them.
vi.mock('@/contexts/RideContext', () => ({
  useRideContext: vi.fn(() => ({ rides: [], vehicles: [] })),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(() => ({
    persons: [mockPerson],
    isLoading: false,
    error: null,
    getPersonById: vi.fn((id: string) => (id === 'person-1' ? mockPerson : undefined)),
  })),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: vi.fn(() => ({
    arrivals: [mockArrival],
    departures: [],
    upcomingPickups: [],
    nowMs: Date.now(),
    isLoading: false,
    error: null,
    deleteTransport: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: vi.fn(),
    errorToast: vi.fn(),
  }),
}));

// Mock child components
vi.mock('@/features/transports/components/TransportDialog', () => ({
  TransportDialog: () => <div data-testid="transport-dialog" />,
}));

vi.mock('@/features/transports/components/UpcomingPickups', () => ({
  UpcomingPickups: () => <div data-testid="upcoming-pickups" />,
}));

import { TransportListPage } from '../TransportListPage';
import { useTripContext } from '@/contexts/TripContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';

// ============================================================================
// Helpers
// ============================================================================

function resetMocks() {
  vi.mocked(useTripContext).mockReturnValue({
    currentTrip: mockTrip,
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
    trips: [mockTrip],
    checkConnection: vi.fn(),
  });
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
    deleteTransport: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof useTransportContext>);
  // `clearAllMocks` clears calls, not implementations, so a test that hands the
  // page a ride would otherwise hand it to every test after it too.
  vi.mocked(useRideContext).mockReturnValue({
    rides: [],
    vehicles: [],
  } as unknown as ReturnType<typeof useRideContext>);
}

// ============================================================================
// Tests
// ============================================================================

describe('TransportListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it('renders the page title', () => {
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByText('transports.title')).toBeInTheDocument();
  });

  it('renders transport count summary when transports exist', () => {
    render(<TransportListPage />, { withProviders: false });
    // Should show arrivals and departures summary
    expect(screen.getByText(/transports.arrivals/i)).toBeInTheDocument();
  });

  it('renders loading state', () => {
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: mockTrip,
      isLoading: true,
      error: null,
      setCurrentTrip: mockSetCurrentTrip,
      trips: [mockTrip],
      checkConnection: vi.fn(),
    });
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders trip-not-found state when no current trip', () => {
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: null,
      isLoading: false,
      error: null,
      setCurrentTrip: mockSetCurrentTrip,
      trips: [],
      checkConnection: vi.fn(),
    });
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
  });

  it('renders error state when transport context has error', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: new Error('DB Error'),
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });

    // The error state replaces the list; asserting only the page title left
    // the failure itself unobserved, and the list unobserved too
    expect(screen.getByText('DB Error')).toBeInTheDocument();
    expect(screen.queryByText('transports.empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('transport-dialog')).not.toBeInTheDocument();
  });

  it('renders empty state when no transports', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByText('transports.empty')).toBeInTheDocument();
  });

  it('renders back link', () => {
    render(<TransportListPage />, { withProviders: false });
    const backLink = screen.getByRole('link');
    expect(backLink).toBeInTheDocument();
  });

  it('renders add transport button', () => {
    render(<TransportListPage />, { withProviders: false });
    // The FAB has aria-label={t('transports.new')} and desktop button has the same text
    const addBtns = screen.getAllByRole('button', { name: /transports\.new/i });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('renders departures tab', async () => {
    const mockDeparture: Transport = {
      id: 'transport-2' as Transport['id'],
      tripId: 'trip-1' as Transport['tripId'],
      personId: 'person-1' as Transport['personId'],
      type: 'departure',
      datetime: daysFromNow(12, 10, 0) as Transport['datetime'],
      location: 'Paris Orly',
      needsPickup: false,
      transportMode: 'plane',
    };
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [mockArrival],
      departures: [mockDeparture],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });
    // Both tabs should show
    expect(screen.getByText(/transports\.arrivals/i)).toBeInTheDocument();
    expect(screen.getByText(/transports\.departures/i)).toBeInTheDocument();
  });

  it('renders map button', () => {
    render(<TransportListPage />, { withProviders: false });
    const mapBtn = screen.getByRole('button', { name: /transports\.mapView/i });
    expect(mapBtn).toBeInTheDocument();
  });

  it('renders transport card with needsPickup indicator', () => {
    const pickupTransport: Transport = {
      ...mockArrival,
      needsPickup: true,
    };
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [pickupTransport],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });

    // The indicator this test is named for. `getByText('Alice')` was true of
    // every card on this page, pickup or not.
    expect(screen.getByText('transports.needsPickup')).toBeInTheDocument();
    expect(screen.queryByText(/transports\.driver/)).not.toBeInTheDocument();
  });

  it('renders a legacy driver-only transport as a one-passenger ride card', () => {
    const pickupTransport: Transport = {
      ...mockArrival,
      needsPickup: true,
      driverId: 'person-2' as Transport['driverId'],
    };
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [mockPerson, mockDriver],
      isLoading: false,
      error: null,
      getPersonById: vi.fn((id: string) => {
        if (id === 'person-1') return mockPerson;
        if (id === 'person-2') return mockDriver;
        return undefined;
      }),
    } as unknown as ReturnType<typeof usePersonContext>);
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [pickupTransport],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });

    // Nothing migrates the old shape, so `resolveRides` reads it as a journey
    // of one and the list draws it as a ride — which is what makes the driver
    // and the passenger appear together instead of on unrelated rows.
    const card = screen.getByRole('article');
    expect(within(card).getByText('rides.driver:')).toBeInTheDocument();
    expect(within(card).getByText('Bob')).toBeInTheDocument();
    expect(within(card).getByText('Alice')).toBeInTheDocument();
    // The old pickup plea belongs to the leg card, which this row is not.
    expect(screen.queryByText('transports.needsPickup')).not.toBeInTheDocument();
  });

  it('folds three legs sharing a car into a single ride card', () => {
    const meetDatetime = daysFromNow(7, 14, 30);
    const ride = {
      id: 'ride-1',
      tripId: 'trip-1',
      direction: 'pickup',
      meetDatetime,
      location: 'Paris CDG',
      leadTimeMinutes: 30,
      driverId: 'person-2',
      vehicleId: 'vehicle-1',
    };
    const legs: Transport[] = [
      { ...mockArrival, id: 't-a' as Transport['id'], rideId: 'ride-1' as Transport['rideId'] },
      {
        ...mockArrival,
        id: 't-b' as Transport['id'],
        personId: 'person-3' as Transport['personId'],
        datetime: daysFromNow(7, 14, 45) as Transport['datetime'],
        rideId: 'ride-1' as Transport['rideId'],
      },
      {
        ...mockArrival,
        id: 't-c' as Transport['id'],
        personId: 'person-4' as Transport['personId'],
        datetime: daysFromNow(7, 15, 0) as Transport['datetime'],
        rideId: 'ride-1' as Transport['rideId'],
      },
    ];
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [mockPerson, mockDriver, mockCarol, mockDave],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(),
    } as unknown as ReturnType<typeof usePersonContext>);
    vi.mocked(useRideContext).mockReturnValue({
      rides: [ride],
      vehicles: [{ id: 'vehicle-1', tripId: 'trip-1', name: 'Rented Espace', seatCount: 7 }],
    } as unknown as ReturnType<typeof useRideContext>);
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: legs,
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });

    // One card for the car, not three unrelated rows for the three people in it
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(1);

    const card = cards[0] as HTMLElement;
    expect(within(card).getByText('Alice')).toBeInTheDocument();
    expect(within(card).getByText('Carol')).toBeInTheDocument();
    expect(within(card).getByText('Dave')).toBeInTheDocument();
    expect(within(card).getByText('Bob')).toBeInTheDocument();
    expect(within(card).getByText('Rented Espace')).toBeInTheDocument();
  });

  it('renders transport with transport number', () => {
    const transportWithNumber: Transport = {
      ...mockArrival,
      transportNumber: 'AF123',
    };
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [transportWithNumber],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByText('AF123')).toBeInTheDocument();
  });

  it('renders different transport modes (train, car, bus)', () => {
    const trainTransport: Transport = {
      ...mockArrival,
      id: 't-train' as Transport['id'],
      transportMode: 'train',
      location: 'Gare du Nord',
    };
    const carTransport: Transport = {
      ...mockArrival,
      id: 't-car' as Transport['id'],
      transportMode: 'car',
      location: 'Highway A1',
    };
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [trainTransport, carTransport],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByText('Gare du Nord')).toBeInTheDocument();
    expect(screen.getByText('Highway A1')).toBeInTheDocument();
  });

  it('renders transport without a matching person', () => {
    const orphanTransport: Transport = {
      ...mockArrival,
      personId: 'nonexistent' as Transport['personId'],
    };
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [orphanTransport],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });

    // A transport whose person has been deleted still has to appear — it is a
    // real journey — labelled as unknown rather than blank
    expect(screen.getByText('Paris CDG')).toBeInTheDocument();
    expect(screen.getByText('common.unknown')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });

  it('opens dropdown menu on transport card', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TransportListPage />, { withProviders: false });
    const menuButtons = screen.getAllByRole('button', { name: /common\.actions/i });
    await user.click(menuButtons[0]!);
    // Should show edit and delete menu items
    expect(screen.getByText('common.edit')).toBeInTheDocument();
    expect(screen.getByText('common.delete')).toBeInTheDocument();
  });

  it('opens delete confirmation dialog from dropdown', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TransportListPage />, { withProviders: false });
    const menuButtons = screen.getAllByRole('button', { name: /common\.actions/i });
    await user.click(menuButtons[0]!);
    await user.click(screen.getByText('common.delete'));
    // Confirmation dialog should appear
    expect(screen.getByText('confirm.deleteTransport')).toBeInTheDocument();
  });

  it('renders both arrivals and departures on different dates', () => {
    const departure: Transport = {
      id: 'transport-2' as Transport['id'],
      tripId: 'trip-1' as Transport['tripId'],
      personId: 'person-1' as Transport['personId'],
      type: 'departure',
      datetime: daysFromNow(12, 10, 0) as Transport['datetime'],
      location: 'Paris Orly',
      needsPickup: false,
      transportMode: 'plane',
    };
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [mockArrival],
      departures: [departure],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByText('Paris CDG')).toBeInTheDocument();
    expect(screen.getByText('Paris Orly')).toBeInTheDocument();
  });

  it('renders upcoming pickups section when pickups exist', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [mockArrival],
      departures: [],
      upcomingPickups: [{
        ...mockArrival,
        needsPickup: true,
      }],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByTestId('upcoming-pickups')).toBeInTheDocument();
  });

  it('does not render upcoming pickups section when every pickup has a driver', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [mockArrival],
      departures: [],
      upcomingPickups: [{
        ...mockArrival,
        needsPickup: true,
        driverId: 'person-1' as Transport['driverId'],
      }],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });
    expect(screen.queryByTestId('upcoming-pickups')).not.toBeInTheDocument();
  });

  // ============================================================================
  // Additional branch coverage tests
  // ============================================================================

  it('renders transport with notes', () => {
    const transportWithNotes: Transport = {
      ...mockArrival,
      notes: 'Meet at gate 12',
    };
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [transportWithNotes],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByText('Meet at gate 12')).toBeInTheDocument();
  });

  it('renders a driven departure as a ride card', () => {
    const transportWithDriver: Transport = {
      ...mockArrival,
      needsPickup: false,
      driverId: 'person-2' as Transport['driverId'],
    };
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [mockPerson, mockDriver],
      isLoading: false,
      error: null,
      getPersonById: vi.fn((id: string) => {
        if (id === 'person-1') return mockPerson;
        if (id === 'person-2') return mockDriver;
        return undefined;
      }),
    } as unknown as ReturnType<typeof usePersonContext>);
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [transportWithDriver],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });

    // Somebody driving is a journey whether or not the leg asked for a pickup
    expect(screen.getByText('rides.driver:')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText(/transports\.driver/)).not.toBeInTheDocument();
  });

  it('renders transport with mode only (no number)', () => {
    const modeOnlyTransport: Transport = {
      ...mockArrival,
      transportMode: 'train',
      transportNumber: undefined,
    };
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [modeOnlyTransport],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByText('transports.modes.train')).toBeInTheDocument();
  });

  it('renders transport with number only (no mode)', () => {
    const numberOnlyTransport: Transport = {
      ...mockArrival,
      transportMode: undefined,
      transportNumber: 'TGV789',
    };
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [numberOnlyTransport],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByText('TGV789')).toBeInTheDocument();
  });

  it('renders past transports section with toggle', () => {
    const pastTransport: Transport = {
      ...mockArrival,
      id: 'transport-past' as Transport['id'],
      datetime: daysFromNow(-30, 10, 0) as Transport['datetime'],
      location: 'Old Airport',
    };
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [mockArrival, pastTransport],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });

    // The upcoming one is listed; the past one is behind the collapsed section
    expect(screen.getByText('Paris CDG')).toBeInTheDocument();
    expect(screen.queryByText('Old Airport')).not.toBeInTheDocument();
    // The toggle states how many are hidden, and reports itself as collapsed
    expect(screen.getByText(/transports\.pastTransports \(1\)/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /transports\.pastTransports/ }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands past transports section when toggled', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const pastTransport: Transport = {
      ...mockArrival,
      id: 'transport-past' as Transport['id'],
      datetime: daysFromNow(-30, 10, 0) as Transport['datetime'],
      location: 'Old Airport',
    };
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [mockArrival, pastTransport],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });
    expect(screen.queryByText('Old Airport')).not.toBeInTheDocument();

    const pastToggle = screen.getByRole('button', {
      name: /transports\.pastTransports/,
    });
    await user.click(pastToggle);

    expect(screen.getByText('Old Airport')).toBeInTheDocument();
    expect(pastToggle).toHaveAttribute('aria-expanded', 'true');
    expect(pastToggle).toHaveAttribute('aria-controls', 'past-transports-section');
    expect(document.getElementById('past-transports-section')).toBeInTheDocument();
  });

  it('renders transport with bus mode', () => {
    const busTransport: Transport = {
      ...mockArrival,
      transportMode: 'bus',
      location: 'Bus Station',
    };
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [busTransport],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByText('Bus Station')).toBeInTheDocument();
    expect(screen.getByText('transports.modes.bus')).toBeInTheDocument();
  });

  it('handles loading state for persons', () => {
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [],
      isLoading: true,
      error: null,
      getPersonById: vi.fn(),
    } as unknown as ReturnType<typeof usePersonContext>);
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders needsPickup badge on transport without driver', () => {
    const pickupNeedsTransport: Transport = {
      ...mockArrival,
      needsPickup: true,
      driverId: undefined,
    };
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [pickupNeedsTransport],
      departures: [],
      upcomingPickups: [],
      nowMs: Date.now(),
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportListPage />, { withProviders: false });
    expect(screen.getByText('transports.needsPickup')).toBeInTheDocument();
  });
});
