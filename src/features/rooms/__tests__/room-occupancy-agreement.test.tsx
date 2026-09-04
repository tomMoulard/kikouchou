/**
 * @fileoverview Regression test for the three-way room-occupancy divergence.
 *
 * "How full is this room" used to be computed three incompatible ways — peak
 * headcount on the room cards, a count of timeline *lanes* on the timeline, and
 * a count of assignment *rows* in the guest wizard — and all three rendered
 * through labels that read the same to the user. One couple booked for two
 * nights of a ten-night trip therefore read as 2 people taken on the card, 1 on
 * the timeline and 1 in the wizard.
 *
 * This test renders all three surfaces from one fixture and asserts they agree.
 *
 * @module features/rooms/__tests__/room-occupancy-agreement.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { enUS } from 'date-fns/locale';

import { render, screen, waitFor } from '@/test/utils';
import {
  calculatePeakOccupancy,
  createHeadcountResolver,
} from '@/features/rooms/utils/capacity-utils';
import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  ShareId,
  Transport,
  Trip,
  TripId,
  UnixTimestamp,
} from '@/types';

// ============================================================================
// Fixture — derived from today so the assertions cannot rot, and built from
// local date parts so the test does not encode the machine's UTC offset.
// ============================================================================

/** `YYYY-MM-DD`, `offset` days from today, read in local time. */
function isoDaysFromToday(offset: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Ten nights, starting tomorrow. */
const TRIP_START = isoDaysFromToday(1);
const TRIP_END = isoDaysFromToday(11);

/** Two of those ten nights. */
const STAY_START = isoDaysFromToday(3);
const STAY_END = isoDaysFromToday(5);

/** Three beds, so a couple leaves exactly one spot open. */
const ROOM_CAPACITY = 3;
const EXPECTED_OCCUPANCY = 2;
const EXPECTED_SPOTS_OPEN = ROOM_CAPACITY - EXPECTED_OCCUPANCY;

const TRIP: Trip = {
  id: 'trip-1' as TripId,
  shareId: 'share-1' as ShareId,
  name: 'Test Trip',
  location: 'Paris',
  startDate: TRIP_START as ISODateString,
  endDate: TRIP_END as ISODateString,
  description: '',
  createdAt: 0 as UnixTimestamp,
  updatedAt: 0 as UnixTimestamp,
};

const ROOM: Room = {
  id: 'room-1' as RoomId,
  tripId: 'trip-1' as TripId,
  name: 'Master Bedroom',
  capacity: ROOM_CAPACITY,
  order: 0,
};

/** One guest row standing for two people. */
const COUPLE: Person = {
  id: 'person-1' as PersonId,
  tripId: 'trip-1' as TripId,
  name: 'Ada & Bob',
  color: '#3b82f6' as HexColor,
  headcount: 2,
};

const ASSIGNMENT: RoomAssignment = {
  id: 'assign-1' as RoomAssignmentId,
  tripId: 'trip-1' as TripId,
  roomId: 'room-1' as RoomId,
  personId: 'person-1' as PersonId,
  startDate: STAY_START as ISODateString,
  endDate: STAY_END as ISODateString,
};

// ============================================================================
// Mocks
// ============================================================================

/**
 * Renders every `t()` call as `key {sorted=options}` so the *numbers* a surface
 * shows survive into the DOM. The shared setup mock drops `count`, which is
 * precisely the value this test is about.
 */
vi.mock('react-i18next', () => {
  const translate = (
    key: string,
    second?: unknown,
    third?: unknown,
  ): string => {
    const options =
      second !== null && typeof second === 'object'
        ? (second as Record<string, unknown>)
        : third !== null && typeof third === 'object'
          ? (third as Record<string, unknown>)
          : undefined;
    if (!options) {
      return key;
    }
    const parts = Object.entries(options)
      .filter(([name]) => name !== 'context' && name !== 'defaultValue')
      .map(([name, value]) => `${name}=${String(value)}`)
      .sort();
    return parts.length > 0 ? `${key} {${parts.join(',')}}` : key;
  };

  return {
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', changeLanguage: vi.fn(), exists: () => true },
    }),
    Trans: ({ children }: { readonly children?: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: vi.fn() },
  };
});

