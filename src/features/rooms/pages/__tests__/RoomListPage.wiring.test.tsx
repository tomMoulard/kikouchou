/**
 * @fileoverview What the rooms page hands to each of its parts.
 *
 * The other RoomListPage files render a real room card and assert on what a
 * reader sees. This one replaces every child the page composes (the cards,
 * the timeline, the dialogs, the date picker, dnd-kit) with a stub that keeps
 * the props it was last given, so a test can read the page's own decisions:
 * which occupancy a card shows, which dates the claim dialog opens on, what
 * the timeline is told about today.
 *
 * The contexts read from one small store, so a test can change the trip, the
 * guests or the stays after the first render and watch the page follow, the
 * way a live query would make it. The router is a real memory router, so the
 * view switch and the `?new=1` hand-off really move the URL.
 *
 * @module features/rooms/pages/__tests__/RoomListPage.wiring.test
 */

import { type ReactElement, type ReactNode, useEffect, useSyncExternalStore } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { tripDate, tripDay } from '@/features/rooms/__tests__/fixture-days';
import { act, render, screen, waitFor, within } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { type Location, type NavigateFunction, Route, Routes, useLocation } from 'react-router-dom';
import type { Active, DndContextProps, Over } from '@dnd-kit/core';

import type { DateRangePickerProps } from '@/components/shared/DateRangePicker';
import type { AllocationSuggestionDialogProps } from '@/features/rooms/components/AllocationSuggestionDialog';
import type { RoomCardProps } from '@/features/rooms/components/RoomCard';
import type { RoomOccupancyTimelineProps } from '@/features/rooms/components/RoomOccupancyTimeline';
import type { RoomDragAnnouncementContext } from '@/features/rooms/utils/dnd-announcements';
import type { Person, PersonId, Room, RoomAssignment, RoomId, Transport, Trip } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Paris',
  startDate: tripDay(1),
  endDate: tripDay(10),
  description: '',
  createdAt: 0,
  updatedAt: 0,
};

const ATTIC: Room = {
  id: 'room-1' as RoomId,
  tripId: TRIP.id,
  name: 'Attic',
  capacity: 2,
  order: 0,
};

const BARN: Room = {
  id: 'room-2' as RoomId,
  tripId: TRIP.id,
  name: 'Barn',
  capacity: 3,
  order: 1,
};

const ALICE: Person = {
  id: 'p1' as PersonId,
  tripId: TRIP.id,
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
  stayStartDate: tripDay(2),
  stayEndDate: tripDay(8),
};

const BOB: Person = {
  id: 'p2' as PersonId,
  tripId: TRIP.id,
  name: 'Bob',
  color: '#ef4444' as Person['color'],
};

function stay(
  id: string,
  personId: PersonId,
  roomId: RoomId,
  startDate: string,
  endDate: string,
): RoomAssignment {
  return {
    id: id as RoomAssignment['id'],
    tripId: TRIP.id,
    roomId,
    personId,
    startDate: startDate as RoomAssignment['startDate'],
    endDate: endDate as RoomAssignment['endDate'],
  };
}

/** Alice's whole stay, in the Attic: she is the one guest, and she is housed. */
const ALICE_IN_ATTIC = stay('a1', ALICE.id, ATTIC.id, tripDay(2), tripDay(8));

// ============================================================================
// The world the contexts read
// ============================================================================

interface World {
  readonly trip: Trip | undefined;
  readonly tripLoading: boolean;
  readonly rooms: readonly Room[];
  readonly roomsLoading: boolean;
  readonly roomsError: Error | null;
  readonly assignments: readonly RoomAssignment[];
  readonly persons: readonly Person[];
  readonly arrivals: readonly Transport[];
  readonly departures: readonly Transport[];
  readonly transportsLoading: boolean;
  readonly canEdit: boolean;
  readonly today: Date;
  readonly language: string;
  readonly guestId: string | undefined;
  readonly isTripMissing: boolean;
  readonly createAssignment: (...args: unknown[]) => Promise<unknown>;
  readonly updateAssignment: (...args: unknown[]) => Promise<unknown>;
  readonly deleteRoom: (...args: unknown[]) => Promise<unknown>;
  readonly duplicateRoom: (...args: unknown[]) => Promise<unknown>;
}

/** Where the router is, and a real navigate, read by {@link RouterProbe}. */
const probe = vi.hoisted(() => ({
  location: undefined as unknown as Location,
  navigate: undefined as unknown as NavigateFunction,
  useRealNavigate: undefined as unknown as () => NavigateFunction,
}));

const { store, i18nValue, seen } = vi.hoisted(() => {
  let state: unknown;
  const listeners = new Set<() => void>();
  const worldStore = {
    get: (): unknown => state,
    set: (next: unknown): void => {
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    store: worldStore,
    i18nValue: {
      // Echoes the options a label was built with, so a lost count or name shows.
      t: (key: string, fallbackOrOptions?: unknown, maybeOptions?: unknown): string => {
        const options =
          typeof fallbackOrOptions === 'object' && fallbackOrOptions !== null
            ? fallbackOrOptions
            : maybeOptions;
        if (typeof options !== 'object' || options === null) {
          return key;
        }
        const rest = Object.fromEntries(
          Object.entries(options).filter(([name]) => name !== 'defaultValue'),
        );
        return Object.keys(rest).length === 0 ? key : `${key}|${JSON.stringify(rest)}`;
      },
      i18n: {
        get language(): string {
          return (state as { language: string }).language;
        },
      },
    },
    /** The props each stub was last rendered with. */
    seen: {
      cards: new Map<string, unknown>(),
      timeline: undefined as unknown,
      picker: undefined as unknown,
      roomDialog: undefined as unknown,
      quickAssign: undefined as unknown,
      suggestion: undefined as unknown,
      dnd: undefined as unknown,
      announcements: undefined as unknown,
    },
  };
});

function useWorld(): World {
  return useSyncExternalStore(store.subscribe, store.get) as World;
}

function world(): World {
  return store.get() as World;
}

/** Changes the world inside `act`, the way a live query would. */
function change(patch: Partial<World>): void {
  act(() => {
    store.set({ ...world(), ...patch });
  });
}

const {
  mockNavigate,
  mockNotifySuccess,
  mockNotifyError,
  mockReportFailure,
  mockCaptureDeletion,
  mockCaptureUsage,
  mockReload,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockNotifySuccess: vi.fn(),
  mockNotifyError: vi.fn(),
  mockReportFailure: vi.fn(),
  mockCaptureDeletion: vi.fn(),
  mockCaptureUsage: vi.fn(),
  mockReload: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  // The page's own navigate is a spy; the test keeps the real one to move the address.
  probe.useRealNavigate = actual.useNavigate;
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('react-i18next', () => ({ useTranslation: () => i18nValue }));

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => {
    const state = useWorld();
    return { currentTrip: state.trip, isLoading: state.tripLoading, setCurrentTrip: vi.fn() };
  },
}));

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => {
    const state = useWorld();
    return {
      rooms: state.rooms,
      isLoading: state.roomsLoading,
      error: state.roomsError,
      deleteRoom: state.deleteRoom,
      duplicateRoom: state.duplicateRoom,
    };
  },
}));

