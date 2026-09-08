/**
 * @fileoverview Tests for RoomListPage.
 * @module features/rooms/pages/__tests__/RoomListPage.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import type { Person, Room, RoomAssignment, Transport, Trip } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);
const mockDeleteRoom = vi.fn().mockResolvedValue(undefined);
const mockCreateAssignment = vi.fn().mockResolvedValue(undefined);
const mockUpdateAssignment = vi.fn().mockResolvedValue(undefined);
const mockGetAssignmentsByRoom = vi.fn(() => []);
const mockSuccessToast = vi.fn();
const mockSetSearchParams = vi.fn();

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

const mockRoom: Room = {
  id: 'room-1' as Room['id'],
  tripId: 'trip-1' as Room['tripId'],
  name: 'Master Bedroom',
  capacity: 2,
  order: 0,
};

const mockRoom2: Room = {
  id: 'room-2' as Room['id'],
  tripId: 'trip-1' as Room['tripId'],
  name: 'Guest Room',
  capacity: 3,
  order: 1,
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

const mockAssignment: RoomAssignment = {
  id: 'a-1' as RoomAssignment['id'],
  tripId: 'trip-1' as RoomAssignment['tripId'],
  roomId: 'room-1' as RoomAssignment['roomId'],
  personId: 'person-1' as RoomAssignment['personId'],
  startDate: '2026-07-02' as RoomAssignment['startDate'],
  endDate: '2026-07-08' as RoomAssignment['endDate'],
};

const mockArrival: Transport = {
  id: 't-arr-1' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: 'person-2' as Transport['personId'],
  type: 'arrival',
  datetime: '2026-07-03T14:00:00',
  location: 'Paris CDG',
  transportMode: 'plane',
  needsPickup: false,
} as Transport;

const mockDeparture: Transport = {
  id: 't-dep-1' as Transport['id'],
  tripId: 'trip-1' as Transport['tripId'],
  personId: 'person-2' as Transport['personId'],
  type: 'departure',
  datetime: '2026-07-09T10:00:00',
  location: 'Paris CDG',
  transportMode: 'plane',
  needsPickup: false,
} as Transport;

let currentSearchParams = new URLSearchParams('view=card');

/** The guest this browser is, as the sharing identity store would report it. */
let storedGuestPersonId: string | undefined = undefined;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-1' }),
    useSearchParams: () => [currentSearchParams, mockSetSearchParams],
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

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: vi.fn(() => ({
    rooms: [mockRoom],
    isLoading: false,
    error: null,
    deleteRoom: mockDeleteRoom,
  })),
}));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: vi.fn(() => ({
    assignments: [],
    isLoading: false,
    error: null,
    getAssignmentsByRoom: mockGetAssignmentsByRoom,
    createAssignment: mockCreateAssignment,
    updateAssignment: mockUpdateAssignment,
  })),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(() => ({
    persons: [mockPerson],
    isLoading: false,
    error: null,
    getPersonById: vi.fn((id: string) => {
      if (id === 'person-1') return mockPerson;
      if (id === 'person-2') return mockPerson2;
      return undefined;
    }),
  })),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: vi.fn(() => ({
    arrivals: [],
    departures: [],
    isLoading: false,
    error: null,
  })),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({
    notifySuccess: mockSuccessToast,
    errorToast: vi.fn(),
  }),
  useToday: () => ({ today: new Date(2026, 6, 5) }),
}));

// Mock child components to reduce complexity
vi.mock('@/features/rooms/components/RoomDialog', () => ({
  RoomDialog: ({ open, roomId }: { open: boolean; roomId?: string }) => (
    open ? <div data-testid="room-dialog" data-room-id={roomId ?? ''} /> : null
  ),
}));

vi.mock('@/features/rooms/components/RoomAssignmentSection', () => ({
  RoomAssignmentSection: () => <div data-testid="room-assignment-section" />,
}));