// -- Guest wizard: identity comes from localStorage, which jsdom omits here --

const storedItems: Record<string, string> = {};

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => storedItems[key] ?? null,
    setItem: (key: string, value: string) => {
      storedItems[key] = value;
    },
    removeItem: (key: string) => {
      delete storedItems[key];
    },
    clear: () => {
      for (const key of Object.keys(storedItems)) {
        delete storedItems[key];
      }
    },
    get length() {
      return Object.keys(storedItems).length;
    },
    key: (index: number) => Object.keys(storedItems)[index] ?? null,
  },
  writable: true,
});

// -- Guest wizard: repository-only data access (AR-10, outside AppProviders) --

vi.mock('@/lib/db', () => ({
  getTripByShareId: vi.fn(),
  getRoomsByTripId: vi.fn(),
  getAssignmentsByTripId: vi.fn(),
  getPersonsByTripId: vi.fn(),
  checkAssignmentConflict: vi.fn(),
  createAssignment: vi.fn(),
}));

// -- Room list page: context-backed --

const mockSearchParams = new URLSearchParams('view=card');

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ tripId: 'trip-1', shareId: 'share-1' }),
    useSearchParams: () => [mockSearchParams, vi.fn()],
  };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({
    currentTrip: TRIP,
    isLoading: false,
    error: null,
    setCurrentTrip: vi.fn().mockResolvedValue(undefined),
    trips: [TRIP],
  }),
}));

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => ({
    rooms: [ROOM],
    isLoading: false,
    error: null,
    deleteRoom: vi.fn(),
  }),
}));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => ({
    assignments: [ASSIGNMENT],
    isLoading: false,
    error: null,
    getAssignmentsByRoom: (roomId: string) =>
      [ASSIGNMENT].filter((a) => a.roomId === roomId),
    getAssignmentsByPerson: (personId: string) =>
      [ASSIGNMENT].filter((a) => a.personId === personId),
    createAssignment: vi.fn(),
    updateAssignment: vi.fn(),
  }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons: [COUPLE],
    isLoading: false,
    error: null,
    getPersonById: (id: string) => (id === COUPLE.id ? COUPLE : undefined),
  }),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => ({
    arrivals: [] as Transport[],
    departures: [] as Transport[],
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({ successToast: vi.fn(), errorToast: vi.fn() }),
  useToday: () => ({ today: new Date() }),
}));

vi.mock('@/features/rooms/components/RoomDialog', () => ({
  RoomDialog: () => null,
}));

vi.mock('@/features/rooms/components/RoomAssignmentSection', () => ({
  RoomAssignmentSection: () => null,
}));

vi.mock('@/features/rooms/components/QuickAssignmentDialog', () => ({
  QuickAssignmentDialog: () => null,
}));

// -- Timeline: strip the drag-and-drop and viewport machinery --