const getAssignmentsByRoomFor = new WeakMap<
  readonly RoomAssignment[],
  (roomId: RoomId) => RoomAssignment[]
>();

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => {
    const state = useWorld();
    let byRoom = getAssignmentsByRoomFor.get(state.assignments);
    if (!byRoom) {
      const all = state.assignments;
      byRoom = (roomId: RoomId) => all.filter((item) => item.roomId === roomId);
      getAssignmentsByRoomFor.set(state.assignments, byRoom);
    }
    return {
      assignments: state.assignments,
      getAssignmentsByRoom: byRoom,
      createAssignment: state.createAssignment,
      updateAssignment: state.updateAssignment,
    };
  },
}));

const getPersonByIdFor = new WeakMap<readonly Person[], (id: string) => Person | undefined>();

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => {
    const state = useWorld();
    let byId = getPersonByIdFor.get(state.persons);
    if (!byId) {
      const all = state.persons;
      byId = (id: string) => all.find((person) => person.id === id);
      getPersonByIdFor.set(state.persons, byId);
    }
    return { persons: state.persons, getPersonById: byId };
  },
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => {
    const state = useWorld();
    return {
      arrivals: state.arrivals,
      departures: state.departures,
      isLoading: state.transportsLoading,
    };
  },
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: mockNotifySuccess }),
  useToday: () => ({ today: useWorld().today }),
}));

vi.mock('@/hooks/useTripAccess', () => ({
  useTripAccess: () => ({ canEdit: useWorld().canEdit }),
}));

vi.mock('@/hooks/useTripFromUrl', () => ({
  useTripFromUrl: () => ({ isTripMissing: useWorld().isTripMissing }),
}));

vi.mock('@/lib/sharing/guest-identity', () => ({
  getTripGuestPersonId: (trip: Trip | undefined) =>
    trip === undefined ? undefined : (store.get() as World).guestId,
}));

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: mockNotifyError, warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/errors/report-failure', () => ({ reportFailure: mockReportFailure }));

vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  captureDeletion: mockCaptureDeletion,
  captureUsage: mockCaptureUsage,
}));

vi.mock('@/features/rooms/utils/allocation-planner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/rooms/utils/allocation-planner')>();
  return { ...actual, planRoomAllocation: vi.fn(actual.planRoomAllocation) };
});

vi.mock('@/features/rooms/utils/dnd-announcements', () => ({
  createRoomDragAnnouncements: (context: unknown) => {
    seen.announcements = context;
    return {};
  },
}));

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: (props: { readonly children?: ReactNode }): ReactElement => {
      seen.dnd = props;
      return <div data-testid="dnd">{props.children}</div>;
    },
    DragOverlay: ({ children }: { readonly children?: ReactNode }): ReactElement => (
      <div data-testid="drag-overlay">{children}</div>
    ),
  };
});

vi.mock('@/features/rooms/components/RoomCard', () => ({
  RoomCard: (props: { readonly room: Room }): ReactElement => {
    seen.cards.set(props.room.id, props);
    return <div data-testid={`card-${props.room.id}`}>{props.room.name}</div>;
  },
}));

