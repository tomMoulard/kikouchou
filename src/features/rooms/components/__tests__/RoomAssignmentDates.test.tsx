/**
 * @fileoverview The room-assignment date flow, end to end, against shipped code.
 *
 * Date model (hotel check-in / check-out):
 * - `startDate` = check-in day, the first night slept
 * - `endDate`   = check-out day, **not** a night slept
 * - Jan 5 → Jan 10 is five nights: the 5th, 6th, 7th, 8th and 9th
 *
 * This file used to define its own `getNightsStayed`, simulate the autofill
 * inline under a comment reading "extract dates (as the app does)", and then
 * assert string literals it had assigned two lines earlier. None of it touched
 * shipped code: the "BUG-1 regression test" for the off-by-one check-out date
 * stayed green no matter what `RoomAssignmentSection` did, because the app was
 * never rendered.
 *
 * Every test below now runs real code:
 * - the nights model comes from `capacity-utils`, its single source of truth;
 * - the day-key conversions come from `lib/db/utils`;
 * - BUG-1 drives the shipped autofill — transports through the real dialog into
 *   the real `createAssignment` payload — and the drag-and-drop pre-fill too;
 * - the timeline model is asked to agree with the nights model.
 *
 * Timezones: no test may encode the machine's UTC offset. Instants are built
 * from *local* parts (`new Date(2026, 6, 2, 10, 0).toISOString()`), so they read
 * as the same wall-clock day whether the suite runs at UTC+14 or UTC-11.
 *
 * @module features/rooms/components/__tests__/RoomAssignmentDates.test
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

import { render, screen, waitFor } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import {
  isDateInStayRange,
  listStayNights,
  stayNightsOverlap,
} from '@/features/rooms/utils/capacity-utils';
import { buildRoomTimelineModel } from '@/features/rooms/utils/room-timeline-utils';
import { parseISODateString, toISODateString, toLocalISODateString } from '@/lib/db/utils';
import type {
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomId,
  Transport,
  Trip,
} from '@/types';

// ============================================================================
// Fixture
// ============================================================================

/** Check-in day of the guest under test. */
const ARRIVAL_DAY = '2026-07-02';
/** Check-out day: the guest sleeps the 2nd through the 7th, six nights. */
const DEPARTURE_DAY = '2026-07-08';
const EXPECTED_NIGHTS = [
  '2026-07-02',
  '2026-07-03',
  '2026-07-04',
  '2026-07-05',
  '2026-07-06',
  '2026-07-07',
];

/**
 * An ISO instant for a wall-clock time on a given day, built from local parts.
 *
 * A literal like `'2026-07-08T00:00:00.000Z'` is July 7th for every viewer west
 * of Greenwich, which is how a date test starts encoding the machine's offset.
 * Going through the local constructor means the instant reads back as this day
 * in whatever zone the suite runs in.
 */
function instantOn(day: string, hour: number, minute = 0): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date, hour, minute, 0, 0).toISOString();
}

const TRIP: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Paris',
  startDate: '2026-07-01' as ISODateString,
  endDate: '2026-07-10' as ISODateString,
  description: '',
  createdAt: 0 as Trip['createdAt'],
  updatedAt: 0 as Trip['updatedAt'],
};