vi.mock('@/features/rooms/components/DroppableRoom', () => ({
  DroppableRoom: ({ children }: { readonly children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/rooms/components/DraggableGuest', () => ({
  DraggableGuest: ({ person }: { readonly person: Person }) => <span>{person.name}</span>,
}));

vi.mock('@/features/rooms/components/DraggableRoomAssignment', () => ({
  DraggableRoomAssignment: ({ label }: { readonly label: string }) => <span>{label}</span>,
}));

vi.mock('@/features/rooms/components/DroppableAssignment', () => ({
  DroppableAssignment: ({ children }: { readonly children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/shared/TripTimelineFrame', () => ({
  TripTimelineFrame: ({
    children,
    ariaLabel,
  }: {
    readonly children: (viewport: Record<string, unknown>) => React.ReactNode;
    readonly ariaLabel: string;
  }) => (
    <div aria-label={ariaLabel}>
      {children({
        canvasWidth: 800,
        dayGridTemplateColumns: undefined,
        dayWidthPx: 80,
        useFractionalColumns: false,
        todayColumnIndex: -1,
        laneHeightPx: 36,
        labelColumnWidth: 140,
        labelsCollapsed: false,
      })}
    </div>
  ),
}));

// ============================================================================
// Imports after mocks
// ============================================================================

import {
  getAssignmentsByTripId,
  getPersonsByTripId,
  getRoomsByTripId,
  getTripByShareId,
} from '@/lib/db';
import RoomListPage from '@/features/rooms/pages/RoomListPage';
import { RoomOccupancyTimeline } from '@/features/rooms/components/RoomOccupancyTimeline';
import { RoomSelectionStepPage } from '@/features/sharing/pages/RoomSelectionStepPage';

// ============================================================================
// Helpers
// ============================================================================

/** Pulls the number a `{{occupied}} of {{capacity}}` style label rendered. */
function readOccupiedFromLabels(): number {
  const matches = document.body.textContent?.match(/occupied=(\d+)/g) ?? [];
  const values = new Set(matches.map((m) => Number(m.slice('occupied='.length))));
  expect(values.size).toBe(1);
  return [...values][0]!;
}

/** Pulls the number a `{{count}} spots open` style label rendered. */
function readSpotsOpenFromLabels(): number {
  const matches = document.body.textContent?.match(/rooms\.spotsOpen \{count=(\d+)\}/g) ?? [];
  expect(matches.length).toBeGreaterThan(0);
  const values = new Set(
    matches.map((m) => Number(/count=(\d+)/.exec(m)?.[1] ?? Number.NaN)),
  );
  expect(values.size).toBe(1);
  return [...values][0]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem(
    'kikouchou_guest_share-1',
    JSON.stringify({ personId: 'person-2', tripId: 'trip-1' }),
  );
  vi.mocked(getTripByShareId).mockResolvedValue(TRIP);
  vi.mocked(getRoomsByTripId).mockResolvedValue([ROOM]);
  vi.mocked(getAssignmentsByTripId).mockResolvedValue([ASSIGNMENT]);
  vi.mocked(getPersonsByTripId).mockResolvedValue([COUPLE]);
});

// ============================================================================
// Tests
// ============================================================================

describe('room occupancy agreement — one couple, part of the trip', () => {
  it('the shared helper counts the couple as two people', () => {
    const headcountOf = createHeadcountResolver([COUPLE]);
    expect(calculatePeakOccupancy([ASSIGNMENT], TRIP_START, TRIP_END, headcountOf)).toBe(
      EXPECTED_OCCUPANCY,
    );
  });

  it('the room card reports the couple as two of three spots taken', () => {
    render(<RoomListPage />, { withProviders: false });

    expect(readOccupiedFromLabels()).toBe(EXPECTED_OCCUPANCY);
    expect(readSpotsOpenFromLabels()).toBe(EXPECTED_SPOTS_OPEN);
  });

  it('the timeline reports the same spots open as the card, not the lane count', () => {
    render(
      <RoomOccupancyTimeline
        trip={TRIP}
        rooms={[ROOM]}
        assignments={[ASSIGNMENT]}
        arrivals={[]}
        departures={[]}
        persons={[COUPLE]}
        dateLocale={enUS}
        range={{ startDate: TRIP.startDate, endDate: TRIP.endDate }}
      />,
      { withProviders: false },
    );

    // One bar occupies one lane; the couple in it occupies two beds.
    expect(readSpotsOpenFromLabels()).toBe(EXPECTED_SPOTS_OPEN);
  });

  it('the guest wizard reports the same spots taken as the card, not the row count', async () => {
    render(
      <Routes>
        <Route path="/share/:shareId/room" element={<RoomSelectionStepPage />} />
        <Route path="/share/:shareId/identity" element={<div>identity</div>} />
      </Routes>,
      { withProviders: false, initialEntries: ['/share/share-1/room'] },
    );

    await waitFor(() => {
      expect(screen.getByText(ROOM.name)).toBeInTheDocument();
    });

    expect(readOccupiedFromLabels()).toBe(EXPECTED_OCCUPANCY);
  });
});