vi.mock('@/features/rooms/components/DroppableRoom', () => ({
  DroppableRoom: ({ children }: { readonly children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/rooms/components/RoomOccupancyTimeline', () => ({
  RoomOccupancyTimeline: (props: unknown): ReactElement => {
    seen.timeline = props;
    return <div data-testid="timeline" />;
  },
  ROOM_TIMELINE_LABEL_COLUMN_WIDTH_PX: 140,
}));

vi.mock('@/components/shared/DateRangePicker', () => ({
  DateRangePicker: (props: unknown): ReactElement => {
    seen.picker = props;
    return <div data-testid="date-range-picker" />;
  },
}));

vi.mock('@/features/rooms/components/RoomDialog', () => ({
  RoomDialog: (props: unknown) => {
    seen.roomDialog = props;
    return null;
  },
}));

vi.mock('@/features/rooms/components/QuickAssignmentDialog', () => ({
  QuickAssignmentDialog: (props: unknown) => {
    seen.quickAssign = props;
    return null;
  },
}));

vi.mock('@/features/rooms/components/AllocationSuggestionDialog', () => ({
  AllocationSuggestionDialog: (props: unknown) => {
    seen.suggestion = props;
    return null;
  },
}));

vi.mock('@/features/rooms/components/RoomAssignmentSection', () => ({
  RoomAssignmentSection: () => null,
}));

vi.mock('@/features/trips/components/TripNotOnDeviceState', () => ({
  TripNotOnDeviceState: () => <div data-testid="trip-not-on-device" />,
}));

import { RoomListPage } from '../RoomListPage';
import { planRoomAllocation } from '@/features/rooms/utils/allocation-planner';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { installTestLocalStorage } from '@/test/utils';

// ============================================================================
// Helpers
// ============================================================================

interface QuickAssignProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly person: Person | null;
  readonly roomId: RoomId | null;
  readonly suggestedPersonId?: PersonId;
  readonly suggestedStartDate: string;
  readonly suggestedEndDate: string;
}

interface RoomDialogProps {
  readonly roomId?: RoomId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

interface DndProps extends Omit<DndContextProps, 'sensors'> {
  readonly sensors: readonly { sensor: { name: string }; options: unknown }[];
}

function card(roomId: RoomId): RoomCardProps {
  const props = seen.cards.get(roomId);
  expect(props, `no card was rendered for ${roomId}`).toBeDefined();
  return props as RoomCardProps;
}

const timeline = (): RoomOccupancyTimelineProps => seen.timeline as RoomOccupancyTimelineProps;
const picker = (): DateRangePickerProps => seen.picker as DateRangePickerProps;
const quickAssign = (): QuickAssignProps => seen.quickAssign as QuickAssignProps;
const roomDialog = (): RoomDialogProps => seen.roomDialog as RoomDialogProps;
const suggestion = (): AllocationSuggestionDialogProps =>
  seen.suggestion as AllocationSuggestionDialogProps;
const dnd = (): DndProps => seen.dnd as DndProps;
const announcements = (): RoomDragAnnouncementContext =>
  seen.announcements as RoomDragAnnouncementContext;

/** The order the cards are drawn in. */
function cardOrder(): string[] {
  return screen.getAllByTestId(/^card-/).map((node) => node.textContent ?? '');
}

function resetWorld(patch: Partial<World> = {}): void {
  store.set({
    trip: TRIP,
    tripLoading: false,
    rooms: [ATTIC, BARN],
    roomsLoading: false,
    roomsError: null,
    assignments: [],
    persons: [ALICE],
    arrivals: [],
    departures: [],
    transportsLoading: false,
    canEdit: true,
    today: tripDate(5),
    language: 'en',
    guestId: undefined,
    isTripMissing: false,
    createAssignment: vi.fn().mockResolvedValue(undefined),
    updateAssignment: vi.fn().mockResolvedValue(undefined),
    deleteRoom: vi.fn().mockResolvedValue(undefined),
    duplicateRoom: vi.fn().mockResolvedValue({ ...ATTIC, id: 'room-3', name: 'Attic (copy)' }),
    ...patch,
  } satisfies World);
}

/** Reports the harness router's address, and lends the test a real navigate. */
function RouterProbe(): null {
  const location = useLocation();
  const navigate = probe.useRealNavigate();
  useEffect(() => {
    probe.location = location;
    probe.navigate = navigate;
  });
  return null;
}

function renderPage(url = '/trips/trip-1/rooms?view=card') {
  const result = render(
    <>
      <Routes>
        <Route path="/trips/:tripId/rooms" element={<RoomListPage />} />
        <Route path="/rooms" element={<RoomListPage />} />
      </Routes>
      <RouterProbe />
    </>,
    { initialRoute: url, withProviders: false },
  );
  const router = {
    state: {
      get location(): Location {
        return probe.location;
      },
    },
    navigate: async (to: string): Promise<void> => {
      await probe.navigate(to);
    },
  };
  return { ...result, router };
}

function day(key: string): Date {
  const [year, month, date] = key.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date);
}

/** Picks a range in the cards view's date filter. */
function pickRange(from: string, to: string): void {
  act(() => {
    picker().onChange({ from: day(from), to: day(to) });
  });
}

function active(data: unknown): Active {
  return {
    id: 'dragged',
    data: { current: data },
    rect: { current: { initial: null, translated: null } },
  } as unknown as Active;
}

function over(data: unknown): Over {
  return { id: 'target', data: { current: data }, rect: {}, disabled: false } as unknown as Over;
}

function dragStart(data: unknown): void {
  act(() => {
    dnd().onDragStart?.({ active: active(data) } as Parameters<
      NonNullable<DndContextProps['onDragStart']>
    >[0]);
  });
}

function drop(data: unknown, target: unknown | null): void {
  act(() => {
    dnd().onDragEnd?.({
      active: active(data),
      over: target === null ? null : over(target),
    } as Parameters<NonNullable<DndContextProps['onDragEnd']>>[0]);
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  seen.cards.clear();
  seen.timeline = undefined;
  seen.picker = undefined;
  seen.roomDialog = undefined;
  seen.quickAssign = undefined;
  seen.suggestion = undefined;
  seen.dnd = undefined;
  seen.announcements = undefined;
  resetWorld();
  // A store that never remembers, so only the page's own flag stops a repeat.
  const storage = installTestLocalStorage();
  vi.spyOn(storage, 'getItem').mockReturnValue(null);
  vi.spyOn(storage, 'setItem');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RoomListPage — what the dialogs start with', () => {
  it('starts every dialog closed and empty', () => {
    renderPage();

    expect(suggestion().open).toBe(false);
    expect(suggestion().stays).toEqual([]);
    expect(roomDialog().open).toBe(false);
    expect(quickAssign()).toMatchObject({
      open: false,
      person: null,
      roomId: null,
      suggestedStartDate: '',
      suggestedEndDate: '',
    });
    expect(quickAssign()).not.toHaveProperty('suggestedPersonId');
  });

  it('starts the claim dialog on the guest this browser has become', () => {
    resetWorld({ guestId: 'p1' });
    renderPage();

    expect(quickAssign().suggestedPersonId).toBe('p1');
  });

  it('follows the guest identity when the trip changes under it', () => {
    renderPage();
    expect(quickAssign()).not.toHaveProperty('suggestedPersonId');

    change({ trip: { ...TRIP }, guestId: 'p1' });

    expect(quickAssign().suggestedPersonId).toBe('p1');
  });

  it('opens the room dialog on ?new=1 and then drops it from the address', async () => {
    const { router } = renderPage('/trips/trip-1/rooms?new=1&view=card');

    expect(roomDialog().open).toBe(true);
    await waitFor(() => {
      expect(router.state.location.search).toBe('?view=card');
    });
  });

  it('drops a ?new=1 that arrives after the first render', async () => {
    const { router } = renderPage();

    await act(async () => {
      await router.navigate('/trips/trip-1/rooms?view=card&new=1');
    });

    await waitFor(() => {
      expect(router.state.location.search).toBe('?view=card');
    });
  });
});

describe('RoomListPage — the view switch', () => {
  it.each([
    ['?view=card', 'cards'],
    ['?view=cards', 'cards'],
    ['?view=timeline', 'timeline'],
    ['', 'timeline'],
    ['?view=bogus', 'timeline'],
  ])('reads %j as the %s view', (search, view) => {
    renderPage(`/trips/trip-1/rooms${search}`);

    if (view === 'cards') {
      expect(screen.getByRole('list', { name: 'rooms.title' })).toBeInTheDocument();
      expect(screen.queryByTestId('timeline')).not.toBeInTheDocument();
    } else {
      expect(screen.getByTestId('timeline')).toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'rooms.title' })).not.toBeInTheDocument();
    }
  });

  it('moves between the views and writes the choice to the address', async () => {
    const user = userEvent.setup();
    const { router } = renderPage('/trips/trip-1/rooms?view=card');

    expect(screen.getByRole('radiogroup', { name: 'rooms.view.ariaLabel' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'rooms.view.timeline' }));
    expect(screen.getByTestId('timeline')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?view=timeline');

    await user.click(screen.getByRole('radio', { name: 'rooms.view.cards' }));
    expect(screen.getByRole('list', { name: 'rooms.title' })).toHaveClass(
      'grid',
      'grid-cols-1',
    );
    expect(router.state.location.search).toBe('?view=card');
  });
});