// The review dialog has its own tests; here it stands for the hand-off — what
// the page proposed, and what it writes when the reader says yes.
vi.mock('@/features/rooms/components/AllocationSuggestionDialog', () => ({
  AllocationSuggestionDialog: ({
    open,
    stays,
    onApply,
  }: {
    open: boolean;
    stays: readonly {
      personId: string;
      roomId: string | null;
      startDate: string;
      endDate: string;
    }[];
    onApply: (
      stays: readonly {
        personId: string;
        roomId: string;
        startDate: string;
        endDate: string;
      }[],
    ) => Promise<void>;
  }) =>
    open ? (
      <div data-testid="allocation-suggestion-dialog" data-stays={JSON.stringify(stays)}>
        <button
          type="button"
          aria-label="apply-suggestion"
          onClick={() => {
            void onApply(
              stays
                .filter((stay) => stay.roomId !== null)
                .map((stay) => ({
                  personId: stay.personId,
                  roomId: stay.roomId as string,
                  startDate: stay.startDate,
                  endDate: stay.endDate,
                })),
            );
          }}
        />
      </div>
    ) : null,
}));

vi.mock('@/features/rooms/components/QuickAssignmentDialog', () => ({
  QuickAssignmentDialog: ({
    open,
    suggestedPersonId,
  }: {
    open: boolean;
    suggestedPersonId?: string;
  }) => (
    open ? (
      <div
        data-testid="quick-assignment-dialog"
        data-suggested-person={suggestedPersonId ?? ''}
      />
    ) : null
  ),
}));

// Which guest this browser has become, if any — the answer the claim flow acts
// for.
vi.mock('@/lib/sharing/guest-identity', () => ({
  getTripGuestPersonId: () => storedGuestPersonId,
}));

// The chips live inside the timeline, so the page's side of the pointer-free
// path is these two callbacks: the stub exposes each as a button.
vi.mock('@/features/rooms/components/RoomOccupancyTimeline', () => ({
  RoomOccupancyTimeline: ({
    onAssignGuestToRoom,
    onMoveAssignmentToRoom,
  }: {
    onAssignGuestToRoom?: (
      guest: { person: Person; startDate: string; endDate: string },
      roomId: string,
    ) => void;
    onMoveAssignmentToRoom?: (assignment: RoomAssignment, roomId: string) => void;
  }) => (
    <div data-testid="room-occupancy-timeline">
      <button
        type="button"
        aria-label="assign-from-chip"
        onClick={() =>
          onAssignGuestToRoom?.(
            { person: mockPerson, startDate: '2026-07-02', endDate: '2026-07-08' },
            'room-1',
          )
        }
      />
      <button
        type="button"
        aria-label="move-from-pill"
        onClick={() => onMoveAssignmentToRoom?.(mockAssignment, 'room-2')}
      />
    </div>
  ),
  // The page reserves the same width the frame does when deciding whether the
  // reading-width cap still fits, so the stub has to carry it too.
  ROOM_TIMELINE_LABEL_COLUMN_WIDTH_PX: 140,
}));

// Everything but the sensor list is left to the real dnd-kit; the list is the
// page's own decision about which inputs can move a chip.
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: ({
      children,
      sensors,
    }: {
      children: React.ReactNode;
      sensors?: readonly { sensor: { name: string } }[];
    }) => (
      <div
        data-testid="dnd-context"
        data-sensors={(sensors ?? []).map((entry) => entry.sensor.name).join(',')}
      >
        {children}
      </div>
    ),
  };
});

vi.mock('@/features/rooms/components/DraggableGuest', () => ({
  DraggableGuest: ({ person }: { person: Person }) => (
    <div data-testid="draggable-guest">{person.name}</div>
  ),
}));

vi.mock('@/features/rooms/components/DroppableRoom', () => ({
  DroppableRoom: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="droppable-room">{children}</div>
  ),
}));

import { RoomListPage } from '../RoomListPage';
import { useTripContext } from '@/contexts/TripContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';

// ============================================================================
// Helpers
// ============================================================================

