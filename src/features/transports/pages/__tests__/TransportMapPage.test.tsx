/**
 * @fileoverview Tests for TransportMapPage.
 *
 * @module features/transports/pages/__tests__/TransportMapPage.test
 */

import type React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/utils';
import type { Person, Ride, Transport, Trip, Vehicle } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-1' }),
  };
});

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Paris',
  startDate: '2026-07-01' as Trip['startDate'],
  endDate: '2026-07-10' as Trip['endDate'],
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

/** The guest who drives, so a ride can name somebody the trip actually holds. */
const mockDriver: Person = {
  id: 'person-2' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Bruno',
  color: '#f97316' as Person['color'],
};

/** A second passenger, so "who else is in the car" has an answer. */
const mockPassenger: Person = {
  id: 'person-3' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Chloé',
  color: '#22c55e' as Person['color'],
};

const mockTransportWithCoords: Transport = {
  id: 'transport-1' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: 'person-1' as Transport['personId'],
  type: 'arrival',
  datetime: '2027-07-15T14:30:00',
  location: 'Paris CDG',
  needsPickup: false,
  transportMode: 'plane',
  coordinates: { lat: 49.0097, lon: 2.5479 },
};

const mockTransportNoCoords: Transport = {
  id: 'transport-2' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: 'person-1' as Transport['personId'],
  type: 'departure',
  datetime: '2027-07-20T10:00:00',
  location: 'Paris Orly',
  needsPickup: false,
  transportMode: 'plane',
};

const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);

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

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(() => ({
    persons: [mockPerson, mockDriver, mockPassenger],
    isLoading: false,
    error: null,
    getPersonById: vi.fn((id: string) => (id === 'person-1' ? mockPerson : undefined)),
  })),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: vi.fn(() => ({
    arrivals: [mockTransportWithCoords],
    departures: [mockTransportNoCoords],
    upcomingPickups: [],
    isLoading: false,
    error: null,
    deleteTransport: vi.fn(),
  })),
}));

// The page reads this context twice over: the popup's "needs pickup" chip asks
// whether the leg's ride has a driver, so it answers the same question as the
// transport list rather than the pre-ride `needsPickup && !driverId`, and the
// meeting-point markers are resolved from the rides and the cars. Empty by
// default: every case below this one was written against legs in no ride.
vi.mock('@/contexts/RideContext', () => ({
  useRideContext: vi.fn(() => ({
    rides: [],
    vehicles: [],
    isLoading: false,
    error: null,
  })),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: vi.fn(),
    errorToast: vi.fn(),
  }),
  // As on the list: unidentified, so the map plots the whole trip and the
  // scope filter renders its hint rather than a switch.
  useTripIdentity: () => ({
    myPersonId: undefined,
    source: undefined,
    isResolved: true,
    setMyPersonId: vi.fn(),
  }),
}));

// The scope filter resolves the trip's cars to answer "does this concern me",
// so the map now reads the rides too. Empty here: these tests are about pins.
vi.mock('@/contexts/RideContext', () => ({
  useRideContext: vi.fn(() => ({ rides: [], vehicles: [], isLoading: false })),
}));

// Mock MapView to avoid Leaflet in jsdom. It exposes both halves of a marker:
// the `popupContent` node and the `label` string, which is the marker's
// accessible name on the real map and was previously unobservable from a test.
// The polyline ids come out too, because "this leg is collected at that meeting
// point" is drawn as a line and is otherwise invisible to a test.
vi.mock('@/components/shared/MapView', () => ({
  MapView: ({
    markers,
    polylines,
  }: {
    markers: Array<{ popupContent?: React.ReactNode; label?: string }>;
    polylines?: Array<{ id: string }>;
  }) => (
    <div
      data-testid="map-view"
      data-markers={markers?.length ?? 0}
      data-polylines={(polylines ?? []).map((line) => line.id).join(',')}
    >
      Map View
      {markers?.map((m, i) => (
        <div key={i} data-testid={`marker-popup-${i}`} data-label={m.label}>
          {m.popupContent}
        </div>
      ))}
    </div>
  ),
}));

