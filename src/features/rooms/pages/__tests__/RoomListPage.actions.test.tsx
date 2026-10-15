/**
 * @fileoverview What the rooms board writes when a room's own menu is used.
 *
 * The board's drag handling has its own file. This one covers the per-room
 * actions behind the card menu — edit, duplicate, delete — and the two places
 * the page refuses: a room that filled up between the render and the tap, and a
 * suggestion that cannot be applied in full.
 *
 * `RoomCard` is the real component here, because the menu is the gesture under
 * test.
 *
 * @module features/rooms/pages/__tests__/RoomListPage.actions.test
 */

import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { render, screen, waitFor, within } from '@/test/utils';
import type { Person, Room, RoomAssignment, Trip } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn();
const mockDeleteRoom = vi.fn();
const mockDuplicateRoom = vi.fn();
const mockCreateAssignment = vi.fn();
const mockUpdateAssignment = vi.fn();
const mockSuccessToast = vi.fn();
const { mockNotifyError } = vi.hoisted(() => ({ mockNotifyError: vi.fn() }));

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
  capacity: 1,
  order: 0,
};

const alice: Person = {
  id: 'person-1' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
  stayStartDate: '2026-07-02' as Person['stayStartDate'],
  stayEndDate: '2026-07-08' as Person['stayEndDate'],
};

const aliceInMaster: RoomAssignment = {
  id: 'a-1' as RoomAssignment['id'],
  tripId: 'trip-1' as RoomAssignment['tripId'],
  roomId: mockRoom.id,
  personId: alice.id,
  startDate: '2026-07-02' as RoomAssignment['startDate'],
  endDate: '2026-07-08' as RoomAssignment['endDate'],
};

let currentSearchParams = new URLSearchParams('view=card');
let assignmentsByRoom: RoomAssignment[] = [];
let storedGuestPersonId: string | undefined;

// ============================================================================
// Mocks
// ============================================================================

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-1' }),
    useSearchParams: () => [currentSearchParams, vi.fn()],
  };
});

vi.mock('@/lib/notifications', () => ({
  notify: { error: mockNotifyError, warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('@/contexts/RoomContext', () => ({ useRoomContext: vi.fn() }));
vi.mock('@/contexts/AssignmentContext', () => ({ useAssignmentContext: vi.fn() }));
vi.mock('@/contexts/PersonContext', () => ({ usePersonContext: vi.fn() }));
vi.mock('@/contexts/TransportContext', () => ({ useTransportContext: vi.fn() }));

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: mockSuccessToast, errorToast: vi.fn() }),
  useToday: () => ({ today: new Date(2026, 6, 5) }),
}));

vi.mock('@/features/rooms/components/RoomDialog', () => ({
  RoomDialog: ({
    open,
    roomId,
    onOpenChange,
  }: {
    open: boolean;
    roomId?: string;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="room-dialog" data-room-id={roomId ?? ''}>
        <button data-testid="close-room-dialog" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null,
}));

vi.mock('@/features/rooms/components/RoomAssignmentSection', () => ({
  RoomAssignmentSection: () => <div data-testid="room-assignment-section" />,
}));

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
      <div data-testid="allocation-suggestion-dialog">
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
            ).catch(() => {
              // The page re-throws so the real dialog stays open on what is left.
            });
          }}
        />
      </div>
    ) : null,
}));

vi.mock('@/features/rooms/components/QuickAssignmentDialog', () => ({
  QuickAssignmentDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="quick-assignment-dialog">
        <button data-testid="close-quick-assign" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null,
}));

vi.mock('@/lib/sharing/guest-identity', () => ({
  getTripGuestPersonId: () => storedGuestPersonId,
}));

vi.mock('@/features/rooms/components/RoomOccupancyTimeline', () => ({
  RoomOccupancyTimeline: () => null,
  ROOM_TIMELINE_LABEL_COLUMN_WIDTH_PX: 140,
}));