describe('RoomListPage — occupancy on the cards', () => {
  it('shows today’s occupants, and only those who are known', () => {
    resetWorld({
      persons: [ALICE, BOB],
      assignments: [
        ALICE_IN_ATTIC,
        stay('a2', BOB.id, ATTIC.id, tripDay(7), tripDay(9)),
        stay('a3', 'ghost' as PersonId, ATTIC.id, tripDay(3), tripDay(6)),
      ],
    });
    renderPage();

    expect(card(ATTIC.id).occupants).toEqual([ALICE]);
    expect(card(BARN.id).occupants).toEqual([]);
  });

  it('counts the peak over the whole trip without a filter', () => {
    resetWorld({
      persons: [ALICE, BOB],
      assignments: [ALICE_IN_ATTIC, stay('a2', BOB.id, ATTIC.id, tripDay(7), tripDay(9))],
    });
    renderPage();

    expect(card(ATTIC.id)).toMatchObject({ peakOccupancy: 2, availableSpots: 0, isFull: true });
  });

  it('counts the peak over the filtered nights in the cards view', () => {
    resetWorld({
      persons: [ALICE, BOB],
      assignments: [ALICE_IN_ATTIC, stay('a2', BOB.id, ATTIC.id, tripDay(7), tripDay(9))],
    });
    renderPage();

    pickRange(tripDay(2), tripDay(5));

    expect(card(ATTIC.id)).toMatchObject({ peakOccupancy: 1, availableSpots: 1, isFull: false });
  });

  it('ignores a one-day filter, which covers no night', () => {
    resetWorld({ assignments: [ALICE_IN_ATTIC] });
    renderPage();

    pickRange(tripDay(4), tripDay(4));

    expect(card(ATTIC.id).peakOccupancy).toBe(1);
  });

  it('ignores a filter the reader set in the cards view once on the timeline', async () => {
    resetWorld({
      persons: [ALICE, BOB],
      assignments: [ALICE_IN_ATTIC, stay('a2', BOB.id, ATTIC.id, tripDay(7), tripDay(9))],
    });
    const user = userEvent.setup();
    renderPage();
    expect(cardOrder()).toEqual(['Barn', 'Attic']);
    pickRange(tripDay(2), tripDay(5));
    // Filtered, the Attic has a free bed again and goes back to its place.
    expect(cardOrder()).toEqual(['Attic', 'Barn']);

    await user.click(screen.getByRole('radio', { name: 'rooms.view.timeline' }));

    // On the timeline the Attic is full over the trip, so it sorts last.
    expect(timeline().rooms.map((room) => room.id)).toEqual([BARN.id, ATTIC.id]);
  });

  it('sorts the rooms with a free bed first, keeping their order', () => {
    resetWorld({
      persons: [ALICE, BOB],
      assignments: [ALICE_IN_ATTIC, stay('a2', BOB.id, ATTIC.id, tripDay(7), tripDay(9))],
    });
    renderPage();

    expect(cardOrder()).toEqual(['Barn', 'Attic']);
  });

  it('counts a couple as two when the trip has no dates to measure against', () => {
    const couple = { ...ALICE, headcount: 2 };
    resetWorld({
      trip: { ...TRIP, startDate: '' as Trip['startDate'], endDate: '' as Trip['endDate'] },
      persons: [couple],
      assignments: [ALICE_IN_ATTIC],
    });
    renderPage();

    expect(card(ATTIC.id).peakOccupancy).toBe(2);
  });

  it('measures by today, not by a half-dated trip', () => {
    resetWorld({
      trip: { ...TRIP, endDate: '' as Trip['endDate'] },
      assignments: [ALICE_IN_ATTIC],
    });
    renderPage();

    expect(card(ATTIC.id).peakOccupancy).toBe(1);
  });

  it('follows the stays, the guests and the day after the first render', () => {
    resetWorld({ persons: [ALICE, BOB], assignments: [ALICE_IN_ATTIC] });
    renderPage();
    expect(card(ATTIC.id).occupants).toEqual([ALICE]);

    change({ persons: [{ ...ALICE, headcount: 2 }, BOB] });
    expect(card(ATTIC.id).peakOccupancy).toBe(2);

    change({ assignments: [ALICE_IN_ATTIC, stay('a2', BOB.id, BARN.id, tripDay(1), tripDay(10))] });
    expect(card(BARN.id).occupants).toEqual([BOB]);

    change({ today: tripDate(9) });
    expect(card(ATTIC.id).occupants).toEqual([]);
    expect(card(BARN.id).occupants).toEqual([BOB]);
  });

  it('bounds the filter by the trip and names it', () => {
    renderPage();

    expect(picker()['aria-label']).toBe('rooms.filterDates');
    expect(picker().minDate).toEqual(day(tripDay(1)));
    expect(picker().maxDate).toEqual(day(tripDay(10)));

    change({ trip: { ...TRIP, startDate: tripDay(-2), endDate: tripDay(12) } });
    expect(picker().minDate).toEqual(day(tripDay(-2)));
    expect(picker().maxDate).toEqual(day(tripDay(12)));
  });

  it('expands one room at a time, and folds it again', () => {
    renderPage();

    act(() => {
      card(ATTIC.id).onClick?.(ATTIC);
    });
    expect(card(ATTIC.id).isExpanded).toBe(true);
    expect(card(BARN.id).isExpanded).toBe(false);

    act(() => {
      card(BARN.id).onClick?.(BARN);
    });
    expect(card(ATTIC.id).isExpanded).toBe(false);
    expect(card(BARN.id).isExpanded).toBe(true);

    act(() => {
      card(BARN.id).onClick?.(BARN);
    });
    expect(card(BARN.id).isExpanded).toBe(false);
  });

  it('hands the expanded list the room and the reader’s rights', () => {
    renderPage();
    const content = card(ATTIC.id).expandedContent as ReactElement<{
      roomId: RoomId;
      readOnly: boolean;
      variant: string;
    }>;
    expect(content.props).toMatchObject({ roomId: ATTIC.id, readOnly: false, variant: 'compact' });
  });

  it('makes the cards read-only for a viewer', () => {
    resetWorld({ canEdit: false });
    renderPage();

    const content = card(ATTIC.id).expandedContent as ReactElement<{ readOnly: boolean }>;
    expect(content.props.readOnly).toBe(true);
    expect(card(ATTIC.id).readOnly).toBe(true);
    expect(card(ATTIC.id)).not.toHaveProperty('onClaim');
  });
});

describe('RoomListPage — the timeline', () => {
  it('is told about today, the trip, the rooms and the language', () => {
    resetWorld({ language: 'fr' });
    renderPage('/trips/trip-1/rooms?view=timeline');

    expect(timeline().todayKey).toBe(tripDay(5));
    expect(timeline().range).toEqual({ startDate: tripDay(1), endDate: tripDay(10) });
    expect(timeline().rooms.map((room) => room.id)).toEqual([ATTIC.id, BARN.id]);
    expect(timeline().dateLocale).toBe(getDateLocale('fr'));

    change({ language: 'en', today: tripDate(6) });
    expect(timeline().dateLocale).toBe(getDateLocale('en'));
    expect(timeline().todayKey).toBe(tripDay(6));
  });

  it('pads a single-digit month and day', () => {
    // The coming 9 January, so both the month and the day have one digit.
    const year = new Date().getFullYear() + 1;
    resetWorld({ today: new Date(year, 0, 9) });
    renderPage('/trips/trip-1/rooms?view=timeline');

    expect(timeline().todayKey).toBe(`${year}-01-09`);
  });

  it('gives the timeline the whole width once the trip outgrows it', () => {
    const { container } = renderPage('/trips/trip-1/rooms?view=timeline');
    expect(container.querySelector('.container.max-w-7xl')).not.toBeNull();

    change({ trip: { ...TRIP, endDate: tripDay(375) } });

    expect(container.querySelector('.w-full.py-6')).not.toBeNull();
  });

  it('shows the drag hint while a guest still needs a bed, to an editor only', () => {
    renderPage('/trips/trip-1/rooms?view=timeline');
    const hint = screen.getByText('rooms.dragHint');
    expect(hint).toHaveClass('rounded-md', 'bg-muted');

    change({ assignments: [ALICE_IN_ATTIC] });
    expect(screen.queryByText('rooms.dragHint')).not.toBeInTheDocument();

    change({ assignments: [], canEdit: false });
    expect(screen.queryByText('rooms.dragHint')).not.toBeInTheDocument();
  });

  it('wires the chip menus for an editor only', () => {
    renderPage('/trips/trip-1/rooms?view=timeline');
    expect(timeline().onAssignGuestToRoom).toBeTypeOf('function');

    change({ canEdit: false });
    expect(timeline()).not.toHaveProperty('onAssignGuestToRoom');
  });
});