function resetMocks() {
  currentSearchParams = new URLSearchParams('view=card');
  storedGuestPersonId = undefined;

  vi.mocked(useTripContext).mockReturnValue({
    currentTrip: mockTrip,
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
    trips: [mockTrip],
    checkConnection: vi.fn(),
  });
  vi.mocked(useRoomContext).mockReturnValue({
    rooms: [mockRoom],
    isLoading: false,
    error: null,
    deleteRoom: mockDeleteRoom,
  } as unknown as ReturnType<typeof useRoomContext>);
  vi.mocked(useAssignmentContext).mockReturnValue({
    assignments: [],
    isLoading: false,
    error: null,
    getAssignmentsByRoom: mockGetAssignmentsByRoom,
    createAssignment: mockCreateAssignment,
    updateAssignment: mockUpdateAssignment,
  } as unknown as ReturnType<typeof useAssignmentContext>);
  vi.mocked(usePersonContext).mockReturnValue({
    persons: [mockPerson],
    isLoading: false,
    error: null,
    getPersonById: vi.fn((id: string) => {
      if (id === 'person-1') return mockPerson;
      if (id === 'person-2') return mockPerson2;
      return undefined;
    }),
  } as unknown as ReturnType<typeof usePersonContext>);
  vi.mocked(useTransportContext).mockReturnValue({
    arrivals: [],
    departures: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useTransportContext>);
}

// ============================================================================
// Tests
// ============================================================================

describe('RoomListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Spy on localStorage to prevent the "all assigned" notification guard
    // from leaking between tests (the component writes to localStorage).
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    resetMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // Basic render states
  // ===========================================================================

  it('renders the page title', () => {
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByText('rooms.title')).toBeInTheDocument();
  });

  it('renders room cards when rooms exist', () => {
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByText('Master Bedroom')).toBeInTheDocument();
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
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders empty state when no rooms', () => {
    vi.mocked(useRoomContext).mockReturnValue({
      rooms: [],
      isLoading: false,
      error: null,
      deleteRoom: vi.fn(),
    } as unknown as ReturnType<typeof useRoomContext>);
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByText('rooms.empty')).toBeInTheDocument();
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
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
  });

  it('renders error state when room context has error', () => {
    vi.mocked(useRoomContext).mockReturnValue({
      rooms: [],
      isLoading: false,
      error: new Error('DB Error'),
      deleteRoom: vi.fn(),
    } as unknown as ReturnType<typeof useRoomContext>);
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByText('rooms.title')).toBeInTheDocument();
  });

  it('renders back link', () => {
    render(<RoomListPage />, { withProviders: false });
    const backLink = screen.getByRole('link');
    expect(backLink).toBeInTheDocument();
  });

  it('renders view toggle tabs (Cards / Timeline)', () => {
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByRole('radiogroup', { name: 'rooms.view.ariaLabel' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'rooms.view.cards' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'rooms.view.timeline' })).toBeInTheDocument();
  });

  it('renders FAB add room button', () => {
    render(<RoomListPage />, { withProviders: false });
    const addBtns = screen.getAllByRole('button', { name: /rooms\.new/i });
    expect(addBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('renders room list with role="list"', () => {
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByRole('list', { name: 'rooms.title' })).toBeInTheDocument();
  });

  it('renders loading when rooms context is loading', () => {
    vi.mocked(useRoomContext).mockReturnValue({
      rooms: [],
      isLoading: true,
      error: null,
      deleteRoom: vi.fn(),
    } as unknown as ReturnType<typeof useRoomContext>);
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders loading when transports are loading', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [],
      departures: [],
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof useTransportContext>);
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  // ===========================================================================
  // Timeline view
  // ===========================================================================

  it('renders timeline view when search param is view=timeline', () => {
    currentSearchParams = new URLSearchParams('view=timeline');
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByTestId('room-occupancy-timeline')).toBeInTheDocument();
  });

  // The page is normally capped so text does not run to the edges of a wide
  // monitor. Once the trip is too long to show at once, that cap is spending
  // width the day axis needs and the reader pays for it in scrolling.
  describe('timeline page width', () => {
    const pageOf = (): HTMLElement =>
      document.querySelector('div.py-6') as HTMLElement;

    it('keeps the reading-width cap for a trip that fits', () => {
      // Jul 1–10 is ten columns: 440px of days plus a 140px label column.
      currentSearchParams = new URLSearchParams('view=timeline');
      render(<RoomListPage />, { withProviders: false });

      expect(pageOf()).toHaveClass('container', 'max-w-7xl');
    });

    it('gives the timeline the whole page when the trip cannot fit', () => {
      const longTrip: Trip = {
        ...mockTrip,
        startDate: '2026-07-01' as Trip['startDate'],
        endDate: '2026-09-30' as Trip['endDate'],
      };
      vi.mocked(useTripContext).mockReturnValue({
        currentTrip: longTrip,
        isLoading: false,
        error: null,
        setCurrentTrip: mockSetCurrentTrip,
        trips: [longTrip],
        checkConnection: vi.fn(),
      });

      currentSearchParams = new URLSearchParams('view=timeline');
      render(<RoomListPage />, { withProviders: false });

      // `container` goes too: on a wide monitor it caps at 1536px, which is
      // still not the whole page.
      expect(pageOf()).not.toHaveClass('max-w-7xl');
      expect(pageOf()).not.toHaveClass('container');
      expect(pageOf()).toHaveClass('w-full');
    });

    it('keeps the cap in card view however long the trip is', () => {
      const longTrip: Trip = {
        ...mockTrip,
        endDate: '2026-09-30' as Trip['endDate'],
      };
      vi.mocked(useTripContext).mockReturnValue({
        currentTrip: longTrip,
        isLoading: false,
        error: null,
        setCurrentTrip: mockSetCurrentTrip,
        trips: [longTrip],
        checkConnection: vi.fn(),
      });

      currentSearchParams = new URLSearchParams('view=card');
      render(<RoomListPage />, { withProviders: false });

      // Cards are a reading layout; only the day axis needs the extra width.
      expect(pageOf()).toHaveClass('container', 'max-w-4xl');
    });
  });

  it('renders card view when search param is view=cards (back-compat)', () => {
    currentSearchParams = new URLSearchParams('view=cards');
    render(<RoomListPage />, { withProviders: false });
    // Should render card view (list), not timeline
    expect(screen.getByRole('list', { name: 'rooms.title' })).toBeInTheDocument();
    expect(screen.queryByTestId('room-occupancy-timeline')).not.toBeInTheDocument();
  });

  it('defaults to timeline view when no view param', () => {
    currentSearchParams = new URLSearchParams('');
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByTestId('room-occupancy-timeline')).toBeInTheDocument();
  });

  // ===========================================================================
  // "Suggest an allocation" (shown whenever a guest still needs a room)
  // ===========================================================================

  it('does not show the unassigned guests warning card', () => {
    render(<RoomListPage />, { withProviders: false });
    expect(screen.queryByText(/rooms\.unassignedGuests/)).not.toBeInTheDocument();
  });

  // The button used to appear only for a reader who already had an on-device
  // assistant model cached, which was nearly nobody — and the planner is a
  // plain local heuristic that never asked for a model in the first place.
  it('shows the suggest button whenever a guest needs a room', async () => {
    render(<RoomListPage />, { withProviders: false });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'rooms.suggest.button' }),
      ).toBeInTheDocument();
    });
  });

  it('reviews the allocation before writing any of it', async () => {
    const { user } = render(<RoomListPage />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: 'rooms.suggest.button' }));

    const dialog = await screen.findByTestId('allocation-suggestion-dialog');
    expect(JSON.parse(dialog.getAttribute('data-stays') ?? '[]')).toEqual([
      {
        personId: 'person-1',
        roomId: 'room-1',
        startDate: '2026-07-02',
        endDate: '2026-07-08',
        nights: [
          '2026-07-02',
          '2026-07-03',
          '2026-07-04',
          '2026-07-05',
          '2026-07-06',
          '2026-07-07',
        ],
        partyKey: 'person-1',
      },
    ]);
    expect(mockCreateAssignment).not.toHaveBeenCalled();
  });

  it('writes the reviewed allocation when the reader applies it', async () => {
    const { user } = render(<RoomListPage />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: 'rooms.suggest.button' }));
    await user.click(await screen.findByLabelText('apply-suggestion'));

    await waitFor(() => {
      expect(mockCreateAssignment).toHaveBeenCalledWith({
        roomId: 'room-1',
        personId: 'person-1',
        startDate: '2026-07-02',
        endDate: '2026-07-08',
      });
    });
    expect(mockSuccessToast).toHaveBeenCalledWith('rooms.suggest.applied');
  });

  it('derives unassigned guests from transports when no stay dates', async () => {
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [mockPerson2],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(() => mockPerson2),
    } as unknown as ReturnType<typeof usePersonContext>);
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [mockArrival],
      departures: [mockDeparture],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTransportContext>);
    currentSearchParams = new URLSearchParams('view=card');
    render(<RoomListPage />, { withProviders: false });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'rooms.suggest.button' }),
      ).toBeInTheDocument();
    });
  });

  it('keeps one continuous suggested stay across DST fallback nights', async () => {
    const originalTimezone = process.env.TZ;
    const dstGuest: Person = {
      ...mockPerson,
      id: 'person-dst' as Person['id'],
      name: 'DST Guest',
      stayStartDate: '2026-10-24' as Person['stayStartDate'],
      stayEndDate: '2026-10-27' as Person['stayEndDate'],
    };

    process.env.TZ = 'Europe/Paris';
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [dstGuest],
      isLoading: false,
      error: null,
      getPersonById: vi.fn((id: string) =>
        id === dstGuest.id ? dstGuest : undefined,
      ),
    } as unknown as ReturnType<typeof usePersonContext>);

    try {
      const { user } = render(<RoomListPage />, { withProviders: false });

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'rooms.suggest.button' }),
        ).toBeInTheDocument();
      });

      await user.click(
        screen.getByRole('button', { name: 'rooms.suggest.button' }),
      );
      await user.click(await screen.findByLabelText('apply-suggestion'));

      await waitFor(() => {
        expect(mockCreateAssignment).toHaveBeenCalledTimes(1);
      });

      expect(mockCreateAssignment).toHaveBeenCalledWith({
        roomId: mockRoom.id,
        personId: dstGuest.id,
        startDate: '2026-10-24',
        endDate: '2026-10-27',
      });
    } finally {
      process.env.TZ = originalTimezone;
    }
  });

  it('does not show the suggest button when all guests are assigned', async () => {
    vi.mocked(useAssignmentContext).mockReturnValue({
      assignments: [mockAssignment],
      isLoading: false,
      error: null,
      getAssignmentsByRoom: vi.fn(() => [mockAssignment]),
      createAssignment: mockCreateAssignment,
      updateAssignment: mockUpdateAssignment,
    } as unknown as ReturnType<typeof useAssignmentContext>);
    render(<RoomListPage />, { withProviders: false });
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'rooms.suggest.button' }),
      ).not.toBeInTheDocument();
    });
  });

  it('does not show the suggest button when no persons', async () => {
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(),
    } as unknown as ReturnType<typeof usePersonContext>);
    // Also need empty rooms to avoid the empty state
    vi.mocked(useRoomContext).mockReturnValue({
      rooms: [mockRoom],
      isLoading: false,
      error: null,
      deleteRoom: mockDeleteRoom,
    } as unknown as ReturnType<typeof useRoomContext>);
    render(<RoomListPage />, { withProviders: false });
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'rooms.suggest.button' }),
      ).not.toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Room occupancy sorting (available before full)
  // ===========================================================================

  it('sorts rooms with available spots before full rooms', () => {
    const fullAssignments = [
      { ...mockAssignment, id: 'a-x' as RoomAssignment['id'], roomId: 'room-1' as RoomAssignment['roomId'], personId: 'person-1' as RoomAssignment['personId'] },
      { ...mockAssignment, id: 'a-y' as RoomAssignment['id'], roomId: 'room-1' as RoomAssignment['roomId'], personId: 'person-2' as RoomAssignment['personId'] },
    ];

    vi.mocked(useRoomContext).mockReturnValue({
      rooms: [mockRoom, mockRoom2],
      isLoading: false,
      error: null,
      deleteRoom: mockDeleteRoom,
    } as unknown as ReturnType<typeof useRoomContext>);
    vi.mocked(useAssignmentContext).mockReturnValue({
      assignments: fullAssignments,
      isLoading: false,
      error: null,
      getAssignmentsByRoom: vi.fn((roomId: string) =>
        fullAssignments.filter((a) => a.roomId === roomId)
      ),
      createAssignment: mockCreateAssignment,
      updateAssignment: mockUpdateAssignment,
    } as unknown as ReturnType<typeof useAssignmentContext>);
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [mockPerson, mockPerson2],
      isLoading: false,
      error: null,
      getPersonById: vi.fn((id: string) => {
        if (id === 'person-1') return mockPerson;
        if (id === 'person-2') return mockPerson2;
        return undefined;
      }),
    } as unknown as ReturnType<typeof usePersonContext>);

    render(<RoomListPage />, { withProviders: false });
    // Both rooms should render
    expect(screen.getByText('Master Bedroom')).toBeInTheDocument();
    expect(screen.getByText('Guest Room')).toBeInTheDocument();
  });

  // ===========================================================================
  // Event handlers
  // ===========================================================================

  it('opens room dialog when add room button is clicked', async () => {
    const { user } = render(<RoomListPage />, { withProviders: false });
    // Click the first add button (the header one on desktop or FAB)
    const addBtns = screen.getAllByRole('button', { name: /rooms\.new/i });
    await user.click(addBtns[0]!);
    expect(screen.getByTestId('room-dialog')).toBeInTheDocument();
  });

  it('opens room dialog when empty state add button is clicked', async () => {
    vi.mocked(useRoomContext).mockReturnValue({
      rooms: [],
      isLoading: false,
      error: null,
      deleteRoom: vi.fn(),
    } as unknown as ReturnType<typeof useRoomContext>);
    const { user } = render(<RoomListPage />, { withProviders: false });
    await user.click(screen.getByRole('button', { name: 'rooms.new' }));
    expect(screen.getByTestId('room-dialog')).toBeInTheDocument();
  });

  // ===========================================================================
  // ?new=1 — the hand-off from the calendar's empty state
  // ===========================================================================

  it('opens the room dialog on first render for ?new=1', () => {
    // On the *first* render, not through an effect: a mount-then-open flashes
    // the empty room list first, which is what the reader came here to leave.
    currentSearchParams = new URLSearchParams('view=card&new=1');
    render(<RoomListPage />, { withProviders: false });

    expect(screen.getByTestId('room-dialog')).toBeInTheDocument();
  });

  it('drops ?new once it has opened the dialog, keeping the view', () => {
    currentSearchParams = new URLSearchParams('view=timeline&new=1');
    render(<RoomListPage />, { withProviders: false });

    expect(mockSetSearchParams).toHaveBeenCalledWith(expect.any(Function), {
      replace: true,
    });

    // Run the updater the page handed the router: `new` goes, `view` rides
    // along. Replacing rather than pushing is what stops the back button
    // walking into a URL that pops the dialog open again.
    const updater = mockSetSearchParams.mock.calls.at(-1)?.[0] as (
      previous: URLSearchParams,
    ) => URLSearchParams;
    const next = updater(new URLSearchParams('view=timeline&new=1'));
    expect(next.get('new')).toBeNull();
    expect(next.get('view')).toBe('timeline');
  });

  it('leaves the dialog closed when there is no ?new', () => {
    render(<RoomListPage />, { withProviders: false });

    expect(screen.queryByTestId('room-dialog')).not.toBeInTheDocument();
    expect(mockSetSearchParams).not.toHaveBeenCalled();
  });

  it('switches view when tab is clicked', async () => {
    const { user } = render(<RoomListPage />, { withProviders: false });
    const timelineTab = screen.getByRole('radio', { name: 'rooms.view.timeline' });
    await user.click(timelineTab);
    expect(mockSetSearchParams).toHaveBeenCalled();
  });

  // ===========================================================================
  // "All assigned" notification
  // ===========================================================================

  it('shows success toast when all guests become assigned', () => {
    vi.mocked(useAssignmentContext).mockReturnValue({
      assignments: [mockAssignment],
      isLoading: false,
      error: null,
      getAssignmentsByRoom: vi.fn(() => [mockAssignment]),
      createAssignment: mockCreateAssignment,
      updateAssignment: mockUpdateAssignment,
    } as unknown as ReturnType<typeof useAssignmentContext>);
    render(<RoomListPage />, { withProviders: false });
    expect(mockSuccessToast).toHaveBeenCalledWith('rooms.allGuestsAssigned');
  });

  it('does not show success toast twice for all assigned (ref suppression within session)', () => {
    // First render — toast fires
    vi.mocked(useAssignmentContext).mockReturnValue({
      assignments: [mockAssignment],
      isLoading: false,
      error: null,
      getAssignmentsByRoom: vi.fn(() => [mockAssignment]),
      createAssignment: mockCreateAssignment,
      updateAssignment: mockUpdateAssignment,
    } as unknown as ReturnType<typeof useAssignmentContext>);
    const { unmount } = render(<RoomListPage />, { withProviders: false });
    expect(mockSuccessToast).toHaveBeenCalledTimes(1);

    // Re-render same component should not fire again (ref persists)
    unmount();
  });

  // ===========================================================================
  // Date range filter display
  // ===========================================================================

  it('renders date range picker in card view', () => {
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByText('rooms.filterDates')).toBeInTheDocument();
  });

  it('does not render date range picker in timeline view', () => {
    currentSearchParams = new URLSearchParams('view=timeline');
    render(<RoomListPage />, { withProviders: false });
    expect(screen.queryByText('rooms.filterDates')).not.toBeInTheDocument();
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

    render(<RoomListPage />, { withProviders: false });
    await waitFor(() => {
      expect(mockSetCurrentTrip).toHaveBeenCalledWith('trip-1');
    });
  });

  // ===========================================================================
  // Person without dates needs a room for the whole trip
  // ===========================================================================

  // Regression: a guest who filled in neither stay dates nor travel needed a
  // room on no night at all, so they never reached this list and the page
  // offered no way to give them a bed — one of three guests, silently absent.
  it('treats a person with no dates or transports as needing a room for the trip', async () => {
    const personNoDates: Person = {
      id: 'person-no-dates' as Person['id'],
      tripId: 'trip-1' as Person['tripId'],
      name: 'Charlie',
      color: '#22c55e' as Person['color'],
    };
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [personNoDates],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(() => personNoDates),
    } as unknown as ReturnType<typeof usePersonContext>);
    vi.mocked(useAssignmentContext).mockReturnValue({
      assignments: [],
      isLoading: false,
      error: null,
      getAssignmentsByRoom: vi.fn(() => []),
      createAssignment: mockCreateAssignment,
      updateAssignment: mockUpdateAssignment,
    } as unknown as ReturnType<typeof useAssignmentContext>);

    render(<RoomListPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'rooms.suggest.button' })).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // Additional branch coverage tests
  // ===========================================================================

  it('handles back-compat "cards" view param as "card"', () => {
    currentSearchParams = new URLSearchParams('view=cards');
    render(<RoomListPage />, { withProviders: false });
    // Should render in card view - date range picker is visible in card view
    expect(screen.getByText('rooms.filterDates')).toBeInTheDocument();
  });

  it('renders rooms when some persons lack assignments', () => {
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [mockPerson, mockPerson2],
      isLoading: false,
      error: null,
      getPersonById: vi.fn((id: string) => {
        if (id === 'person-1') return mockPerson;
        if (id === 'person-2') return mockPerson2;
        return undefined;
      }),
    } as unknown as ReturnType<typeof usePersonContext>);
    vi.mocked(useAssignmentContext).mockReturnValue({
      assignments: [mockAssignment], // Only person-1 is assigned
      isLoading: false,
      error: null,
      getAssignmentsByRoom: vi.fn(() => [mockAssignment]),
      createAssignment: mockCreateAssignment,
      updateAssignment: mockUpdateAssignment,
    } as unknown as ReturnType<typeof useAssignmentContext>);
    currentSearchParams = new URLSearchParams('view=card');
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByText('Master Bedroom')).toBeInTheDocument();
    expect(screen.queryByText(/rooms\.unassignedGuests/)).not.toBeInTheDocument();
  });

  it('renders with trip that has no dates', () => {
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: {
        ...mockTrip,
        startDate: '' as Trip['startDate'],
        endDate: '' as Trip['endDate'],
      },
      isLoading: false,
      error: null,
      setCurrentTrip: mockSetCurrentTrip,
      trips: [mockTrip],
      checkConnection: vi.fn(),
    });
    currentSearchParams = new URLSearchParams('view=card');
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByText('rooms.title')).toBeInTheDocument();
  });

  it('renders multiple rooms with different capacities', () => {
    vi.mocked(useRoomContext).mockReturnValue({
      rooms: [mockRoom, mockRoom2],
      isLoading: false,
      error: null,
      deleteRoom: mockDeleteRoom,
    } as unknown as ReturnType<typeof useRoomContext>);
    currentSearchParams = new URLSearchParams('view=card');
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByText('Master Bedroom')).toBeInTheDocument();
    expect(screen.getByText('Guest Room')).toBeInTheDocument();
  });

  it('renders error state for rooms', () => {
    vi.mocked(useRoomContext).mockReturnValue({
      rooms: [],
      isLoading: false,
      error: new Error('Room fetch failed'),
      deleteRoom: mockDeleteRoom,
    } as unknown as ReturnType<typeof useRoomContext>);
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByText(/Room fetch failed/)).toBeInTheDocument();
  });

  it('handles loading state for rooms', () => {
    vi.mocked(useRoomContext).mockReturnValue({
      rooms: [],
      isLoading: true,
      error: null,
      deleteRoom: mockDeleteRoom,
    } as unknown as ReturnType<typeof useRoomContext>);
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders in timeline view when param is set', () => {
    currentSearchParams = new URLSearchParams('view=timeline');
    render(<RoomListPage />, { withProviders: false });
    // Timeline view should render - no date range filter
    expect(screen.queryByText('rooms.filterDates')).not.toBeInTheDocument();
    expect(screen.getByText('rooms.title')).toBeInTheDocument();
  });

  it('shows the suggest button for unassigned guests with stay dates in card view', async () => {
    const personWithDates: Person = {
      id: 'person-3' as Person['id'],
      tripId: 'trip-1' as Person['tripId'],
      name: 'Diana',
      color: '#22c55e' as Person['color'],
      stayStartDate: '2026-07-02' as Person['stayStartDate'],
      stayEndDate: '2026-07-08' as Person['stayEndDate'],
    };
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [personWithDates],
      isLoading: false,
      error: null,
      getPersonById: vi.fn(() => personWithDates),
    } as unknown as ReturnType<typeof usePersonContext>);
    vi.mocked(useAssignmentContext).mockReturnValue({
      assignments: [],
      isLoading: false,
      error: null,
      getAssignmentsByRoom: vi.fn(() => []),
      createAssignment: mockCreateAssignment,
      updateAssignment: mockUpdateAssignment,
    } as unknown as ReturnType<typeof useAssignmentContext>);
    currentSearchParams = new URLSearchParams('view=card');
    render(<RoomListPage />, { withProviders: false });
    expect(screen.queryByText(/rooms\.unassignedGuests/)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'rooms.suggest.button' }),
      ).toBeInTheDocument();
    });
  });

  it('renders transport context with arrivals and departures', () => {
    vi.mocked(useTransportContext).mockReturnValue({
      arrivals: [mockArrival],
      departures: [mockDeparture],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTransportContext>);
    currentSearchParams = new URLSearchParams('view=card');
    render(<RoomListPage />, { withProviders: false });
    expect(screen.getByText('rooms.title')).toBeInTheDocument();
  });

  // ===========================================================================
  // Assigning a room without a pointer
  // ===========================================================================

  describe('room assignment without a drag', () => {
    // A mouse sensor and a touch sensor were the whole list, so Space and the
    // arrow keys moved nothing: room assignment had no keyboard path at all.
    it('registers a keyboard sensor beside the pointer ones', () => {
      render(<RoomListPage />, { withProviders: false });

      const sensors = screen.getByTestId('dnd-context').getAttribute('data-sensors');
      expect(sensors).toContain('KeyboardSensor');
      expect(sensors).toContain('MouseSensor');
      expect(sensors).toContain('TouchSensor');
    });

    it('creates the assignment a guest chip menu asks for', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      currentSearchParams = new URLSearchParams('view=timeline');
      render(<RoomListPage />, { withProviders: false });

      await user.click(screen.getByLabelText('assign-from-chip'));

      await waitFor(() => {
        expect(mockCreateAssignment).toHaveBeenCalledWith({
          roomId: 'room-1',
          personId: 'person-1',
          startDate: '2026-07-02',
          endDate: '2026-07-08',
        });
      });
    });

    it('moves the assignment an occupied pill menu asks for', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      currentSearchParams = new URLSearchParams('view=timeline');
      render(<RoomListPage />, { withProviders: false });

      await user.click(screen.getByLabelText('move-from-pill'));

      await waitFor(() => {
        expect(mockUpdateAssignment).toHaveBeenCalledWith('a-1', { roomId: 'room-2' });
      });
    });
  });

  // ===========================================================================
  // Claiming a room
  // ===========================================================================

  describe('the cards view assignment button', () => {
    // The button opened a dialog with a guest selector listing everyone, so
    // "Claim this room" described a claim it never made.
    it('offers to assign a guest when the browser is nobody in particular', () => {
      render(<RoomListPage />, { withProviders: false });

      expect(screen.getByText('rooms.assignGuest')).toBeInTheDocument();
      expect(screen.queryByText('rooms.claimRoom')).not.toBeInTheDocument();
    });

    it('offers to claim the room for the guest this browser has become', () => {
      storedGuestPersonId = 'person-1';
      render(<RoomListPage />, { withProviders: false });

      expect(screen.getByText('rooms.claimRoom')).toBeInTheDocument();
    });

    it('opens the dialog on that guest, so a claim is one more press', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      storedGuestPersonId = 'person-1';
      render(<RoomListPage />, { withProviders: false });

      await user.click(screen.getByText('rooms.claimRoom'));

      expect(screen.getByTestId('quick-assignment-dialog')).toHaveAttribute(
        'data-suggested-person',
        'person-1',
      );
    });

    it('opens the dialog on nobody when the browser is nobody', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<RoomListPage />, { withProviders: false });

      await user.click(screen.getByText('rooms.assignGuest'));

      expect(screen.getByTestId('quick-assignment-dialog')).toHaveAttribute(
        'data-suggested-person',
        '',
      );
    });
  });
});
