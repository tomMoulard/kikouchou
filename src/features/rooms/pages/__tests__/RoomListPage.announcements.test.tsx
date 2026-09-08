/**
 * @fileoverview Asserts the rooms board hands dnd-kit its own announcements.
 *
 * The sentences themselves are covered in
 * `features/rooms/utils/__tests__/dnd-announcements.test`. What is covered here
 * is the wiring the user actually hears through: without an `accessibility`
 * prop on `DndContext`, dnd-kit falls back to its default text and reads the
 * raw ids — "Draggable item guest-FH7oeUECm-… was dropped over droppable area
 * room-orvCHpZ2fFihDg9IxNikQ" — however good the builder is.
 *
 * The page's own data feeds the announcement, so this also pins the facts it
 * passes in: the room's free spots, and whether the current view assigns on
 * drop or asks for the dates first.
 *
 * @module features/rooms/pages/__tests__/RoomListPage.announcements.test
 */

import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Active, DndContextProps, Over } from '@dnd-kit/core';

import { renderWithRealI18n } from '@/test/utils';
import type { Person, Room, RoomAssignment, Trip } from '@/types';
import type { DraggableGuestData } from '@/features/rooms/components/DraggableGuest';
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
  id: 'orvCHpZ2fFihDg9IxNikQ' as Room['id'],
  tripId: 'trip-1' as Room['tripId'],
  name: 'Master Bedroom',
  capacity: 2,
  order: 0,
};

const mockPerson: Person = {
  id: 'FH7oeUECm' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
  stayStartDate: '2026-07-02' as Person['stayStartDate'],
  stayEndDate: '2026-07-08' as Person['stayEndDate'],
};

// ============================================================================
// Mocks
// ============================================================================

// The page speaks through a real i18next here: the suite-wide mock returns the
// key verbatim, and a key is not a sentence anybody hears.
vi.unmock('i18next');
vi.unmock('react-i18next');

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
    rooms: [mockRoom],
    isLoading: false,
    error: null,
    deleteRoom: vi.fn(),
  }),
}));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => ({
    assignments: [] as readonly RoomAssignment[],
    isLoading: false,
    error: null,
    getAssignmentsByRoom: () => [],
    createAssignment: vi.fn(),
    updateAssignment: vi.fn(),
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
  useOfflineAwareToast: () => ({ successToast: vi.fn(), errorToast: vi.fn() }),
  useToday: () => ({ today: new Date(2026, 6, 5) }),
}));

vi.mock('@/features/rooms/components/RoomDialog', () => ({ RoomDialog: () => null }));

vi.mock('@/features/rooms/components/RoomAssignmentSection', () => ({
  RoomAssignmentSection: () => null,
}));

vi.mock('@/features/rooms/components/QuickAssignmentDialog', () => ({
  QuickAssignmentDialog: () => null,
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

/** dnd-kit's `active` for Alice's unhoused bar. */
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

/** dnd-kit's `over` for the master bedroom. */
function overMasterBedroom(): Over {
  const data: DroppableRoomData = { roomId: mockRoom.id };

  return {
    id: `room-${mockRoom.id}`,
    data: { current: data },
    rect: {},
    disabled: false,
  } as unknown as Over;
}

/** Renders the page and returns the announcements it gave dnd-kit. */
async function renderAndReadAnnouncements(): Promise<
  NonNullable<NonNullable<DndContextProps['accessibility']>['announcements']>
> {
  await renderWithRealI18n(<RoomListPage />, { withProviders: false });

  const announcements = dndProps?.accessibility?.announcements;

  expect(announcements, 'RoomListPage passed no announcements to DndContext').toBeDefined();

  return announcements!;
}

// ============================================================================
// Tests
// ============================================================================

describe('RoomListPage drag announcements', () => {
  beforeEach(() => {
    dndProps = null;
    currentSearchParams = new URLSearchParams('view=card');
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('speaks names rather than the ids dnd-kit drags around', async () => {
    const announcements = await renderAndReadAnnouncements(),
      active = draggedAlice(),
      over = overMasterBedroom(),
      spoken = announcements.onDragEnd({ active, over }) ?? '';

    expect(spoken).toContain('Alice');
    expect(spoken).toContain('Master Bedroom');
    expect(spoken).not.toContain(String(active.id));
    expect(spoken).not.toContain(String(over.id));
  });

  it('counts the room’s free spots from the page’s own occupancy', async () => {
    currentSearchParams = new URLSearchParams('view=timeline');

    const announcements = await renderAndReadAnnouncements();

    // Two beds, nobody assigned, so one is left once Alice lands.
    expect(announcements.onDragEnd({ active: draggedAlice(), over: overMasterBedroom() })).toBe(
      'Alice moved to Master Bedroom, 1 spot left.',
    );
  });

  it('does not claim the guest moved in the view that confirms first', async () => {
    const announcements = await renderAndReadAnnouncements();

    expect(announcements.onDragEnd({ active: draggedAlice(), over: overMasterBedroom() })).toBe(
      'Alice dropped on Master Bedroom. Confirm the dates to finish the assignment.',
    );
  });
});
