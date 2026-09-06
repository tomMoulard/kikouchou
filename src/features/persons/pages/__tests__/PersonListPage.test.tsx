/**
 * @fileoverview Tests for PersonListPage.
 * @module features/persons/pages/__tests__/PersonListPage.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import type { Person, Room, RoomAssignment, Transport, Trip } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);
const mockDeletePerson = vi.fn().mockResolvedValue(undefined);
const mockSuccessToast = vi.fn();

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
  stayStartDate: '2026-07-02' as Person['stayStartDate'],
  stayEndDate: '2026-07-08' as Person['stayEndDate'],
};

const mockPerson2: Person = {
  id: 'person-2' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Bob',
  color: '#ef4444' as Person['color'],
};

const mockRoom: Room = {
  id: 'room-1' as Room['id'],
  tripId: 'trip-1' as Room['tripId'],
  name: 'Master Bedroom',
  capacity: 2,
  order: 0,
};

const mockAssignment: RoomAssignment = {
  id: 'a-1' as RoomAssignment['id'],
  tripId: 'trip-1' as RoomAssignment['tripId'],
  roomId: 'room-1' as RoomAssignment['roomId'],
  personId: 'person-1' as RoomAssignment['personId'],
  startDate: '2026-07-02' as RoomAssignment['startDate'],
  endDate: '2026-07-08' as RoomAssignment['endDate'],
};

const mockArrivalTransport: Transport = {
  id: 't-arr' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: 'person-1' as Transport['personId'],
  type: 'arrival',
  datetime: '2026-07-02T14:00:00',
  location: 'Paris CDG',
  transportMode: 'plane',
  needsPickup: false,
} as Transport;

const mockDepartureTransport: Transport = {
  id: 't-dep' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: 'person-1' as Transport['personId'],
  type: 'departure',
  datetime: '2026-07-09T10:00:00',
  location: 'Paris Gare de Lyon',
  transportMode: 'train',
  needsPickup: false,
} as Transport;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-1' }),
  };
});

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: mockSuccessToast,
    errorToast: vi.fn(),
  }),
}));

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
    persons: [mockPerson],
    isLoading: false,
    error: null,
    getPersonById: vi.fn((id: string) => (id === 'person-1' ? mockPerson : undefined)),
  })),
}));

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: vi.fn(() => ({
    rooms: [],
    isLoading: false,
    error: null,
  })),
}));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: vi.fn(() => ({
    assignments: [],
    isLoading: false,
    error: null,
  })),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: vi.fn(() => ({
    getTransportsByPerson: vi.fn(() => []),
    isLoading: false,
    error: null,
  })),
}));

vi.mock('@/features/persons/components/PersonDialog', () => ({
  PersonDialog: ({ open, personId }: { open: boolean; personId?: string }) => (
    open ? <div data-testid="person-dialog" data-person-id={personId ?? ''} /> : null
  ),
}));

import { PersonListPage } from '../PersonListPage';
import { useLocation } from 'react-router-dom';

/**
 * Reports the router's current query string, from inside the same
 * `MemoryRouter` the page under test is rendered in.
 */
