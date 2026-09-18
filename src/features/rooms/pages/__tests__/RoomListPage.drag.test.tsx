/**
 * @fileoverview Asserts what a finished drag on the rooms board actually writes.
 *
 * The announcements test next door covers what the reader hears; this one
 * covers what the page does — which of the three drop shapes it recognises,
 * which view assigns straight away and which asks first, and what happens when
 * the write fails.
 *
 * The seam is the same: `DndContext` is captured on render, so a drop is a call
 * to `onDragEnd` with the payloads the draggables really carry, rather than a
 * synthetic pointer sequence jsdom cannot land accurately.
 *
 * @module features/rooms/pages/__tests__/RoomListPage.drag.test
 */

import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Active, DndContextProps, Over } from '@dnd-kit/core';
import { act } from 'react';

import { render, screen, waitFor } from '@/test/utils';
import type { Person, Room, RoomAssignment, Trip } from '@/types';
import type { DraggableGuestData } from '@/features/rooms/components/DraggableGuest';
import type { DraggableRoomAssignmentData } from '@/features/rooms/components/DraggableRoomAssignment';
import type { DroppableAssignmentData } from '@/features/rooms/components/DroppableAssignment';
import type { DroppableRoomData } from '@/features/rooms/components/DroppableRoom';

// ============================================================================
// Fixtures
// ============================================================================

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

const aliceInMaster: RoomAssignment = {
  id: 'a-1' as RoomAssignment['id'],
  tripId: 'trip-1' as RoomAssignment['tripId'],
  roomId: mockRoom.id,
  personId: mockPerson.id,
  startDate: '2026-07-02' as RoomAssignment['startDate'],
  endDate: '2026-07-08' as RoomAssignment['endDate'],
};

const bobInGuestRoom: RoomAssignment = {
  id: 'a-2' as RoomAssignment['id'],
  tripId: 'trip-1' as RoomAssignment['tripId'],
  roomId: mockRoom2.id,
  personId: 'person-2' as RoomAssignment['personId'],
  startDate: '2026-07-02' as RoomAssignment['startDate'],
  endDate: '2026-07-08' as RoomAssignment['endDate'],
};

// ============================================================================
// Mocks
// ============================================================================

const mockCreateAssignment = vi.fn().mockResolvedValue(undefined);
const mockUpdateAssignment = vi.fn().mockResolvedValue(undefined);
const mockSuccessToast = vi.fn();

/** The props the page last gave dnd-kit. */
let dndProps: DndContextProps | null = null;

let currentSearchParams = new URLSearchParams('view=card');

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
    useNavigate: () => vi.fn(),
    useParams: () => ({ tripId: 'trip-1' }),
    useSearchParams: () => [currentSearchParams, vi.fn()],
  };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({
    currentTrip: mockTrip,
    isLoading: false,
    error: null,
    setCurrentTrip: vi.fn(),
    trips: [mockTrip],
    checkConnection: vi.fn(),
  }),
}));

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => ({
    rooms: [mockRoom, mockRoom2],
    isLoading: false,
    error: null,
    deleteRoom: vi.fn(),
  }),
}));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => ({
    assignments: [aliceInMaster, bobInGuestRoom],
    isLoading: false,
    error: null,
    getAssignmentsByRoom: () => [],
    createAssignment: mockCreateAssignment,
    updateAssignment: mockUpdateAssignment,
  }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons: [mockPerson],
    isLoading: false,
    error: null,
    getPersonById: (id: string) => (id === mockPerson.id ? mockPerson : undefined),
  }),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => ({
    arrivals: [],
    departures: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: mockSuccessToast, errorToast: vi.fn() }),
  useToday: () => ({ today: new Date(2026, 6, 5) }),
}));

vi.mock('@/features/rooms/components/RoomDialog', () => ({ RoomDialog: () => null }));

vi.mock('@/features/rooms/components/RoomAssignmentSection', () => ({
  RoomAssignmentSection: () => null,
}));