const ALICE: Person = {
  id: 'p1' as PersonId,
  tripId: 'trip-1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

const ROOM: Room = {
  id: 'room-1' as RoomId,
  tripId: 'trip-1' as Room['tripId'],
  name: 'Main Bedroom',
  capacity: 2,
  order: 0,
};

function transport(
  id: string,
  type: 'arrival' | 'departure',
  day: string,
  hour: number,
): Transport {
  return {
    id: id as Transport['id'],
    tripId: 'trip-1' as Transport['tripId'],
    personId: ALICE.id,
    type,
    datetime: instantOn(day, hour) as Transport['datetime'],
    location: 'Gare Montparnasse',
    needsPickup: false,
  } as Transport;
}

// ============================================================================
// Mocks — the two dialogs read their data from context
// ============================================================================

const mockCreateAssignment = vi.fn().mockResolvedValue(undefined);
const mockUpdateAssignment = vi.fn().mockResolvedValue(undefined);
const mockDeleteAssignment = vi.fn().mockResolvedValue(undefined);
const mockCheckConflict = vi.fn().mockResolvedValue(false);
const mockGetAssignmentsByRoom = vi.fn<() => RoomAssignment[]>(() => []);
const mockGetTransportsByPerson = vi.fn<() => Transport[]>(() => []);
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

/**
 * A **stable** translation double.
 *
 * The suite-wide mock in `src/test/setup.ts` returns a fresh `t` on every call,
 * and both dialogs list `t` in the dependency array of the effect that runs the
 * conflict check. With a new identity each render that effect re-arms forever,
 * `isCheckingConflict` never settles and the submit button is permanently
 * disabled — the form can never be driven. Real i18next hands back a stable
 * `t`, so this double is the faithful one.
 */
vi.mock('react-i18next', () => {
  const value = {
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn(), exists: () => true },
  };
  return {
    useTranslation: () => value,
    Trans: ({ children }: { readonly children?: unknown }) => children,
    initReactI18next: { type: '3rdParty', init: vi.fn() },
  };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ currentTrip: TRIP }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons: [ALICE],
    isLoading: false,
    getPersonById: (id: string) => (id === ALICE.id ? ALICE : undefined),
  }),
}));

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => ({ rooms: [ROOM] }),
}));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => ({
    get assignments() {
      return mockGetAssignmentsByRoom();
    },
    getAssignmentsByRoom: mockGetAssignmentsByRoom,
    createAssignment: mockCreateAssignment,
    updateAssignment: mockUpdateAssignment,
    deleteAssignment: mockDeleteAssignment,
    checkConflict: mockCheckConflict,
    isLoading: false,
  }),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => ({ getTransportsByPerson: mockGetTransportsByPerson }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/hooks', () => ({
  useFormSubmission: <T,>(onSubmit: (data: T) => Promise<void>) => ({
    isSubmitting: false,
    submitError: undefined,
    handleSubmit: onSubmit,
    clearError: vi.fn(),
  }),
  useOfflineAwareToast: () => ({ successToast: vi.fn(), errorToast: vi.fn() }),
}));

// ============================================================================
// Imports after mocks
// ============================================================================

import { RoomAssignmentSection } from '@/features/rooms/components/RoomAssignmentSection';
import { QuickAssignmentDialog } from '@/features/rooms/components/QuickAssignmentDialog';

// ============================================================================
// Helpers
// ============================================================================

/** Radix Select and Popover need pointer-capture and scroll APIs jsdom omits. */
function installPointerPolyfills(): void {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
}

/**
 * Runs the shipped "add assignment" flow: open the dialog, pick the guest —
 * which is what triggers the transport autofill — and submit.
 *
 * @returns The payload the component handed to `createAssignment`
 */
async function autofillAndSubmit(): Promise<{
  readonly startDate: string;
  readonly endDate: string;
  readonly personId: string;
  readonly roomId: string;
}> {
  const user = userEvent.setup();
  render(<RoomAssignmentSection roomId={ROOM.id} />, { withProviders: false });

  await user.click(screen.getByLabelText('assignments.assign'));
  await user.click(screen.getByRole('combobox', { name: 'assignments.person' }));
  await user.click(await screen.findByRole('option', { name: /Alice/ }));

  // The hint flips only when the component actually filled the dates in.
  await screen.findByText('assignments.autofilledFromTransport');

  const submit = screen.getByRole('button', { name: 'common.add' });
  await waitFor(() => {
    expect(submit).toBeEnabled();
  });
  await user.click(submit);

  await waitFor(() => {
    expect(mockCreateAssignment).toHaveBeenCalledTimes(1);
  });
  return mockCreateAssignment.mock.calls[0]![0] as {
    startDate: string;
    endDate: string;
    personId: string;
    roomId: string;
  };
}

// ============================================================================
// The nights model — capacity-utils is the single source of truth
// ============================================================================