// Mock DirectionsButton
vi.mock('@/features/transports/components/DirectionsButton', () => ({
  DirectionsButton: () => <button data-testid="directions-btn">Directions</button>,
}));

// Mock PersonBadge
vi.mock('@/components/shared/PersonBadge', () => ({
  PersonBadge: ({ person }: { person: { name: string } }) => <span data-testid="person-badge">{person.name}</span>,
}));

import { TransportMapPage } from '../TransportMapPage';
import { useTripContext } from '@/contexts/TripContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useRideContext } from '@/contexts/RideContext';

// ============================================================================
// Tests
// ============================================================================

describe('TransportMapPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: mockTrip,
      isLoading: false,
      error: null,
      setCurrentTrip: mockSetCurrentTrip,
      trips: [mockTrip],
      checkConnection: vi.fn(),
    });
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [mockTransportWithCoords],
      departures: [mockTransportNoCoords],
      upcomingPickups: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);
    vi.mocked(useRideContext).mockReturnValue({
      rides: [],
      vehicles: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRideContext>);
  });

  it('renders the page with map when transports have coordinates', () => {
    render(<TransportMapPage />, { withProviders: false });
    expect(screen.getByText('transports.mapView')).toBeInTheDocument();
    expect(screen.getByTestId('map-view')).toBeInTheDocument();
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
    render(<TransportMapPage />, { withProviders: false });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders error when no trip found', () => {
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: null,
      isLoading: false,
      error: null,
      setCurrentTrip: mockSetCurrentTrip,
      trips: [],
      checkConnection: vi.fn(),
    });
    render(<TransportMapPage />, { withProviders: false });
    expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
  });

  it('renders empty state when no transports have coordinates', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [mockTransportNoCoords], // No coordinates
      departures: [],
      upcomingPickups: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportMapPage />, { withProviders: false });
    expect(screen.getByText('transports.noLocations')).toBeInTheDocument();
  });

  it('renders back to list button', () => {
    render(<TransportMapPage />, { withProviders: false });
    const backBtn = screen.getByRole('button', { name: /transports\.backToList/i });
    expect(backBtn).toBeInTheDocument();
  });

  it('renders error state when transports have error', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [],
      departures: [],
      upcomingPickups: [],
      isLoading: false,
      error: new Error('Transport fetch failed'),
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<TransportMapPage />, { withProviders: false });
    expect(screen.getByText('Transport fetch failed')).toBeInTheDocument();
  });

  it('renders map legend with arrival and departure indicators', () => {
    render(<TransportMapPage />, { withProviders: false });
    expect(screen.getByText('transports.arrivals')).toBeInTheDocument();
    expect(screen.getByText('transports.departures')).toBeInTheDocument();
    expect(screen.getByText('transports.mappedCount')).toBeInTheDocument();
  });

  it('renders list view button and navigates on click', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TransportMapPage />, { withProviders: false });

    const listBtn = screen.getByRole('button', { name: /transports\.listView/i });
    await user.click(listBtn);

    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-1/transports');
  });

  it('navigates to back to list when mobile back button is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TransportMapPage />, { withProviders: false });

    // There are two back to list buttons (header + mobile)
    const backBtns = screen.getAllByRole('button', { name: /transports\.backToList/i });
    await user.click(backBtns[backBtns.length - 1]!);

    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-1/transports');
  });

  it('renders departure transport markers', () => {
    const mockDeparture: Transport = {
      id: 'transport-dep' as Transport['id'],
      tripId: 'trip-1' as Transport['tripId'],
      personId: 'person-1' as Transport['personId'],
      type: 'departure',
      datetime: '2027-07-20T10:00:00',
      location: 'Paris Orly',
      needsPickup: false,
      transportMode: 'plane',
      coordinates: { lat: 48.7233, lon: 2.3795 },
    };

    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [],
      departures: [mockDeparture],
      upcomingPickups: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);

    render(<TransportMapPage />, { withProviders: false });
    expect(screen.getByTestId('map-view')).toBeInTheDocument();
    expect(screen.getByTestId('map-view').getAttribute('data-markers')).toBe('1');
  });

  it('renders transport with needsPickup and no driver', () => {
    const pickupTransport: Transport = {
      id: 'transport-pickup' as Transport['id'],
      tripId: 'trip-1' as Transport['tripId'],
      personId: 'person-1' as Transport['personId'],
      type: 'arrival',
      datetime: '2027-07-15T14:30:00',
      location: 'Paris CDG',
      needsPickup: true,
      transportMode: 'train',
      transportNumber: 'TGV 6789',
      coordinates: { lat: 49.0097, lon: 2.5479 },
    };

    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [pickupTransport],
      departures: [],
      upcomingPickups: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);

    render(<TransportMapPage />, { withProviders: false });

    // The branch this test is named for: a pickup with nobody driving it says
    // so in the popup. `getByTestId('map-view')` said nothing about it.
    const popup = screen.getByTestId('marker-popup-0');
    expect(popup).toHaveTextContent('transports.needsPickup');
    expect(popup).toHaveTextContent('Paris CDG');
    expect(popup).toHaveTextContent('TGV 6789');
    expect(popup).toHaveTextContent('transports.modes.train');
    // Datetime carries no offset, so it reads as this wall clock everywhere
    expect(popup).toHaveTextContent('Thu 15 Jul');
    expect(popup).toHaveTextContent('14:30');
  });

  it('renders map with multiple markers', () => {
    const transport2: Transport = {
      id: 'transport-3' as Transport['id'],
      tripId: 'trip-1' as Transport['tripId'],
      personId: 'person-1' as Transport['personId'],
      type: 'departure',
      datetime: '2027-07-20T10:00:00',
      location: 'Paris Orly',
      needsPickup: false,
      transportMode: 'car',
      coordinates: { lat: 48.7233, lon: 2.3795 },
    };

    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [mockTransportWithCoords],
      departures: [transport2],
      upcomingPickups: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);

    render(<TransportMapPage />, { withProviders: false });
    expect(screen.getByTestId('map-view').getAttribute('data-markers')).toBe('2');
  });

  it('renders unknown person name when person not found', () => {
    const orphanTransport: Transport = {
      id: 'transport-orphan' as Transport['id'],
      tripId: 'trip-1' as Transport['tripId'],
      personId: 'nonexistent-person' as Transport['personId'],
      type: 'arrival',
      datetime: '2027-07-15T14:30:00',
      location: 'Airport',
      needsPickup: false,
      coordinates: { lat: 49.0, lon: 2.5 },
    };

    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [orphanTransport],
      departures: [],
      upcomingPickups: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);

    render(<TransportMapPage />, { withProviders: false });

    // The fallback this test is named for: with no matching person the marker
    // still has to be findable on the map, named "unknown" rather than blank,
    // and the popup drops the person badge instead of rendering an empty one.
    const marker = screen.getByTestId('marker-popup-0');
    expect(marker).toHaveAttribute('data-label', 'common.unknown - Airport');
    expect(screen.queryByTestId('person-badge')).not.toBeInTheDocument();
    expect(marker).toHaveTextContent('Airport');
  });

  it('renders popup content with arrival type transport', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [mockTransportWithCoords],
      departures: [],
      upcomingPickups: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);

    render(<TransportMapPage />, { withProviders: false });
    const popup = screen.getByTestId('marker-popup-0');
    expect(popup).toBeInTheDocument();
    // Popup should show transport location
    expect(popup.textContent).toContain('Paris CDG');
    // Should show person name via PersonBadge mock
    expect(screen.getByTestId('person-badge')).toBeInTheDocument();
  });

  it('renders popup with departure type and needsPickup indicator', () => {
    const departurePickup: Transport = {
      id: 'transport-dep-pickup' as Transport['id'],
      tripId: 'trip-1' as Transport['tripId'],
      personId: 'person-1' as Transport['personId'],
      type: 'departure',
      datetime: '2027-07-20T10:00:00',
      location: 'Orly Airport',
      needsPickup: true,
      transportMode: 'bus',
      transportNumber: 'BUS-42',
      coordinates: { lat: 48.7233, lon: 2.3795 },
    };

    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [],
      departures: [departurePickup],
      upcomingPickups: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);

    render(<TransportMapPage />, { withProviders: false });
    const popup = screen.getByTestId('marker-popup-0');
    expect(popup.textContent).toContain('Orly Airport');
    expect(popup.textContent).toContain('BUS-42');
    // Should show needs pickup indicator
    expect(popup.textContent).toContain('transports.needsPickup');
  });

  it('renders popup with train transport mode', () => {
    const trainTransport: Transport = {
      id: 'transport-train' as Transport['id'],
      tripId: 'trip-1' as Transport['tripId'],
      personId: 'person-1' as Transport['personId'],
      type: 'arrival',
      datetime: '2027-07-15T14:30:00',
      location: 'Gare du Nord',
      needsPickup: false,
      transportMode: 'train',
      transportNumber: 'TGV 1234',
      coordinates: { lat: 48.88, lon: 2.35 },
    };

    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [trainTransport],
      departures: [],
      upcomingPickups: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);

    render(<TransportMapPage />, { withProviders: false });
    const popup = screen.getByTestId('marker-popup-0');
    expect(popup.textContent).toContain('Gare du Nord');
    expect(popup.textContent).toContain('TGV 1234');
  });

  it('renders popup with car transport mode', () => {
    const carTransport: Transport = {
      id: 'transport-car' as Transport['id'],
      tripId: 'trip-1' as Transport['tripId'],
      personId: 'person-1' as Transport['personId'],
      type: 'arrival',
      datetime: '2027-07-15T14:30:00',
      location: 'Parking Lot A',
      needsPickup: false,
      transportMode: 'car',
      coordinates: { lat: 48.88, lon: 2.35 },
    };

    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [carTransport],
      departures: [],
      upcomingPickups: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);

    render(<TransportMapPage />, { withProviders: false });
    const popup = screen.getByTestId('marker-popup-0');
    expect(popup).toHaveTextContent('Parking Lot A');
    expect(popup).toHaveTextContent('transports.modes.car');
  });

  it('renders popup with other transport mode', () => {
    const otherTransport: Transport = {
      id: 'transport-other' as Transport['id'],
      tripId: 'trip-1' as Transport['tripId'],
      personId: 'person-1' as Transport['personId'],
      type: 'arrival',
      datetime: '2027-07-15T14:30:00',
      location: 'Ferry Terminal',
      needsPickup: false,
      transportMode: 'other' as Transport['transportMode'],
      coordinates: { lat: 48.88, lon: 2.35 },
    };

    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [otherTransport],
      departures: [],
      upcomingPickups: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);

    render(<TransportMapPage />, { withProviders: false });
    const popup = screen.getByTestId('marker-popup-0');
    expect(popup).toHaveTextContent('Ferry Terminal');
    expect(popup).toHaveTextContent('transports.modes.other');
  });

  it('renders popup with invalid datetime gracefully', () => {
    const invalidDateTransport: Transport = {
      id: 'transport-bad-date' as Transport['id'],
      tripId: 'trip-1' as Transport['tripId'],
      personId: 'person-1' as Transport['personId'],
      type: 'arrival',
      datetime: 'not-a-date',
      location: 'Station X',
      needsPickup: false,
      coordinates: { lat: 48.88, lon: 2.35 },
    };

    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [invalidDateTransport],
      departures: [],
      upcomingPickups: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);

    render(<TransportMapPage />, { withProviders: false });

    // A row we cannot place in time still belongs on the map — but the popup
    // must show *no* date and *no* time rather than "Invalid Date"
    const popup = screen.getByTestId('marker-popup-0');
    expect(popup).toHaveTextContent('Station X');
    expect(popup.textContent).not.toMatch(/invalid/i);
    expect(popup.textContent).not.toMatch(/nan/i);
    expect(popup.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it('renders popup with transport that has driver assigned', () => {
    const assignedTransport: Transport = {
      id: 'transport-assigned' as Transport['id'],
      tripId: 'trip-1' as Transport['tripId'],
      personId: 'person-1' as Transport['personId'],
      type: 'arrival',
      datetime: '2027-07-15T14:30:00',
      location: 'Airport',
      needsPickup: true,
      driverId: 'person-1' as Transport['driverId'],
      coordinates: { lat: 48.88, lon: 2.35 },
    };

    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [assignedTransport],
      departures: [],
      upcomingPickups: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);

    render(<TransportMapPage />, { withProviders: false });

    const popup = screen.getByTestId('marker-popup-0');
    // A driver is assigned, so the pickup warning is gone…
    expect(popup.textContent).not.toContain('transports.needsPickup');
    // …while the rest of the popup still renders. Without this half, deleting
    // the popup entirely would also satisfy the assertion above.
    expect(popup).toHaveTextContent('Airport');
    expect(popup).toHaveTextContent('14:30');
    expect(screen.getByTestId('person-badge')).toHaveTextContent('Alice');
  });

  // Where everyone is heading. A map of stations with no "home" on it does not
  // answer the question the page is opened to answer.
  describe('trip location pin', () => {
    const tripWithCoordinates: Trip = {
      ...mockTrip,
      coordinates: { lat: 48.8566, lon: 2.3522 },
    };

    it('pins the trip location when the trip has coordinates', () => {
      vi.mocked(useTripContext).mockReturnValue({
        currentTrip: tripWithCoordinates,
        isLoading: false,
        error: null,
        setCurrentTrip: mockSetCurrentTrip,
        trips: [tripWithCoordinates],
        checkConnection: vi.fn(),
      });

      render(<TransportMapPage />, { withProviders: false });

      // It leads the marker list, so the transports keep their own ordering.
      expect(screen.getByTestId('marker-popup-0')).toHaveAttribute('data-label', 'Paris');
      expect(screen.getByTestId('map-legend-swatch-trip')).toBeInTheDocument();
    });

    it('leaves the map alone when the trip has no coordinates', () => {
      render(<TransportMapPage />, { withProviders: false });

      expect(screen.getByTestId('marker-popup-0')).not.toHaveAttribute('data-label', 'Paris');
      expect(screen.queryByTestId('map-legend-swatch-trip')).not.toBeInTheDocument();
    });

    it('does not count the trip pin as a mapped transport', () => {
      vi.mocked(useTripContext).mockReturnValue({
        currentTrip: tripWithCoordinates,
        isLoading: false,
        error: null,
        setCurrentTrip: mockSetCurrentTrip,
        trips: [tripWithCoordinates],
        checkConnection: vi.fn(),
      });

      render(<TransportMapPage />, { withProviders: false });

      // The legend counts transports, not pins — one arrival has coordinates.
      expect(screen.getByTestId('map-legend')).toHaveTextContent('transports.mappedCount');
      expect(screen.getByTestId('map-view')).toHaveAttribute('data-markers', '2');
    });
  });

  // The one place the driver is going, rather than three pins stacked on the
  // same station each telling a third of the story.
  describe('ride meeting points', () => {
    // Wall-clock literals with no offset, so they read the same in Paris, at
    // UTC and in Midway — a `…Z` literal would make these assertions pass or
    // fail by the runner's timezone.
    const MEET_DATETIME = '2027-07-15T15:00:00';

    const mockVehicle: Vehicle = {
      id: 'vehicle-1' as Vehicle['id'],
      tripId: 'trip-1' as Vehicle['tripId'],
      name: 'Espace de location',
      seatCount: 7,
    };

    /** A pick-up meeting at the airport, where both its legs land. */
    const rideAtAirport: Ride = {
      id: 'ride-1' as Ride['id'],
      tripId: 'trip-1' as Ride['tripId'],
      direction: 'pickup',
      meetDatetime: MEET_DATETIME as Ride['meetDatetime'],
      location: 'Paris CDG',
      coordinates: { lat: 49.0097, lon: 2.5479 },
      leadTimeMinutes: 30,
      driverId: mockDriver.id,
      vehicleId: mockVehicle.id,
    };

    const aliceLeg: Transport = {
      ...mockTransportWithCoords,
      datetime: '2027-07-15T14:55:00',
      rideId: rideAtAirport.id,
    };

    const chloeLeg: Transport = {
      id: 'transport-chloe' as Transport['id'],
      tripId: 'trip-1' as Transport['tripId'],
      personId: mockPassenger.id,
      type: 'arrival',
      datetime: '2027-07-15T15:05:00',
      location: 'Paris CDG',
      needsPickup: true,
      transportMode: 'train',
      coordinates: { lat: 49.0097, lon: 2.5479 },
      rideId: rideAtAirport.id,
    };

    function mockRides(rides: readonly Ride[], vehicles: readonly Vehicle[] = []): void {
      vi.mocked(useRideContext).mockReturnValue({
        rides,
        vehicles,
        isLoading: false,
        error: null,
      } as unknown as ReturnType<typeof useRideContext>);
    }

    function mockLegs(arrivals: readonly Transport[]): void {
      vi.mocked(useTransportContext).mockReturnValue({
        arrivals,
        departures: [],
        upcomingPickups: [],
        isLoading: false,
        error: null,
        deleteTransport: vi.fn(),
      } as unknown as ReturnType<typeof useTransportContext>);
    }

    it('pins the meeting point and names the whole car in its popup', () => {
      mockRides([rideAtAirport], [mockVehicle]);
      mockLegs([aliceLeg, chloeLeg]);

      render(<TransportMapPage />, { withProviders: false });

      // The rendez-vous pin is pushed LAST, after the two leg pins it serves,
      // and that ordering is the fix rather than a detail: all three sit on the
      // same coordinates — the car meets the plane where it lands — and Leaflet
      // ranks coincident markers by insertion order, so pushed first the
      // headline pin renders underneath the legs and cannot be clicked.
      const popup = screen.getByTestId('marker-popup-2');
      expect(popup).toHaveAttribute('data-label', 'rides.meetingPoint — Paris CDG');

      expect(popup).toHaveTextContent('rides.directions.pickup');
      // Meeting time and the driver's own alarm clock, 30 minutes before it.
      expect(popup).toHaveTextContent('rides.meetAt');
      expect(popup).toHaveTextContent('rides.leaveAt');
      expect(popup).toHaveTextContent('Espace de location');
      expect(popup).toHaveTextContent('rides.passengers');

      // Driver first, then everybody the car collects.
      const names = within(popup)
        .getAllByTestId('person-badge')
        .map((badge) => badge.textContent);
      expect(names).toEqual(['Bruno', 'Alice', 'Chloé']);

      expect(screen.getByTestId('map-legend-swatch-ride')).toBeInTheDocument();
    });

    it('does not put a marker at (0, 0) for a ride with no coordinates', () => {
      const rideWithoutCoordinates: Ride = {
        id: rideAtAirport.id,
        tripId: rideAtAirport.tripId,
        direction: rideAtAirport.direction,
        meetDatetime: rideAtAirport.meetDatetime,
        location: rideAtAirport.location,
        leadTimeMinutes: rideAtAirport.leadTimeMinutes,
        driverId: rideAtAirport.driverId,
        vehicleId: rideAtAirport.vehicleId,
      };

      mockRides([rideWithoutCoordinates], [mockVehicle]);
      mockLegs([aliceLeg]);

      render(<TransportMapPage />, { withProviders: false });

      // One pin only: Alice's own arrival. A ride nobody geocoded contributes
      // nothing rather than a pin in the Gulf of Guinea, which would drag the
      // centroid and `fitBounds` off the map with it.
      expect(screen.getByTestId('map-view')).toHaveAttribute('data-markers', '1');
      expect(screen.getByTestId('marker-popup-0')).toHaveAttribute(
        'data-label',
        'Alice - Paris CDG',
      );
      expect(screen.queryByTestId('ride-popup')).not.toBeInTheDocument();
      expect(screen.queryByTestId('map-legend-swatch-ride')).not.toBeInTheDocument();
    });

    it('leaves a legacy driverId-only leg exactly as it was', () => {
      const legacyLeg: Transport = {
        ...mockTransportWithCoords,
        needsPickup: true,
        driverId: mockDriver.id,
      };

      mockRides([]);
      mockLegs([legacyLeg]);

      render(<TransportMapPage />, { withProviders: false });

      // `resolveRides` reports the legacy leg as a one-passenger journey so
      // nothing downstream branches on storage shape. The map must not draw it
      // as a meeting point regardless: that pin would sit exactly on the
      // transport pin it was derived from and say the same thing twice.
      expect(screen.getByTestId('map-view')).toHaveAttribute('data-markers', '1');
      expect(screen.queryByTestId('ride-popup')).not.toBeInTheDocument();
      expect(screen.queryByTestId('transport-popup-ride')).not.toBeInTheDocument();
    });

    it('ties a leg to the meeting point it is collected at', () => {
      const distantRide: Ride = {
        ...rideAtAirport,
        coordinates: { lat: 48.8566, lon: 2.3522 },
        location: 'Paris centre',
      };

      mockRides([distantRide], [mockVehicle]);
      mockLegs([aliceLeg]);

      render(<TransportMapPage />, { withProviders: false });

      expect(screen.getByTestId('map-view').getAttribute('data-polylines')).toContain(
        'ride-ride-1-leg-transport-1',
      );
    });

    it('draws no line for a leg standing on the rendez-vous itself', () => {
      mockRides([rideAtAirport], [mockVehicle]);
      mockLegs([aliceLeg]);

      render(<TransportMapPage />, { withProviders: false });

      // The car meets the plane where it lands, so leg and meeting point share
      // one position. A zero-length polyline draws nothing and would only cost
      // a Leaflet layer per passenger.
      expect(screen.getByTestId('map-view')).toHaveAttribute('data-polylines', '');
    });

    it('names the ride in the leg′s own popup and drops the pickup warning', () => {
      mockRides([rideAtAirport], [mockVehicle]);
      mockLegs([chloeLeg]);

      render(<TransportMapPage />, { withProviders: false });

      // Marker 0 is the leg itself; the meeting point is pushed after it.
      const legPopup = screen.getByTestId('marker-popup-0');
      const ridePart = within(legPopup).getByTestId('transport-popup-ride');
      expect(ridePart).toHaveTextContent('Bruno');
      expect(ridePart).toHaveTextContent('rides.meetAt');

      // The leg is flagged `needsPickup`, but somebody is already driving it —
      // membership lives on `rideId`, so its own `driverId` stays empty and the
      // old test for that field alone would have shouted for a driver.
      expect(legPopup).not.toHaveTextContent('transports.needsPickup');
    });

    it('still shows the map when only the ride has been geocoded', () => {
      const legWithoutCoordinates: Transport = {
        id: aliceLeg.id,
        tripId: aliceLeg.tripId,
        personId: aliceLeg.personId,
        type: aliceLeg.type,
        datetime: aliceLeg.datetime,
        location: aliceLeg.location,
        needsPickup: aliceLeg.needsPickup,
        transportMode: aliceLeg.transportMode,
        rideId: aliceLeg.rideId,
      };

      mockRides([rideAtAirport], [mockVehicle]);
      mockLegs([legWithoutCoordinates]);

      render(<TransportMapPage />, { withProviders: false });

      // A rendez-vous is a location too: the empty state used to hide the whole
      // map from a trip whose guests never geocoded their stations.
      expect(screen.queryByText('transports.noLocations')).not.toBeInTheDocument();
      expect(screen.getByTestId('map-view')).toHaveAttribute('data-markers', '1');
      expect(screen.getByTestId('ride-popup')).toBeInTheDocument();
    });
  });
});