vi.mock('@/features/rooms/components/QuickAssignmentDialog', () => ({
  QuickAssignmentDialog: ({
    open,
    person,
    roomId,
  }: {
    open: boolean;
    person: Person | null;
    roomId: string;
  }) =>
    open ? (
      <div
        data-testid="quick-assignment-dialog"
        data-person={person?.id ?? ''}
        data-room={roomId}
      />
    ) : null,
}));

vi.mock('@/features/rooms/components/RoomOccupancyTimeline', () => ({
  RoomOccupancyTimeline: () => null,
  ROOM_TIMELINE_LABEL_COLUMN_WIDTH_PX: 140,
}));

vi.mock('@/features/rooms/components/DroppableRoom', () => ({
  DroppableRoom: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}));

import { RoomListPage } from '../RoomListPage';

// ============================================================================
// Helpers
// ============================================================================

/** dnd-kit's `active` for an unhoused guest bar. */
function draggedAlice(): Active {
  const data: DraggableGuestData = {
    person: mockPerson,
    startDate: '2026-07-02',
    endDate: '2026-07-08',
  };

  return {
    id: `guest-${mockPerson.id}-2026-07-02-2026-07-08`,
    data: { current: data },
    rect: { current: { initial: null, translated: null } },
  } as unknown as Active;
}

/** dnd-kit's `active` for a stay already in a room. */
function draggedStay(assignment: RoomAssignment): Active {
  const data: DraggableRoomAssignmentData = { assignment };

  return {
    id: `assignment-${assignment.id}`,
    data: { current: data },
    rect: { current: { initial: null, translated: null } },
  } as unknown as Active;
}

/** dnd-kit's `over` for a room. */
function overRoom(room: Room): Over {
  const data: DroppableRoomData = { roomId: room.id };

  return {
    id: `room-${room.id}`,
    data: { current: data },
    rect: {},
    disabled: false,
  } as unknown as Over;
}

/** dnd-kit's `over` for another stay, which is the swap gesture. */
function overStay(assignmentId: RoomAssignment['id']): Over {
  const data: DroppableAssignmentData = { assignmentId };

  return {
    id: `assignment-${assignmentId}`,
    data: { current: data },
    rect: {},
    disabled: false,
  } as unknown as Over;
}

/** Renders the page and hands back the drag callbacks it registered. */
function renderBoard(): NonNullable<DndContextProps> {
  render(<RoomListPage />, { withProviders: false });

  expect(dndProps, 'RoomListPage rendered no DndContext').not.toBeNull();

  return dndProps!;
}