describe('the nights model (listStayNights)', () => {
  it('lists every night of a multi-day stay and stops before check-out', () => {
    expect(listStayNights('2024-01-05', '2024-01-10')).toEqual([
      '2024-01-05',
      '2024-01-06',
      '2024-01-07',
      '2024-01-08',
      '2024-01-09',
    ]);
  });

  it('lists one night for a one-night stay', () => {
    expect(listStayNights('2024-01-05', '2024-01-06')).toEqual(['2024-01-05']);
  });

  it('lists no night for a same-day check-in and check-out', () => {
    expect(listStayNights('2024-01-05', '2024-01-05')).toEqual([]);
  });

  it('lists no night when check-out precedes check-in', () => {
    expect(listStayNights('2024-01-10', '2024-01-05')).toEqual([]);
  });

  it('crosses a month boundary', () => {
    expect(listStayNights('2024-01-30', '2024-02-02')).toEqual([
      '2024-01-30',
      '2024-01-31',
      '2024-02-01',
    ]);
  });

  it('crosses a year boundary', () => {
    expect(listStayNights('2023-12-30', '2024-01-02')).toEqual([
      '2023-12-30',
      '2023-12-31',
      '2024-01-01',
    ]);
  });

  it('includes the leap day', () => {
    expect(listStayNights('2024-02-28', '2024-03-01')).toEqual(['2024-02-28', '2024-02-29']);
  });

  it('agrees with isDateInStayRange on every day around the window', () => {
    // Two ways of asking the same question; they used to be written out by hand
    // in seven places and did not all agree.
    const start = '2024-01-05';
    const end = '2024-01-10';
    const nights = new Set(listStayNights(start, end));

    for (const day of listStayNights('2024-01-03', '2024-01-13')) {
      expect(isDateInStayRange(start, end, day)).toBe(nights.has(day));
    }
    expect(isDateInStayRange(start, end, '2024-01-10')).toBe(false);
  });

  it('treats a same-day room move as two stays, not a double booking', () => {
    const stay = (startDate: string, endDate: string) => ({
      startDate: startDate as ISODateString,
      endDate: endDate as ISODateString,
    });
    const outOfRoomOne = stay('2024-01-05', '2024-01-10');

    // Checking out on the 10th and into another room the same day is a move.
    expect(stayNightsOverlap(outOfRoomOne, stay('2024-01-10', '2024-01-12'))).toBe(false);
    // One night earlier and they really do share the night of the 9th.
    expect(stayNightsOverlap(outOfRoomOne, stay('2024-01-09', '2024-01-12'))).toBe(true);
  });
});

// ============================================================================
// Day keys — what the assignment forms actually write
// ============================================================================

describe('assignment day keys', () => {
  it('writes the day the guest reads off their own clock', () => {
    // `toLocalISODateString` is the app's canonical day key and is what both
    // assignment dialogs call on the picker's Dates.
    expect(toLocalISODateString(new Date(2024, 0, 5, 0, 0))).toBe('2024-01-05');
    expect(toLocalISODateString(new Date(2024, 0, 5, 14, 30))).toBe('2024-01-05');
    expect(toLocalISODateString(new Date(2024, 0, 5, 23, 59))).toBe('2024-01-05');
  });

  it('round-trips a stored key back to the same key', () => {
    // The dialogs hydrate the picker with `parseISO(storedKey)` and write the
    // selection back out with `toLocalISODateString`; that loop must be lossless
    // or an untouched assignment drifts a day every time it is opened.
    const stored = '2026-07-08';
    const [year, month, day] = stored.split('-').map(Number) as [number, number, number];
    expect(toLocalISODateString(new Date(year, month - 1, day))).toBe(stored);
  });

  it('reads the UTC calendar day of an instant', () => {
    // `toISODateString` answers a different question — which UTC day an instant
    // fell on — so it is fed UTC instants here, not local ones.
    expect(toISODateString(new Date(Date.UTC(2024, 0, 5)))).toBe('2024-01-05');
    expect(toISODateString(new Date(Date.UTC(2024, 0, 5, 8, 0)))).toBe('2024-01-05');
    expect(toISODateString(new Date(Date.UTC(2024, 0, 5, 23, 59, 59)))).toBe('2024-01-05');
  });

  it('round-trips a key through parseISODateString', () => {
    const parsed = parseISODateString('2024-01-05');
    expect(parsed).not.toBeNull();
    expect(toISODateString(parsed!)).toBe('2024-01-05');
  });

  it('rejects a day that does not exist', () => {
    expect(parseISODateString('2023-02-29')).toBeNull();
    expect(parseISODateString('05/01/2024')).toBeNull();
  });
});