describe('RoomListPage — the page states', () => {
  it('titles the loading state', () => {
    resetWorld({ roomsLoading: true });
    renderPage();

    expect(screen.getByRole('heading', { name: 'rooms.title' })).toBeInTheDocument();
  });

  it('refuses a trip that is not the one in the address', () => {
    resetWorld({ trip: { ...TRIP, id: 'trip-9' as Trip['id'] } });
    renderPage();

    expect(screen.getByRole('heading', { name: 'rooms.title' })).toBeInTheDocument();
    expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
    expect(screen.getByText('errors.tripNotFoundDescription')).toBeInTheDocument();
    expect(screen.queryByTestId('dnd')).not.toBeInTheDocument();
  });

  it('notices the trip changing to another one after the first render', () => {
    renderPage();
    expect(screen.getByTestId('dnd')).toBeInTheDocument();

    change({ trip: { ...TRIP, id: 'trip-9' as Trip['id'] } });

    expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
  });

  it('sends the reader of a missing trip back to the trip list', async () => {
    resetWorld({ trip: undefined });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'common.back' }));

    expect(mockNavigate).toHaveBeenCalledWith('/trips');
  });

  it('says a trip is not on this device when that is the reason', () => {
    resetWorld({ trip: undefined, isTripMissing: true });
    renderPage();

    expect(screen.getByTestId('trip-not-on-device')).toBeInTheDocument();
  });

  it('retries a failed load by reloading, and goes back to the calendar', async () => {
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload: mockReload },
    });
    try {
      resetWorld({ roomsError: new Error('boom') });
      const user = userEvent.setup();
      renderPage();

      expect(screen.getByRole('heading', { name: 'rooms.title' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'common.retry' }));
      expect(mockReload).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole('button', { name: 'common.back' }));
      expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-1/calendar');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('titles and describes the empty state', () => {
    resetWorld({ rooms: [] });
    renderPage();

    expect(screen.getByRole('heading', { name: 'rooms.title' })).toBeInTheDocument();
    expect(screen.getByText('rooms.emptyDescription')).toBeInTheDocument();
  });

  it('offers the add buttons to an editor only', () => {
    renderPage();
    const buttons = screen.getAllByRole('button', { name: 'rooms.new' });
    // The header button, which hides on a phone, and the floating one.
    expect(buttons[0]).toHaveClass('hidden', 'sm:flex');
    expect(buttons[1]).toHaveClass('fixed', 'size-14', 'sm:hidden', 'focus-visible:ring-2');

    change({ canEdit: false });
    expect(screen.queryByRole('button', { name: 'rooms.new' })).not.toBeInTheDocument();
  });

  it('lets nothing be dragged on a read-only trip', () => {
    resetWorld({ canEdit: false });
    renderPage();

    expect(dnd().sensors).toEqual([]);
  });

  it('asks for a deliberate gesture before a drag starts', () => {
    renderPage();

    const byName = new Map(dnd().sensors.map((entry) => [entry.sensor.name, entry.options]));
    expect(byName.get('MouseSensor')).toEqual({ activationConstraint: { distance: 8 } });
    expect(byName.get('TouchSensor')).toEqual({
      activationConstraint: { delay: 200, tolerance: 5 },
    });
  });

  it('only says a no-night trip needs no beds when nobody needs one', () => {
    const sameDay = { ...TRIP, endDate: TRIP.startDate };
    // Alice's own stay outlasts the trip's single day, so she still needs a bed.
    resetWorld({ trip: sameDay });
    renderPage();
    expect(screen.queryByText('rooms.noNights')).not.toBeInTheDocument();

    change({ trip: TRIP, assignments: [ALICE_IN_ATTIC] });
    expect(screen.queryByText('rooms.noNights')).not.toBeInTheDocument();
  });
});