/** Drops `active` on `over`, inside `act` because the handlers set state. */
function drop(props: DndContextProps, active: Active, over: Over | null): void {
  act(() => {
    props.onDragEnd?.({ active, over } as Parameters<NonNullable<DndContextProps['onDragEnd']>>[0]);
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('RoomListPage drag handling', () => {
  beforeEach(() => {
    dndProps = null;
    currentSearchParams = new URLSearchParams('view=card');
    vi.clearAllMocks();
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes nothing when the guest is dropped outside any target', () => {
    const props = renderBoard();

    drop(props, draggedAlice(), null);

    expect(mockCreateAssignment).not.toHaveBeenCalled();
    expect(mockUpdateAssignment).not.toHaveBeenCalled();
  });

  it('asks for the dates before housing a guest in the cards view', async () => {
    const props = renderBoard();

    drop(props, draggedAlice(), overRoom(mockRoom));

    await waitFor(() => {
      expect(screen.getByTestId('quick-assignment-dialog')).toBeInTheDocument();
    });
    expect(screen.getByTestId('quick-assignment-dialog')).toHaveAttribute(
      'data-person',
      mockPerson.id,
    );
    expect(screen.getByTestId('quick-assignment-dialog')).toHaveAttribute(
      'data-room',
      mockRoom.id,
    );
    expect(mockCreateAssignment).not.toHaveBeenCalled();
  });

  it('houses the guest straight away in the timeline view', async () => {
    currentSearchParams = new URLSearchParams('view=timeline');
    const props = renderBoard();

    drop(props, draggedAlice(), overRoom(mockRoom));

    await waitFor(() => {
      expect(mockCreateAssignment).toHaveBeenCalledWith({
        roomId: mockRoom.id,
        personId: mockPerson.id,
        startDate: '2026-07-02',
        endDate: '2026-07-08',
      });
    });
    expect(mockSuccessToast).toHaveBeenCalledWith('assignments.createSuccess');
    expect(screen.queryByTestId('quick-assignment-dialog')).not.toBeInTheDocument();
  });

  it('keeps the board quiet when housing the guest fails', async () => {
    currentSearchParams = new URLSearchParams('view=timeline');
    mockCreateAssignment.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const props = renderBoard();

    drop(props, draggedAlice(), overRoom(mockRoom));

    await waitFor(() => {
      expect(mockCreateAssignment).toHaveBeenCalled();
    });
    expect(mockSuccessToast).not.toHaveBeenCalledWith('assignments.createSuccess');
  });

  it('moves an existing stay to the room it was dropped on', async () => {
    const props = renderBoard();

    drop(props, draggedStay(aliceInMaster), overRoom(mockRoom2));

    await waitFor(() => {
      expect(mockUpdateAssignment).toHaveBeenCalledWith(aliceInMaster.id, {
        roomId: mockRoom2.id,
      });
    });
    expect(mockSuccessToast).toHaveBeenCalledWith('assignments.updateSuccess');
  });

  it('does not write when a stay is dropped back on its own room', () => {
    const props = renderBoard();

    drop(props, draggedStay(aliceInMaster), overRoom(mockRoom));

    expect(mockUpdateAssignment).not.toHaveBeenCalled();
  });

  it('reports a failed move rather than claiming it landed', async () => {
    mockUpdateAssignment.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const props = renderBoard();

    drop(props, draggedStay(aliceInMaster), overRoom(mockRoom2));

    await waitFor(() => {
      expect(mockUpdateAssignment).toHaveBeenCalled();
    });
    expect(mockSuccessToast).not.toHaveBeenCalledWith('assignments.updateSuccess');
  });

  it('swaps the two rooms when a stay is dropped on another stay', async () => {
    const props = renderBoard();

    drop(props, draggedStay(aliceInMaster), overStay(bobInGuestRoom.id));

    await waitFor(() => {
      expect(mockUpdateAssignment).toHaveBeenCalledWith(aliceInMaster.id, {
        roomId: bobInGuestRoom.roomId,
      });
    });
    expect(mockUpdateAssignment).toHaveBeenCalledWith(bobInGuestRoom.id, {
      roomId: aliceInMaster.roomId,
    });
    expect(mockSuccessToast).toHaveBeenCalledWith('rooms.swapSuccess');
  });

  it('ignores a swap onto a stay that is no longer there', () => {
    const props = renderBoard();

    drop(props, draggedStay(aliceInMaster), overStay('gone' as RoomAssignment['id']));

    expect(mockUpdateAssignment).not.toHaveBeenCalled();
  });

  it('reports a failed swap rather than claiming it landed', async () => {
    mockUpdateAssignment.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const props = renderBoard();

    drop(props, draggedStay(aliceInMaster), overStay(bobInGuestRoom.id));

    await waitFor(() => {
      expect(mockUpdateAssignment).toHaveBeenCalled();
    });
    expect(mockSuccessToast).not.toHaveBeenCalledWith('rooms.swapSuccess');
  });

  it('survives a drag start and cancel for both draggable kinds', () => {
    const props = renderBoard();

    act(() => {
      props.onDragStart?.({ active: draggedAlice() } as Parameters<
        NonNullable<DndContextProps['onDragStart']>
      >[0]);
    });
    act(() => {
      props.onDragCancel?.({ active: draggedAlice() } as Parameters<
        NonNullable<DndContextProps['onDragCancel']>
      >[0]);
    });
    act(() => {
      props.onDragStart?.({ active: draggedStay(aliceInMaster) } as Parameters<
        NonNullable<DndContextProps['onDragStart']>
      >[0]);
    });
    act(() => {
      props.onDragCancel?.({ active: draggedStay(aliceInMaster) } as Parameters<
        NonNullable<DndContextProps['onDragCancel']>
      >[0]);
    });

    expect(mockCreateAssignment).not.toHaveBeenCalled();
    expect(mockUpdateAssignment).not.toHaveBeenCalled();
  });
});