// ============================================================================
// BUG-1 — the shipped autofill, driven for real
// ============================================================================

describe('BUG-1: assignment end date off-by-one, through the shipped autofill', () => {
  beforeAll(installPointerPolyfills);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAssignmentsByRoom.mockReturnValue([]);
    mockCheckConflict.mockResolvedValue(false);
    mockGetTransportsByPerson.mockReturnValue([
      transport('tr-arrival', 'arrival', ARRIVAL_DAY, 10),
      transport('tr-departure', 'departure', DEPARTURE_DAY, 6),
    ]);
  });

  it('stores the departure day as the check-out date, not the day after', async () => {
    const created = await autofillAndSubmit();

    expect(created).toEqual({
      roomId: ROOM.id,
      personId: ALICE.id,
      startDate: ARRIVAL_DAY,
      endDate: DEPARTURE_DAY,
    });
  });

  it('books exactly the nights the guest sleeps', async () => {
    const created = await autofillAndSubmit();

    const nights = listStayNights(created.startDate, created.endDate);
    expect(nights).toEqual(EXPECTED_NIGHTS);
    expect(nights).not.toContain(DEPARTURE_DAY);
    expect(nights).toHaveLength(6);
  });

  it('keeps the check-out day when the guest leaves just after midnight', async () => {
    mockGetTransportsByPerson.mockReturnValue([
      transport('tr-arrival', 'arrival', ARRIVAL_DAY, 10),
      transport('tr-departure', 'departure', DEPARTURE_DAY, 0),
    ]);

    const created = await autofillAndSubmit();

    expect(created.endDate).toBe(DEPARTURE_DAY);
  });

  it('keeps the check-out day when the guest leaves just before midnight', async () => {
    mockGetTransportsByPerson.mockReturnValue([
      transport('tr-arrival', 'arrival', ARRIVAL_DAY, 8),
      transport('tr-departure', 'departure', DEPARTURE_DAY, 23),
    ]);

    const created = await autofillAndSubmit();

    expect(created.endDate).toBe(DEPARTURE_DAY);
  });

  it('spans the earliest arrival and the latest departure', async () => {
    // A guest with a connecting leg has several of each; the room is needed for
    // the outer envelope.
    mockGetTransportsByPerson.mockReturnValue([
      transport('tr-a2', 'arrival', '2026-07-04', 9),
      transport('tr-a1', 'arrival', ARRIVAL_DAY, 22),
      transport('tr-d1', 'departure', '2026-07-05', 7),
      transport('tr-d2', 'departure', DEPARTURE_DAY, 6),
    ]);

    const created = await autofillAndSubmit();

    expect(created.startDate).toBe(ARRIVAL_DAY);
    expect(created.endDate).toBe(DEPARTURE_DAY);
  });

  it('leaves the dates empty, and the form unsubmittable, without transports', async () => {
    mockGetTransportsByPerson.mockReturnValue([]);
    const user = userEvent.setup();
    render(<RoomAssignmentSection roomId={ROOM.id} />, { withProviders: false });

    await user.click(screen.getByLabelText('assignments.assign'));
    await user.click(screen.getByRole('combobox', { name: 'assignments.person' }));
    await user.click(await screen.findByRole('option', { name: /Alice/ }));

    // No transports means no dates to borrow: the generic hint stays and the
    // guest must pick a range by hand.
    expect(screen.getByText('assignments.periodHint')).toBeInTheDocument();
    expect(screen.queryByText('assignments.autofilledFromTransport')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.add' })).toBeDisabled();
    expect(mockCreateAssignment).not.toHaveBeenCalled();
  });
});

// ============================================================================
// BUG-1 — the drag-and-drop pre-fill takes the same route
// ============================================================================