describe('RoomListPage — the room menu', () => {
  it('opens the room dialog on the room being edited, and forgets it on close', () => {
    renderPage();

    act(() => {
      card(BARN.id).onEdit(BARN);
    });
    expect(roomDialog()).toMatchObject({ open: true, roomId: BARN.id });

    act(() => {
      roomDialog().onOpenChange(true);
    });
    expect(roomDialog()).toMatchObject({ open: true, roomId: BARN.id });

    act(() => {
      roomDialog().onOpenChange(false);
    });
    expect(roomDialog().open).toBe(false);
    expect(roomDialog().roomId).toBeUndefined();
  });

  it('reports a deletion with what is left', async () => {
    renderPage();
    change({ rooms: [ATTIC, BARN, { ...BARN, id: 'room-3' as RoomId }] });

    await act(async () => {
      await card(BARN.id).onDelete(BARN);
    });

    expect(world().deleteRoom).toHaveBeenCalledWith(BARN.id);
    expect(mockCaptureDeletion).toHaveBeenCalledWith('room_deleted', {
      capacity: 3,
      remaining_count: 2,
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('rooms.deleteSuccess');
  });

  it('reports a failed deletion and keeps the prompt open', async () => {
    const error = new Error('offline');
    resetWorld({ deleteRoom: vi.fn().mockRejectedValue(error) });
    renderPage();

    await expect(card(BARN.id).onDelete(BARN)).rejects.toBe(error);

    expect(mockReportFailure).toHaveBeenCalledWith(
      'RoomListPage.handleRoomDelete',
      error,
      'errors.deleteFailed',
    );
    expect(mockNotifySuccess).not.toHaveBeenCalled();
  });

  it('names the copy it made and counts it as a saved room', async () => {
    renderPage();

    await act(async () => {
      await card(ATTIC.id).onDuplicate?.(ATTIC);
    });

    expect(world().duplicateRoom).toHaveBeenCalledWith(ATTIC.id);
    expect(mockNotifySuccess).toHaveBeenCalledWith('rooms.duplicateSuccess|{"name":"Attic (copy)"}');
    expect(mockCaptureUsage).toHaveBeenCalledWith('room_saved', {
      operation: 'created',
      capacity: 2,
      count: 1,
    });
  });

  it('duplicates through the context of now', async () => {
    renderPage();
    const later = vi.fn().mockResolvedValue({ ...ATTIC, id: 'room-4', name: 'Later copy' });
    change({ duplicateRoom: later });

    await act(async () => {
      await card(ATTIC.id).onDuplicate?.(ATTIC);
    });

    expect(later).toHaveBeenCalled();
  });

  it('reports a failed copy', async () => {
    const error = new Error('offline');
    resetWorld({ duplicateRoom: vi.fn().mockRejectedValue(error) });
    renderPage();

    await act(async () => {
      await card(ATTIC.id).onDuplicate?.(ATTIC);
    });

    expect(mockReportFailure).toHaveBeenCalledWith(
      'RoomListPage.handleRoomDuplicate',
      error,
      'errors.saveFailed',
    );
    expect(mockCaptureUsage).not.toHaveBeenCalled();
  });
});

describe('RoomListPage — claiming a room', () => {
  it('opens on the filtered nights when the reader filtered', () => {
    renderPage();
    pickRange(tripDay(3), tripDay(6));

    act(() => {
      card(BARN.id).onClaim?.(BARN);
    });

    expect(quickAssign()).toMatchObject({
      open: true,
      roomId: BARN.id,
      person: null,
      suggestedStartDate: tripDay(3),
      suggestedEndDate: tripDay(6),
    });
  });

  it('opens on the trip when the trip has no usable range', () => {
    resetWorld({
      trip: { ...TRIP, startDate: '' as Trip['startDate'] },
      rooms: [{ ...ATTIC, capacity: 0 }],
    });
    renderPage();

    act(() => {
      card(ATTIC.id).onClaim?.(card(ATTIC.id).room);
    });

    expect(mockNotifyError).not.toHaveBeenCalled();
    expect(quickAssign()).toMatchObject({
      open: true,
      suggestedStartDate: '',
      suggestedEndDate: tripDay(10),
    });
  });

  it('opens with no dates on a trip that has none', () => {
    resetWorld({
      trip: {
        ...TRIP,
        startDate: undefined as unknown as Trip['startDate'],
        endDate: undefined as unknown as Trip['endDate'],
      },
      // No beds: a capacity check run on no dates would call it full.
      rooms: [{ ...ATTIC, capacity: 0 }],
    });
    renderPage();

    act(() => {
      card(ATTIC.id).onClaim?.(card(ATTIC.id).room);
    });

    expect(mockNotifyError).not.toHaveBeenCalled();
    expect(quickAssign()).toMatchObject({
      open: true,
      suggestedStartDate: '',
      suggestedEndDate: '',
    });
  });

  it('closes the claim dialog back to nothing, and keeps it on a reopen', () => {
    resetWorld({ guestId: undefined });
    renderPage();
    drop({ person: ALICE, startDate: tripDay(2), endDate: tripDay(8) }, { roomId: BARN.id });
    expect(quickAssign()).toMatchObject({ open: true, person: ALICE, roomId: BARN.id });

    act(() => {
      quickAssign().onOpenChange(true);
    });
    expect(quickAssign()).toMatchObject({ open: true, person: ALICE, roomId: BARN.id });

    act(() => {
      quickAssign().onOpenChange(false);
    });
    expect(quickAssign()).toMatchObject({
      open: false,
      person: null,
      roomId: null,
      suggestedStartDate: '',
      suggestedEndDate: '',
    });
  });

  it('does not put the browser’s own guest on a guest who was dragged in', () => {
    resetWorld({ guestId: 'p2', persons: [ALICE, BOB] });
    renderPage();

    drop({ person: ALICE, startDate: tripDay(2), endDate: tripDay(8) }, { roomId: BARN.id });

    expect(quickAssign().person).toEqual(ALICE);
    expect(quickAssign()).not.toHaveProperty('suggestedPersonId');
  });
});

describe('RoomListPage — dragging', () => {
  const aliceChip = { person: ALICE, startDate: tripDay(2), endDate: tripDay(8) };

  it('shows the guest being dragged, then nothing once it lands', () => {
    renderPage();
    const overlay = screen.getByTestId('drag-overlay');

    dragStart(aliceChip);
    expect(within(overlay).getByText('Alice').parentElement).toHaveClass('opacity-80');
    expect(within(overlay).queryByText('assignments.title')).not.toBeInTheDocument();

    drop(aliceChip, null);
    expect(overlay).toBeEmptyDOMElement();
  });

  it('shows a stay being dragged, and swaps between the two kinds', () => {
    renderPage();
    const overlay = screen.getByTestId('drag-overlay');

    dragStart(aliceChip);
    dragStart({ assignment: ALICE_IN_ATTIC });
    expect(within(overlay).queryByText('Alice')).not.toBeInTheDocument();
    expect(within(overlay).getByText('assignments.title')).toHaveClass('rounded-md', 'bg-muted');

    dragStart(aliceChip);
    expect(within(overlay).queryByText('assignments.title')).not.toBeInTheDocument();
    expect(within(overlay).getByText('Alice')).toBeInTheDocument();

    act(() => {
      dnd().onDragCancel?.({} as Parameters<NonNullable<DndContextProps['onDragCancel']>>[0]);
    });
    expect(overlay).toBeEmptyDOMElement();
  });

  it('shrugs off a drag that carries nothing it knows', () => {
    renderPage();

    dragStart(undefined);
    drop(undefined, undefined);
    drop(aliceChip, undefined);
    drop({ assignment: ALICE_IN_ATTIC }, undefined);

    expect(screen.getByTestId('drag-overlay')).toBeEmptyDOMElement();
    expect(world().createAssignment).not.toHaveBeenCalled();
    expect(world().updateAssignment).not.toHaveBeenCalled();
  });

  it('does not swap a guest chip dropped on a stay', async () => {
    resetWorld({ assignments: [ALICE_IN_ATTIC] });
    renderPage();

    drop(aliceChip, { assignmentId: ALICE_IN_ATTIC.id });
    await act(async () => undefined);

    expect(world().updateAssignment).not.toHaveBeenCalled();
    expect(mockReportFailure).not.toHaveBeenCalled();
  });

  it('ignores a swap onto a stay that has gone', async () => {
    resetWorld({ assignments: [ALICE_IN_ATTIC] });
    renderPage();

    drop({ assignment: ALICE_IN_ATTIC }, { assignmentId: 'gone' });
    await act(async () => undefined);

    expect(world().updateAssignment).not.toHaveBeenCalled();
    expect(mockReportFailure).not.toHaveBeenCalled();
  });

  it('swaps two stays and says so', async () => {
    const bobInBarn = stay('a2', BOB.id, BARN.id, tripDay(2), tripDay(8));
    resetWorld({ persons: [ALICE, BOB], assignments: [ALICE_IN_ATTIC, bobInBarn] });
    renderPage();

    drop({ assignment: ALICE_IN_ATTIC }, { assignmentId: bobInBarn.id });

    await waitFor(() => {
      expect(mockNotifySuccess).toHaveBeenCalledWith('rooms.swapSuccess');
    });
    expect(world().updateAssignment).toHaveBeenCalledWith('a1', { roomId: BARN.id });
    expect(world().updateAssignment).toHaveBeenCalledWith('a2', { roomId: ATTIC.id });
  });

  it('reports a failed swap', async () => {
    const error = new Error('offline');
    const bobInBarn = stay('a2', BOB.id, BARN.id, tripDay(2), tripDay(8));
    resetWorld({
      persons: [ALICE, BOB],
      assignments: [ALICE_IN_ATTIC, bobInBarn],
      updateAssignment: vi.fn().mockRejectedValue(error),
    });
    renderPage();

    drop({ assignment: ALICE_IN_ATTIC }, { assignmentId: bobInBarn.id });

    await waitFor(() => {
      expect(mockReportFailure).toHaveBeenCalledWith(
        'RoomListPage.swapAssignments',
        error,
        'errors.saveFailed',
      );
    });
    expect(mockNotifySuccess).not.toHaveBeenCalledWith('rooms.swapSuccess');
  });

  it('swaps against the stays of now, not of the first render', async () => {
    const bobInBarn = stay('a2', BOB.id, BARN.id, tripDay(2), tripDay(8));
    resetWorld({ persons: [ALICE, BOB], assignments: [ALICE_IN_ATTIC] });
    renderPage();
    change({ assignments: [ALICE_IN_ATTIC, bobInBarn] });

    drop({ assignment: ALICE_IN_ATTIC }, { assignmentId: bobInBarn.id });

    await waitFor(() => {
      expect(world().updateAssignment).toHaveBeenCalledTimes(2);
    });
  });

  it('houses a dropped guest at once after a switch to the timeline', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'rooms.view.timeline' }));

    drop(aliceChip, { roomId: BARN.id });

    await waitFor(() => {
      expect(world().createAssignment).toHaveBeenCalledWith({
        roomId: BARN.id,
        personId: ALICE.id,
        startDate: tripDay(2),
        endDate: tripDay(8),
      });
    });
    expect(quickAssign().open).toBe(false);
  });

  it('reports a failed housing with the room it was for', async () => {
    const error = new Error('offline');
    resetWorld({ createAssignment: vi.fn().mockRejectedValue(error) });
    renderPage('/trips/trip-1/rooms?view=timeline');

    act(() => {
      timeline().onAssignGuestToRoom?.(aliceChip, BARN.id);
    });

    await waitFor(() => {
      expect(mockReportFailure).toHaveBeenCalledWith(
        'RoomListPage.assignGuestToRoom',
        error,
        'errors.saveFailed',
        { room_id: BARN.id },
      );
    });
  });

  it('reports a failed move with the room it was for', async () => {
    const error = new Error('offline');
    resetWorld({ updateAssignment: vi.fn().mockRejectedValue(error) });
    renderPage('/trips/trip-1/rooms?view=timeline');

    act(() => {
      timeline().onMoveAssignmentToRoom?.(ALICE_IN_ATTIC, BARN.id);
    });

    await waitFor(() => {
      expect(mockReportFailure).toHaveBeenCalledWith(
        'RoomListPage.moveAssignmentToRoom',
        error,
        'errors.saveFailed',
        { room_id: BARN.id },
      );
    });
  });

  it('writes through the context of now', async () => {
    renderPage('/trips/trip-1/rooms?view=timeline');
    const create = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    change({ createAssignment: create, updateAssignment: update });

    act(() => {
      timeline().onAssignGuestToRoom?.(aliceChip, BARN.id);
      timeline().onMoveAssignmentToRoom?.(ALICE_IN_ATTIC, BARN.id);
    });

    await waitFor(() => {
      expect(create).toHaveBeenCalled();
    });
    expect(update).toHaveBeenCalled();
  });

  it('gives the announcer names, free beds and the view', async () => {
    resetWorld({ persons: [ALICE, BOB], assignments: [ALICE_IN_ATTIC] });
    const user = userEvent.setup();
    renderPage();

    expect(announcements().personNameOf(ALICE.id)).toBe('Alice');
    expect(announcements().personNameOf('nobody' as PersonId)).toBeUndefined();
    expect(announcements().rooms).toEqual([
      { id: ATTIC.id, name: 'Attic', availableSpots: 1 },
      { id: BARN.id, name: 'Barn', availableSpots: 3 },
    ]);
    expect(announcements().confirmsBeforeAssigning).toBe(true);

    await user.click(screen.getByRole('radio', { name: 'rooms.view.timeline' }));
    expect(announcements().confirmsBeforeAssigning).toBe(false);
  });
});