vi.mock('@/features/rooms/components/DroppableRoom', () => ({
  DroppableRoom: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
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

function resetMocks(): void {
  vi.mocked(useTripContext).mockReturnValue({
    currentTrip: mockTrip,
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
    trips: [mockTrip],
    checkConnection: vi.fn(),
  } as unknown as ReturnType<typeof useTripContext>);
  vi.mocked(useRoomContext).mockReturnValue({
    rooms: [mockRoom],
    isLoading: false,
    error: null,
    deleteRoom: mockDeleteRoom,
    duplicateRoom: mockDuplicateRoom,
  } as unknown as ReturnType<typeof useRoomContext>);
  vi.mocked(useAssignmentContext).mockReturnValue({
    assignments: [],
    isLoading: false,
    error: null,
    getAssignmentsByRoom: vi.fn(() => assignmentsByRoom),
    createAssignment: mockCreateAssignment,
    updateAssignment: mockUpdateAssignment,
  } as unknown as ReturnType<typeof useAssignmentContext>);
  vi.mocked(usePersonContext).mockReturnValue({
    persons: [alice],
    isLoading: false,
    error: null,
    getPersonById: vi.fn((id: string) => (id === alice.id ? alice : undefined)),
  } as unknown as ReturnType<typeof usePersonContext>);
  vi.mocked(useTransportContext).mockReturnValue({
    arrivals: [],
    departures: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useTransportContext>);
}

function renderPage() {
  return render(<RoomListPage />, { withProviders: false });
}

/** Opens the room card's menu and picks one of its items. */
async function chooseOnRoom(
  user: ReturnType<typeof render>['user'],
  item: string | RegExp,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: /common.openMenu/i }));
  await user.click(await screen.findByText(item));
}

// ============================================================================
// Tests
// ============================================================================

describe('RoomListPage — the room menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams('view=card');
    assignmentsByRoom = [];
    storedGuestPersonId = undefined;
    mockDeleteRoom.mockResolvedValue(undefined);
    mockDuplicateRoom.mockResolvedValue({ ...mockRoom, id: 'room-copy', name: 'Master Bedroom 2' });
    mockCreateAssignment.mockResolvedValue(undefined);
    mockSetCurrentTrip.mockResolvedValue(undefined);
    resetMocks();
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the dialog on the room that was edited', async () => {
    const { user } = renderPage();

    await chooseOnRoom(user, 'common.edit');

    expect(await screen.findByTestId('room-dialog')).toHaveAttribute('data-room-id', mockRoom.id);
  });

  it('forgets the room once the dialog closes', async () => {
    const { user } = renderPage();

    await chooseOnRoom(user, 'common.edit');
    await user.click(await screen.findByTestId('close-room-dialog'));

    await waitFor(() => {
      expect(screen.queryByTestId('room-dialog')).not.toBeInTheDocument();
    });
  });

  it('duplicates a room and names the copy it made', async () => {
    const { user } = renderPage();

    await chooseOnRoom(user, /rooms.duplicate/);

    await waitFor(() => {
      expect(mockDuplicateRoom).toHaveBeenCalledWith(mockRoom.id);
    });
    expect(mockSuccessToast).toHaveBeenCalled();
  });

  it('does not claim a copy that was never made', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDuplicateRoom.mockRejectedValue(new Error('offline'));
    const { user } = renderPage();

    await chooseOnRoom(user, /rooms.duplicate/);

    await waitFor(() => {
      expect(mockDuplicateRoom).toHaveBeenCalled();
    });
    expect(mockSuccessToast).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('deletes a room once the prompt is confirmed', async () => {
    const { user } = renderPage();

    await chooseOnRoom(user, 'common.delete');
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: /common.delete/i }));

    await waitFor(() => {
      expect(mockDeleteRoom).toHaveBeenCalledWith(mockRoom.id);
    });
    expect(mockSuccessToast).toHaveBeenCalled();
  });

  it('does not claim a deletion that failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDeleteRoom.mockRejectedValue(new Error('offline'));
    const { user } = renderPage();

    await chooseOnRoom(user, 'common.delete');
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: /common.delete/i }));

    await waitFor(() => {
      expect(mockDeleteRoom).toHaveBeenCalled();
    });
    expect(mockSuccessToast).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('RoomListPage — claiming a room', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams('view=card');
    assignmentsByRoom = [];
    storedGuestPersonId = alice.id;
    mockCreateAssignment.mockResolvedValue(undefined);
    mockSetCurrentTrip.mockResolvedValue(undefined);
    resetMocks();
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the dates dialog for the guest holding the device', async () => {
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: /rooms.claimRoom/i }));

    expect(await screen.findByTestId('quick-assignment-dialog')).toBeInTheDocument();
  });

  it('closes that dialog again without writing', async () => {
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: /rooms.claimRoom/i }));
    await user.click(await screen.findByTestId('close-quick-assign'));

    await waitFor(() => {
      expect(screen.queryByTestId('quick-assignment-dialog')).not.toBeInTheDocument();
    });
    expect(mockCreateAssignment).not.toHaveBeenCalled();
  });

  it('refuses a room that filled up while the page was open', async () => {
    const { user } = renderPage();

    // The room holds one bed; somebody else took it between the paint and the tap.
    assignmentsByRoom = [aliceInMaster];

    await user.click(await screen.findByRole('button', { name: /rooms.claimRoom/i }));

    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalledWith('rooms.roomJustFilled');
    });
    expect(screen.queryByTestId('quick-assignment-dialog')).not.toBeInTheDocument();
  });
});