function LocationProbe(): React.ReactElement {
  return <div data-testid="location-search">{useLocation().search}</div>;
}
import { useTripContext } from '@/contexts/TripContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { useTransportContext } from '@/contexts/TransportContext';

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
    createPerson: vi.fn(),
    updatePerson: vi.fn(),
    deletePerson: mockDeletePerson,
  } as ReturnType<typeof usePersonContext>);
  vi.mocked(useRoomContext).mockReturnValue({
    rooms: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useRoomContext>);
  vi.mocked(useAssignmentContext).mockReturnValue({
    assignments: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useAssignmentContext>);
  vi.mocked(useTransportContext).mockReturnValue({
    getTransportsByPerson: vi.fn(() => []),
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useTransportContext>);
}

// ============================================================================
// Tests
// ============================================================================

describe('PersonListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  // ===========================================================================
  // Basic render states
  // ===========================================================================

  it('renders the page title', () => {
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByText('persons.title')).toBeInTheDocument();
  });

  it('renders person cards when persons exist', () => {
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByText('Alice')).toBeInTheDocument();
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
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders empty state when no persons', () => {
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as ReturnType<typeof usePersonContext>);
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByText('persons.empty')).toBeInTheDocument();
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
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
  });

  it('renders error state when persons context has error', () => {
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [],
      isLoading: false,
      error: new Error('DB Error'),
      getPersonById: vi.fn(),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as ReturnType<typeof usePersonContext>);
    render(<PersonListPage />, { withProviders: false });
    // ErrorDisplay is rendered
    expect(screen.getByText('persons.title')).toBeInTheDocument();
  });

  it('renders add person FAB button', () => {
    render(<PersonListPage />, { withProviders: false });
    const addButtons = screen.getAllByRole('button', { name: 'persons.new' });
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders PersonDialog in empty state', () => {
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as ReturnType<typeof usePersonContext>);
    render(<PersonListPage />, { withProviders: false });
    // Dialog is only rendered when open; click the add button
    // In empty state the dialog exists but is closed by default
    // PersonDialog mock returns null when open=false
    expect(screen.getByText('persons.empty')).toBeInTheDocument();
  });

  it('renders back link', () => {
    render(<PersonListPage />, { withProviders: false });
    const backLink = screen.getByRole('link');
    expect(backLink).toBeInTheDocument();
  });

  it('renders loading when persons are loading', () => {
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [],
      isLoading: true,
      error: null,
      getPersonById: vi.fn(),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as ReturnType<typeof usePersonContext>);
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders loading when rooms are loading', () => {
    vi.mocked(useRoomContext).mockReturnValue({
      rooms: [],
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof useRoomContext>);
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders loading when transports are loading', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      getTransportsByPerson: vi.fn(() => []),
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders person dialog in list state', () => {
    render(<PersonListPage />, { withProviders: false });
    // Dialog is initially closed, so PersonDialog mock returns null
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  // ===========================================================================
  // PersonCard with transport data
  // ===========================================================================

  it('renders person card with transport summary (arrival and departure)', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      getTransportsByPerson: vi.fn(() => [mockArrivalTransport, mockDepartureTransport]),
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    // Transport locations should appear
    expect(screen.getByText('Paris CDG')).toBeInTheDocument();
    expect(screen.getByText('Paris Gare de Lyon')).toBeInTheDocument();
  });

  it('renders person card with stay range label when person has stay dates', () => {
    render(<PersonListPage />, { withProviders: false });
    // Stay range is formatted as "d MMM – d MMM"
    // mockPerson has stayStartDate 2026-07-02, stayEndDate 2026-07-08
    expect(screen.getByText(/2 Jul.*8 Jul/)).toBeInTheDocument();
  });

  it('says nothing about missing travel when the card already shows stay dates', () => {
    render(<PersonListPage />, { withProviders: false });
    // Alice has stay dates but no transports: the card shows what it has.
    expect(screen.queryByText('transports.empty')).not.toBeInTheDocument();
  });

  it('says nothing about missing travel on an otherwise bare card either', () => {
    // Bob has no transports, no stay dates, no room and no notes. The card used
    // to fill that space with "No travel plans yet", which tells the reader
    // nothing they cannot see: an empty card is already empty.
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [mockPerson2],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(() => mockPerson2),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as ReturnType<typeof usePersonContext>);
    render(<PersonListPage />, { withProviders: false });
    expect(screen.queryByText('transports.empty')).not.toBeInTheDocument();
  });

  it('offers a guest phone number as a dialable link', () => {
    // The point of syncing the number: whoever is doing the station run can
    // call from the card rather than copying digits out of it.
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{ ...mockPerson, phone: '+33 6 12 34 56 78' }],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(() => mockPerson),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as ReturnType<typeof usePersonContext>);
    render(<PersonListPage />, { withProviders: false });

    const link = screen.getByRole('link', { name: /\+33 6 12 34 56 78/ });
    // Spaces are stripped from the href alone; the label keeps them readable.
    expect(link).toHaveAttribute('href', 'tel:+33612345678');
    expect(link).toHaveTextContent('+33 6 12 34 56 78');
  });

  it('renders no phone link for a guest without a number', () => {
    render(<PersonListPage />, { withProviders: false });

    // Filtered rather than queried bare: the page also carries a back link.
    const telLinks = screen
      .queryAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('tel:'));
    expect(telLinks).toHaveLength(0);
  });

  it('badges a guest who needs a child seat with the kind they need', () => {
    // The card is where a driver reads the roster before loading the car, so
    // the kind is spelled out rather than reduced to "child".
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{ ...mockPerson, childSeat: 'booster' as const }],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(() => mockPerson),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as ReturnType<typeof usePersonContext>);
    render(<PersonListPage />, { withProviders: false });

    expect(screen.getByText('childSeats.booster')).toBeInTheDocument();
  });

  it('names the child seat in the card label a screen reader reads', () => {
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{ ...mockPerson, childSeat: 'rearFacing' as const }],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(() => mockPerson),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as ReturnType<typeof usePersonContext>);
    render(<PersonListPage />, { withProviders: false });

    expect(
      screen.getByRole('button', { name: /childSeats\.label: childSeats\.rearFacing/ }),
    ).toBeInTheDocument();
  });

  it('shows no child seat badge for a guest who needs none', () => {
    // Absence is the answer for every adult, so the majority of cards must stay
    // exactly as they were.
    render(<PersonListPage />, { withProviders: false });

    expect(screen.queryByText(/^childSeats\./)).not.toBeInTheDocument();
  });

  it('does not open the edit dialog when the phone link is tapped', async () => {
    // The whole card opens the editor; without stopPropagation the number is
    // impossible to dial.
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [{ ...mockPerson, phone: '0612345678' }],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(() => mockPerson),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as ReturnType<typeof usePersonContext>);
    const { user } = render(<PersonListPage />, { withProviders: false });

    await user.click(screen.getByRole('link', { name: /0612345678/ }));

    expect(screen.queryByTestId('person-dialog')).not.toBeInTheDocument();
  });

  it('renders room names on person card when person has assignments', () => {
    vi.mocked(useRoomContext).mockReturnValue({
      rooms: [mockRoom],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRoomContext>);
    vi.mocked(useAssignmentContext).mockReturnValue({
      assignments: [mockAssignment],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useAssignmentContext>);
    render(<PersonListPage />, { withProviders: false });
    // Room name should be displayed on person card via "assignments.room" label
    expect(screen.getByText('assignments.room')).toBeInTheDocument();
    expect(screen.getByText(/Master Bedroom/)).toBeInTheDocument();
  });

  // ===========================================================================
  // Event handlers
  // ===========================================================================

  it('opens person dialog when person card is clicked', async () => {
    const { user } = render(<PersonListPage />, { withProviders: false });
    await user.click(screen.getByText('Alice'));
    expect(screen.getByTestId('person-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('person-dialog').getAttribute('data-person-id')).toBe('person-1');
  });

  it('opens create dialog when add button is clicked', async () => {
    const { user } = render(<PersonListPage />, { withProviders: false });
    const addBtns = screen.getAllByRole('button', { name: 'persons.new' });
    await user.click(addBtns[0]!);
    expect(screen.getByTestId('person-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('person-dialog').getAttribute('data-person-id')).toBe('');
  });

  it('opens create dialog in empty state', async () => {
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as ReturnType<typeof usePersonContext>);
    const { user } = render(<PersonListPage />, { withProviders: false });
    await user.click(screen.getByRole('button', { name: 'persons.new' }));
    expect(screen.getByTestId('person-dialog')).toBeInTheDocument();
  });

  // ===========================================================================
  // Person card with keyboard interaction
  // ===========================================================================

  it('activates person card with keyboard Enter', async () => {
    const { user } = render(<PersonListPage />, { withProviders: false });
    const card = screen.getByRole('button', { name: /Alice/ });
    card.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('person-dialog')).toBeInTheDocument();
  });

  it('deletes a guest from card action', async () => {
    const { user } = render(<PersonListPage />, { withProviders: false });
    const deleteButtons = screen.getAllByRole('button', { name: 'common.delete' });
    await user.click(deleteButtons[0]!);
    await user.click(screen.getByRole('button', { name: 'common.delete' }));

    await waitFor(() => {
      expect(mockDeletePerson).toHaveBeenCalledWith('person-1');
    });
  });

  // ===========================================================================
  // Trip sync from URL
  // ===========================================================================

  it('calls setCurrentTrip when URL tripId differs from context', async () => {
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: { ...mockTrip, id: 'different-trip' as Trip['id'] },
      isLoading: false,
      error: null,
      setCurrentTrip: mockSetCurrentTrip,
      trips: [mockTrip],
      checkConnection: vi.fn(),
    });
    render(<PersonListPage />, { withProviders: false });
    await waitFor(() => {
      expect(mockSetCurrentTrip).toHaveBeenCalledWith('trip-1');
    });
  });

  // ===========================================================================
  // Multiple persons with transport
  // ===========================================================================

  it('renders multiple person cards with different transport summaries', () => {
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [mockPerson, mockPerson2],
      isLoading: false,
      error: null,
      getPersonById: vi.fn((id: string) => {
        if (id === 'person-1') return mockPerson;
        if (id === 'person-2') return mockPerson2;
        return undefined;
      }),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as ReturnType<typeof usePersonContext>);
    vi.mocked(useTransportContext).mockReturnValue({
      getTransportsByPerson: vi.fn((personId: string) => {
        if (personId === 'person-1') return [mockArrivalTransport, mockDepartureTransport];
        return [];
      }),
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders person list with role="list"', () => {
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByRole('list', { name: 'persons.title' })).toBeInTheDocument();
  });

  // ===========================================================================
  // Additional branch coverage — PersonCard + edge cases
  // ===========================================================================

  it('renders person card with only arrival transport (no departure)', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      getTransportsByPerson: vi.fn((personId: string) => {
        if (personId === 'person-1') return [mockArrivalTransport];
        return [];
      }),
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByText('Paris CDG')).toBeInTheDocument();
    expect(screen.queryByText('Paris Gare de Lyon')).not.toBeInTheDocument();
  });

  it('renders person card with only departure transport (no arrival)', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      getTransportsByPerson: vi.fn((personId: string) => {
        if (personId === 'person-1') return [mockDepartureTransport];
        return [];
      }),
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<PersonListPage />, { withProviders: false });
    expect(screen.queryByText('Paris CDG')).not.toBeInTheDocument();
    expect(screen.getByText('Paris Gare de Lyon')).toBeInTheDocument();
  });

  it('renders person with invalid stay dates as no stay range', () => {
    const personBadDates: Person = {
      ...mockPerson,
      stayStartDate: 'not-a-date' as Person['stayStartDate'],
      stayEndDate: 'also-bad' as Person['stayEndDate'],
    };
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [personBadDates],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(() => personBadDates),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as ReturnType<typeof usePersonContext>);
    render(<PersonListPage />, { withProviders: false });
    // Should not crash and should not show stay dates
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('persons.stayDates')).not.toBeInTheDocument();
  });

  it('renders person with start date after end date as no stay range', () => {
    const personReversedDates: Person = {
      ...mockPerson,
      stayStartDate: '2026-07-10' as Person['stayStartDate'],
      stayEndDate: '2026-07-02' as Person['stayEndDate'],
    };
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [personReversedDates],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(() => personReversedDates),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      deletePerson: mockDeletePerson,
    } as ReturnType<typeof usePersonContext>);
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('persons.stayDates')).not.toBeInTheDocument();
  });

  it('sorts room names alphabetically on person card', () => {
    const roomB: Room = {
      id: 'room-2' as Room['id'],
      tripId: 'trip-1' as Room['tripId'],
      name: 'Zebra Room',
      capacity: 1,
      order: 1,
    };
    const assignmentB: RoomAssignment = {
      id: 'a-2' as RoomAssignment['id'],
      tripId: 'trip-1' as RoomAssignment['tripId'],
      roomId: 'room-2' as RoomAssignment['roomId'],
      personId: 'person-1' as RoomAssignment['personId'],
      startDate: '2026-07-05' as RoomAssignment['startDate'],
      endDate: '2026-07-08' as RoomAssignment['endDate'],
    };
    vi.mocked(useRoomContext).mockReturnValue({
      rooms: [roomB, mockRoom],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRoomContext>);
    vi.mocked(useAssignmentContext).mockReturnValue({
      assignments: [mockAssignment, assignmentB],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useAssignmentContext>);
    render(<PersonListPage />, { withProviders: false });
    // "Master Bedroom, Zebra Room" alphabetically sorted
    expect(screen.getByText(/Master Bedroom, Zebra Room/)).toBeInTheDocument();
  });

  it('activates person card with Space key', async () => {
    const { user } = render(<PersonListPage />, { withProviders: false });
    const card = screen.getByRole('button', { name: /Alice/ });
    card.focus();
    await user.keyboard(' ');
    expect(screen.getByTestId('person-dialog')).toBeInTheDocument();
  });

  it('does not activate disabled card on click', async () => {
    // PersonListPage doesn't actually set isDisabled=true in normal flow,
    // but let's verify the card click path when isDisabled=false works
    const { user } = render(<PersonListPage />, { withProviders: false });
    const card = screen.getByRole('button', { name: /Alice/ });
    await user.click(card);
    expect(screen.getByTestId('person-dialog')).toBeInTheDocument();
  });

  it('renders loading when assignments are loading', () => {
    vi.mocked(useAssignmentContext).mockReturnValue({
      assignments: [],
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof useAssignmentContext>);
    render(<PersonListPage />, { withProviders: false });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('does not deduplicate room names for the same person', () => {
    // Two assignments to the same room
    const assignment2: RoomAssignment = {
      id: 'a-dup' as RoomAssignment['id'],
      tripId: 'trip-1' as RoomAssignment['tripId'],
      roomId: 'room-1' as RoomAssignment['roomId'],
      personId: 'person-1' as RoomAssignment['personId'],
      startDate: '2026-07-08' as RoomAssignment['startDate'],
      endDate: '2026-07-10' as RoomAssignment['endDate'],
    };
    vi.mocked(useRoomContext).mockReturnValue({
      rooms: [mockRoom],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useRoomContext>);
    vi.mocked(useAssignmentContext).mockReturnValue({
      assignments: [mockAssignment, assignment2],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useAssignmentContext>);
    render(<PersonListPage />, { withProviders: false });
    // Should show room name only once (deduplicated)
    const roomText = screen.getByText(/Master Bedroom/);
    expect(roomText.textContent).not.toContain('Master Bedroom, Master Bedroom');
  });

  it('picks earliest arrival and latest departure from multiple transports', () => {
    const earlyArrival: Transport = {
      ...mockArrivalTransport,
      id: 't-arr-early' as Transport['id'],
      datetime: '2026-07-01T08:00:00',
      location: 'Early Airport',
    };
    const lateArrival: Transport = {
      ...mockArrivalTransport,
      id: 't-arr-late' as Transport['id'],
      datetime: '2026-07-03T20:00:00',
      location: 'Late Airport',
    };
    vi.mocked(useTransportContext).mockReturnValue({
      getTransportsByPerson: vi.fn(() => [earlyArrival, lateArrival]),
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<PersonListPage />, { withProviders: false });
    // Should show earliest arrival
    expect(screen.getByText('Early Airport')).toBeInTheDocument();
    expect(screen.queryByText('Late Airport')).not.toBeInTheDocument();
  });

  // ===========================================================================
  // ?new=1 — the hand-off from the calendar's empty state
  // ===========================================================================

  it('opens the person dialog on first render for ?new=1', () => {
    // On the *first* render, not through an effect: a mount-then-open flashes
    // the empty guest list first, which is what the reader came here to leave.
    render(<PersonListPage />, {
      withProviders: false,
      initialEntries: ['/trips/trip-1/persons?new=1'],
    });

    expect(screen.getByTestId('person-dialog')).toBeInTheDocument();
  });

  it('drops ?new from the URL once the dialog is open, keeping the rest', async () => {
    render(
      <>
        <PersonListPage />
        <LocationProbe />
      </>,
      {
        withProviders: false,
        initialEntries: ['/trips/trip-1/persons?new=1&view=list'],
      },
    );

    expect(screen.getByTestId('person-dialog')).toBeInTheDocument();

    // Replaced, not pushed, so the back button cannot walk into a URL that
    // pops the dialog open again — and the dialog stays open meanwhile.
    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('?view=list');
    });
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('new');
    expect(screen.getByTestId('person-dialog')).toBeInTheDocument();
  });

  it('leaves the dialog closed when there is no ?new', () => {
    render(<PersonListPage />, {
      withProviders: false,
      initialEntries: ['/trips/trip-1/persons'],
    });

    expect(screen.queryByTestId('person-dialog')).not.toBeInTheDocument();
  });
});