describe('RoomListPage — suggesting an allocation', () => {
  it('says so when there is nothing it can place', async () => {
    vi.mocked(planRoomAllocation).mockReturnValueOnce([]);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'rooms.suggest.button' }));

    expect(mockNotifyError).toHaveBeenCalledWith('rooms.suggest.nothingToPlace');
    expect(suggestion().open).toBe(false);
  });

  it('proposes for the guests of now, not of the first render', async () => {
    resetWorld({ assignments: [ALICE_IN_ATTIC] });
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByRole('button', { name: 'rooms.suggest.button' })).not.toBeInTheDocument();

    change({ assignments: [] });
    await user.click(screen.getByRole('button', { name: 'rooms.suggest.button' }));

    expect(suggestion().open).toBe(true);
    expect(suggestion().stays.map((item) => item.personId)).toEqual([ALICE.id]);
  });

  it('says how many it wrote, and reports where it stopped', async () => {
    const error = new Error('offline');
    const create = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);
    resetWorld({ createAssignment: create });
    renderPage();
    const stays = [
      { personId: ALICE.id, roomId: ATTIC.id, startDate: tripDay(2), endDate: tripDay(4) },
      { personId: ALICE.id, roomId: BARN.id, startDate: tripDay(4), endDate: tripDay(8) },
    ];

    await expect(suggestion().onApply(stays)).rejects.toBe(error);

    expect(mockReportFailure).toHaveBeenCalledWith(
      'RoomListPage.applySuggestedStays',
      error,
      'rooms.suggest.failed',
      { stays_requested: 2, stays_created: 1 },
    );
    expect(mockNotifySuccess).toHaveBeenCalledWith('rooms.suggest.applied|{"count":1}');
  });

  it('says nothing about a write that never landed', async () => {
    const error = new Error('offline');
    resetWorld({ createAssignment: vi.fn().mockRejectedValue(error) });
    renderPage();

    await expect(
      suggestion().onApply([
        { personId: ALICE.id, roomId: ATTIC.id, startDate: tripDay(2), endDate: tripDay(8) },
      ]),
    ).rejects.toBe(error);

    expect(mockNotifySuccess).not.toHaveBeenCalled();
  });

  it('applies through the context of now', async () => {
    renderPage();
    const create = vi.fn().mockResolvedValue(undefined);
    change({ createAssignment: create });

    await act(async () => {
      await suggestion().onApply([
        { personId: ALICE.id, roomId: ATTIC.id, startDate: tripDay(2), endDate: tripDay(8) },
      ]);
    });

    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('RoomListPage — the "everyone has a room" notice', () => {
  const STORAGE_KEY = 'rooms_all_assigned_notified_trip-1';

  it('says it once, and remembers having said it for this trip', () => {
    resetWorld({ assignments: [ALICE_IN_ATTIC] });
    renderPage();

    expect(mockNotifySuccess).toHaveBeenCalledWith('rooms.allGuestsAssigned');
    expect(window.localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, '1');

    // A new guest who is also housed re-runs the check; it must not say it twice.
    change({
      persons: [ALICE, BOB],
      assignments: [ALICE_IN_ATTIC, stay('a2', BOB.id, BARN.id, tripDay(1), tripDay(10))],
    });
    expect(mockNotifySuccess).toHaveBeenCalledTimes(1);
  });

  it('says it when the last guest is housed after the first render', () => {
    renderPage();
    expect(mockNotifySuccess).not.toHaveBeenCalled();

    change({ assignments: [ALICE_IN_ATTIC] });

    expect(mockNotifySuccess).toHaveBeenCalledWith('rooms.allGuestsAssigned');
  });

  it('stays quiet when it was already said on this device', () => {
    vi.mocked(window.localStorage.getItem).mockImplementation((key) =>
      key === STORAGE_KEY ? '1' : null,
    );
    resetWorld({ assignments: [ALICE_IN_ATTIC] });
    renderPage();

    expect(mockNotifySuccess).not.toHaveBeenCalled();
  });

  it('says it once per session when storage is unavailable', () => {
    vi.mocked(window.localStorage.getItem).mockImplementation(() => {
      throw new Error('private mode');
    });
    resetWorld({ assignments: [ALICE_IN_ATTIC] });
    renderPage();
    expect(mockNotifySuccess).toHaveBeenCalledWith('rooms.allGuestsAssigned');

    change({
      persons: [ALICE, BOB],
      assignments: [ALICE_IN_ATTIC, stay('a2', BOB.id, BARN.id, tripDay(1), tripDay(10))],
    });
    expect(mockNotifySuccess).toHaveBeenCalledTimes(1);
  });

  it('does not call an empty guest list "everyone housed"', () => {
    resetWorld({ persons: [] });
    renderPage();

    expect(mockNotifySuccess).not.toHaveBeenCalled();
  });

  it('keys the memory by the trip in hand, even when the address names another', () => {
    resetWorld({ assignments: [ALICE_IN_ATTIC] });
    renderPage('/trips/trip-9/rooms?view=card');

    expect(window.localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, '1');
  });

  it('falls back on the address when no trip is loaded', () => {
    resetWorld({ trip: undefined, persons: [BOB] });
    renderPage();

    expect(window.localStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, '1');
  });

  it('stays quiet with neither a trip nor an address to key it by', () => {
    resetWorld({ trip: undefined, persons: [BOB] });
    renderPage('/rooms');

    expect(mockNotifySuccess).not.toHaveBeenCalled();
  });
});

describe('RoomListPage — a deferred write', () => {
  it('does not double-report a housing still in flight', async () => {
    const pending = deferred<void>();
    resetWorld({ createAssignment: vi.fn().mockReturnValue(pending.promise) });
    renderPage('/trips/trip-1/rooms?view=timeline');

    act(() => {
      timeline().onAssignGuestToRoom?.(
        { person: ALICE, startDate: tripDay(2), endDate: tripDay(8) },
        ATTIC.id,
      );
    });
    expect(mockNotifySuccess).not.toHaveBeenCalledWith('assignments.createSuccess');

    await act(async () => {
      pending.resolve();
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('assignments.createSuccess');
  });
});

describe('RoomListPage — a few more edges', () => {
  it('opens on the timeline, in its width, when the address names no view', () => {
    const { container } = renderPage('/trips/trip-1/rooms');

    expect(screen.getByTestId('timeline')).toBeInTheDocument();
    expect(container.querySelector('.container.max-w-7xl')).not.toBeNull();
    expect(screen.getByRole('radio', { name: 'rooms.view.timeline' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(announcements().confirmsBeforeAssigning).toBe(false);
  });

  it('marks the cards view as the chosen one', () => {
    renderPage('/trips/trip-1/rooms?view=card');

    expect(screen.getByRole('radio', { name: 'rooms.view.cards' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('goes back to the calendar of the trip in the address of now', async () => {
    resetWorld({ roomsError: new Error('boom') });
    const user = userEvent.setup();
    const { router } = renderPage();

    change({ trip: { ...TRIP, id: 'trip-2' as Trip['id'] } });
    await act(async () => {
      await router.navigate('/trips/trip-2/rooms');
    });
    await user.click(screen.getByRole('button', { name: 'common.back' }));

    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-2/calendar');
  });

  it('clears a dragged stay once it lands or the drag is called off', () => {
    renderPage();
    const overlay = screen.getByTestId('drag-overlay');

    dragStart({ assignment: ALICE_IN_ATTIC });
    expect(within(overlay).getByText('assignments.title')).toBeInTheDocument();
    drop({ assignment: ALICE_IN_ATTIC }, null);
    expect(overlay).toBeEmptyDOMElement();

    dragStart({ assignment: ALICE_IN_ATTIC });
    act(() => {
      dnd().onDragCancel?.({} as Parameters<NonNullable<DndContextProps['onDragCancel']>>[0]);
    });
    expect(overlay).toBeEmptyDOMElement();
  });
});

describe('RoomListPage — the address and the words of now', () => {
  it('keeps the rest of the address when the view changes', async () => {
    const user = userEvent.setup();
    const { router } = renderPage('/trips/trip-1/rooms?view=card');
    await act(async () => {
      await router.navigate('/trips/trip-1/rooms?view=card&from=calendar');
    });

    await user.click(screen.getByRole('radio', { name: 'rooms.view.timeline' }));

    expect(router.state.location.search).toBe('?view=timeline&from=calendar');
  });

  it('labels the add button with the words of the latest render', () => {
    const original = i18nValue.t;
    try {
      renderPage();
      i18nValue.t = (key: string) => `now:${key}`;
      change({ rooms: [ATTIC, BARN] });

      expect(screen.getAllByRole('button', { name: 'now:rooms.new' })[0]).toHaveTextContent(
        'now:rooms.new',
      );
    } finally {
      i18nValue.t = original;
    }
  });
});

describe('RoomListPage — remembering, and starting afresh', () => {
  it('does not ask storage again once it learned the notice was given', () => {
    const getItem = vi.mocked(window.localStorage.getItem);
    // Given before, on this device; then storage is cleared mid-session.
    getItem.mockReturnValueOnce('1').mockReturnValue(null);
    resetWorld({ assignments: [ALICE_IN_ATTIC] });
    renderPage();

    change({
      persons: [ALICE, BOB],
      assignments: [ALICE_IN_ATTIC, stay('a2', BOB.id, BARN.id, tripDay(1), tripDay(10))],
    });

    expect(mockNotifySuccess).not.toHaveBeenCalled();
  });

  it('opens the add button on a new room even while a room was being edited', async () => {
    const user = userEvent.setup();
    renderPage();
    act(() => {
      card(BARN.id).onEdit(BARN);
    });
    expect(roomDialog().roomId).toBe(BARN.id);

    await user.click(screen.getAllByRole('button', { name: 'rooms.new' })[0]!);

    expect(roomDialog()).toMatchObject({ open: true, roomId: undefined });
  });
});