describe('BUG-1: the quick-assign dialog stores its suggested dates verbatim', () => {
  beforeAll(installPointerPolyfills);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAssignmentsByRoom.mockReturnValue([]);
    mockCheckConflict.mockResolvedValue(false);
  });

  it('creates the assignment on exactly the dropped guest’s dates', async () => {
    const user = userEvent.setup();
    render(
      <QuickAssignmentDialog
        open
        onOpenChange={vi.fn()}
        person={ALICE}
        roomId={ROOM.id}
        suggestedStartDate={ARRIVAL_DAY}
        suggestedEndDate={DEPARTURE_DAY}
      />,
      { withProviders: false },
    );

    const submit = screen.getByRole('button', { name: 'common.add' });
    await waitFor(() => {
      expect(submit).toBeEnabled();
    });
    await user.click(submit);

    await waitFor(() => {
      expect(mockCreateAssignment).toHaveBeenCalledWith({
        roomId: ROOM.id,
        personId: ALICE.id,
        startDate: ARRIVAL_DAY,
        endDate: DEPARTURE_DAY,
      });
    });
  });

  it('shows the suggested window on the picker without shifting it a day', async () => {
    render(
      <QuickAssignmentDialog
        open
        onOpenChange={vi.fn()}
        person={ALICE}
        roomId={ROOM.id}
        suggestedStartDate={ARRIVAL_DAY}
        suggestedEndDate={DEPARTURE_DAY}
      />,
      { withProviders: false },
    );

    // "Jul 2, 2026 → Jul 8, 2026" — the day numbers, not the day before.
    const picker = screen.getByRole('button', { name: 'assignments.period' });
    await waitFor(() => {
      expect(picker).toHaveTextContent(/Jul 2, 2026\s*→\s*Jul 8, 2026/);
    });
  });
});

// ============================================================================
// Display consistency — the timeline draws the nights the model lists
// ============================================================================

describe('display consistency', () => {
  it('draws a bar over exactly the nights listStayNights reports', () => {
    const assignment: RoomAssignment = {
      id: 'a1' as RoomAssignment['id'],
      tripId: TRIP.id,
      roomId: ROOM.id,
      personId: ALICE.id,
      startDate: ARRIVAL_DAY as ISODateString,
      endDate: DEPARTURE_DAY as ISODateString,
    };

    const model = buildRoomTimelineModel({
      trip: TRIP,
      range: { startDate: TRIP.startDate, endDate: TRIP.endDate },
      rooms: [ROOM],
      assignments: [assignment],
      personsById: new Map([[ALICE.id, ALICE]]),
      unknownLabel: 'unknown',
      arrivals: [],
      departures: [],
    });

    const item = model.rows[0]?.items[0];
    expect(item).toBeDefined();

    // The columns the bar covers are the nights, check-out day excluded…
    const drawnDays = model.dayKeys.slice(item!.startIndex, item!.endIndex + 1);
    expect(drawnDays).toEqual(EXPECTED_NIGHTS);
    // …and the label still reads as the check-in/check-out window it came from.
    expect(item!.displayStayStart).toBe(ARRIVAL_DAY);
    expect(item!.displayStayEnd).toBe(DEPARTURE_DAY);
  });

  it('draws nothing for a same-day check-in and check-out', () => {
    const dayVisit: RoomAssignment = {
      id: 'a2' as RoomAssignment['id'],
      tripId: TRIP.id,
      roomId: ROOM.id,
      personId: ALICE.id,
      startDate: ARRIVAL_DAY as ISODateString,
      endDate: ARRIVAL_DAY as ISODateString,
    };

    const model = buildRoomTimelineModel({
      trip: TRIP,
      range: { startDate: TRIP.startDate, endDate: TRIP.endDate },
      rooms: [ROOM],
      assignments: [dayVisit],
      personsById: new Map([[ALICE.id, ALICE]]),
      unknownLabel: 'unknown',
      arrivals: [],
      departures: [],
    });

    expect(listStayNights(dayVisit.startDate, dayVisit.endDate)).toEqual([]);
    expect(model.rows[0]?.items).toEqual([]);
  });
});
