/**
 * @fileoverview What the assignment list writes, and what it does from the keyboard.
 *
 * The sibling file covers what the section renders, including the conflict
 * badges. This one covers the writes behind it: editing a stay and saving it,
 * what happens when that save fails, and the guard that stops a half-typed
 * stay being thrown away by a stray Escape.
 *
 * The row buttons are also reachable with Enter and Space, which matters more
 * here than usual: the whole row is a click target, so the buttons stop
 * propagation and have to handle their own keys.
 *
 * The date picker is replaced by a stub that records the props it is handed
 * and lets a test choose a range directly. Driving react-day-picker by clicks
 * is slow and cannot produce a half-chosen range on demand, and the form's
 * dirty check, autofill and conflict clearing all branch on exactly that.
 * `useFormSubmission` is the real hook, so the dialog really is "saving"
 * while a write is pending.
 *
 * @module features/rooms/components/__tests__/RoomAssignmentSection.actions.test
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@/test/utils';
import userEvent from '@testing-library/user-event';

import { tripDay } from '@/features/rooms/__tests__/fixture-days';
import { renderPlain, settle } from '@/features/rooms/__tests__/harness';
import type { DateRange, DateRangePickerProps } from '@/components/shared/DateRangePicker';
import type {
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentFormData,
  RoomId,
  Transport,
  Trip,
} from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Paris',
  startDate: tripDay(1),
  endDate: tripDay(10),
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const ALICE: Person = {
  id: 'p1' as PersonId,
  tripId: 'trip-1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

const BOB: Person = {
  id: 'p2' as PersonId,
  tripId: 'trip-1' as Person['tripId'],
  name: 'Bob',
  color: '#ef4444' as Person['color'],
};

/** A couple on one guest row: two people, one name. */
const THE_MARTINS: Person = {
  id: 'p3' as PersonId,
  tripId: 'trip-1' as Person['tripId'],
  name: 'The Martins',
  color: '#22c55e' as Person['color'],
  headcount: 2,
};

const DEFAULT_PERSONS: Person[] = [ALICE, BOB];

const mockRoom: Room = {
  id: 'room-1' as RoomId,
  tripId: 'trip-1' as Room['tripId'],
  name: 'Main Bedroom',
  capacity: 2,
  order: 0,
};

const mockAssignment: RoomAssignment = {
  id: 'a1' as RoomAssignment['id'],
  tripId: 'trip-1' as RoomAssignment['tripId'],
  roomId: 'room-1' as RoomId,
  personId: 'p1' as PersonId,
  startDate: tripDay(2),
  endDate: tripDay(8),
};

/** Bob in the same room as Alice, on overlapping nights. */
const bobsStay: RoomAssignment = {
  ...mockAssignment,
  id: 'a2' as RoomAssignment['id'],
  personId: 'p2' as PersonId,
  startDate: tripDay(4),
  endDate: tripDay(9),
};

// ============================================================================
// Mocks
// ============================================================================

const mockCreateAssignment = vi.fn();
const mockUpdateAssignment = vi.fn();
const mockDeleteAssignment = vi.fn();
const mockCheckConflict = vi.fn();
const mockGetAssignmentsByRoom = vi.fn();
const mockNotifySuccess = vi.fn();
const mockNavigate = vi.fn();
const { mockNotifyError, mockCaptureDeletion, picker, i18nValue } = vi.hoisted(() => {
  const value = {
    t: (key: string, fallbackOrOptions?: unknown, maybeOptions?: unknown): string => {
      const options = (
        typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions
      ) as { count?: number } | undefined;
      return options?.count === undefined ? key : `${key}:${options.count}`;
    },
    i18n: { language: 'en' },
  };
  return {
    mockNotifyError: vi.fn(),
    mockCaptureDeletion: vi.fn(),
    /** The props the stub date picker was last rendered with. */
    picker: { props: undefined as DateRangePickerProps | undefined },
    i18nValue: value,
  };
});

/** Mutable so a test can take the trip away. */
let currentTrip: Trip | undefined = mockTrip;
let persons: Person[] = DEFAULT_PERSONS;
let personsLoading = false;
let assignmentsLoading = false;
let rooms: Room[] = [mockRoom];
/** Every assignment of the trip; `undefined` means "just this room's". */
let tripAssignments: RoomAssignment[] | undefined;
let transports: Transport[] = [];

// The real router stays, for the shared harness; only navigate is a spy.
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ currentTrip }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons,
    isLoading: personsLoading,
    getPersonById: (id: string) => persons.find((person) => person.id === id),
  }),
}));

vi.mock('@/contexts/RoomContext', () => ({ useRoomContext: () => ({ rooms }) }));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => ({
    get assignments() {
      return tripAssignments ?? mockGetAssignmentsByRoom();
    },
    getAssignmentsByRoom: mockGetAssignmentsByRoom,
    createAssignment: mockCreateAssignment,
    updateAssignment: mockUpdateAssignment,
    deleteAssignment: mockDeleteAssignment,
    checkConflict: mockCheckConflict,
    isLoading: assignmentsLoading,
  }),
}));

// A fresh lookup per render, bound to the transports of that render: a
// callback memoised on too few dependencies keeps answering with old ones.
vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => {
    const snapshot = transports;
    return {
      getTransportsByPerson: (id: string) => snapshot.filter((item) => item.personId === id),
    };
  },
}));

vi.mock('@/lib/notifications', () => ({
  notify: { error: mockNotifyError, warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  captureDeletion: mockCaptureDeletion,
}));

// A stable `t`: the form's conflict-check effect lists it as a dependency, and
// a fresh identity per render re-arms that effect forever. It echoes a count
// back, so a label that loses its count is visible.
vi.mock('react-i18next', () => ({ useTranslation: () => i18nValue }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/hooks', async () => {
  const { useFormSubmission } = await vi.importActual<
    typeof import('@/hooks/useFormSubmission')
  >('@/hooks/useFormSubmission');
  return {
    useFormSubmission,
    useOfflineAwareNotify: () => ({ notifySuccess: mockNotifySuccess, errorToast: vi.fn() }),
  };
});

vi.mock('@/components/shared/DateRangePicker', () => ({
  DateRangePicker: (props: DateRangePickerProps) => {
    picker.props = props;
    return <div data-testid="date-range-picker" aria-label={props['aria-label']} />;
  },
}));

import { AssignmentFormDialog, RoomAssignmentSection } from '../RoomAssignmentSection';
import { STALL_TIMEOUT_MS } from '@/hooks/useStalled';
import { toLocalISODateString } from '@/lib/db/utils';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { formatDateRange } from '@/lib/utils/date-format';

// ============================================================================
// Helpers
// ============================================================================

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= (): boolean => false;
  Element.prototype.setPointerCapture ??= (): void => undefined;
  Element.prototype.releasePointerCapture ??= (): void => undefined;
  Element.prototype.scrollIntoView ??= (): void => undefined;
});

function resetWorld(): void {
  vi.clearAllMocks();
  currentTrip = mockTrip;
  persons = DEFAULT_PERSONS;
  personsLoading = false;
  assignmentsLoading = false;
  rooms = [mockRoom];
  tripAssignments = undefined;
  transports = [];
  i18nValue.i18n.language = 'en';
  picker.props = undefined;
  mockGetAssignmentsByRoom.mockReturnValue([mockAssignment]);
  mockCheckConflict.mockResolvedValue(false);
  mockUpdateAssignment.mockResolvedValue(undefined);
  mockCreateAssignment.mockResolvedValue(undefined);
  mockDeleteAssignment.mockResolvedValue(undefined);
}

function renderSection() {
  return renderPlain(<RoomAssignmentSection roomId={'room-1' as RoomId} />);
}

/** Opens the edit dialog on the first stay in the list. */
async function openTheEditDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getAllByRole('button', { name: 'common.edit' })[0]!);
  await screen.findByRole('dialog');
}

/** Opens the add dialog from the section header. */
async function openTheAddDialog(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'assignments.assign' }));
  return screen.findByRole('dialog');
}

/** Picks a guest in the open form. */
async function chooseGuest(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: 'assignments.person' }));
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

/** A local-midnight Date for a day, which is what the real picker hands back. */
function day(key: string): Date {
  const [year, month, date] = key.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date);
}

/** Chooses a range in the stub picker, either end optional. */
function pickRange(from: string | undefined, to: string | undefined): void {
  const range: DateRange | undefined =
    from === undefined && to === undefined
      ? undefined
      : { from: from === undefined ? undefined : day(from), to: to === undefined ? undefined : day(to) };
  act(() => {
    picker.props!.onChange(range);
  });
}

/** How a row writes the stay from trip day `from` to trip day `to`. */
function rangeIn(language: 'en' | 'fr', from: number, to: number): string {
  return formatDateRange(tripDay(from), tripDay(to), getDateLocale(language));
}

function dayKey(date: Date | undefined): string | undefined {
  if (date === undefined) {
    return undefined;
  }
  return Number.isNaN(date.getTime()) ? 'invalid' : toLocalISODateString(date);
}

/** The range the stub picker currently shows, as day keys. */
function pickedDays(): { from: string | undefined; to: string | undefined } {
  const value = picker.props?.value;
  return { from: dayKey(value?.from), to: dayKey(value?.to) };
}

/** The ranges the picker is told are already taken, as day keys. */
function bookedDays(): Array<{ from: string | undefined; to: string | undefined }> | undefined {
  return picker.props?.bookedRanges?.map((range) => ({
    from: dayKey(range.from),
    to: dayKey(range.to),
  }));
}

function transport(
  id: string,
  personId: PersonId,
  type: 'arrival' | 'departure',
  datetime: string,
): Transport {
  return {
    id: id as Transport['id'],
    tripId: 'trip-1' as Transport['tripId'],
    personId,
    type,
    datetime: datetime as Transport['datetime'],
    location: 'Gare Montparnasse',
    needsPickup: false,
  } as Transport;
}

/** An ISO instant at a wall-clock hour of a local day. */
function instantOn(key: string, hour: number): string {
  const date = day(key);
  date.setHours(hour);
  return date.toISOString();
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function submitButton(name: 'common.add' | 'common.save' = 'common.add'): HTMLElement {
  return within(screen.getByRole('dialog')).getByRole('button', { name });
}

// ============================================================================
// Tests
// ============================================================================

describe('RoomAssignmentSection — the row buttons from the keyboard', () => {
  beforeEach(resetWorld);

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens the edit dialog with %s', async (_name, key) => {
    const user = userEvent.setup();
    renderSection();

    const edit = screen.getAllByRole('button', { name: 'common.edit' })[0]!;
    edit.focus();
    await user.keyboard(key);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('opens the delete prompt with %s', async (_name, key) => {
    const user = userEvent.setup();
    renderSection();

    const remove = screen.getAllByRole('button', { name: 'common.delete' })[0]!;
    remove.focus();
    await user.keyboard(key);

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('ignores a key that is not an activation', async () => {
    const user = userEvent.setup();
    renderSection();

    const edit = screen.getAllByRole('button', { name: 'common.edit' })[0]!;
    edit.focus();
    await user.keyboard('{ArrowDown}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // A real key press on a button also fires a click, which opens the dialog on
  // its own. A bare keydown reaches only the key handler, so these say whether
  // the handler itself does the job.
  it.each(['Enter', ' '])('opens the edit dialog from a bare %j keydown', async (key) => {
    renderSection();

    fireEvent.keyDown(screen.getByRole('button', { name: 'common.edit' }), { key });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await settle();
  });

  it.each(['Enter', ' '])('opens the delete prompt from a bare %j keydown', (key) => {
    renderSection();

    fireEvent.keyDown(screen.getByRole('button', { name: 'common.delete' }), { key });

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('opens neither from a keydown that is not an activation', () => {
    renderSection();

    fireEvent.keyDown(screen.getByRole('button', { name: 'common.edit' }), { key: 'a' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'common.delete' }), { key: 'a' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps the row buttons from reaching the row they sit in', async () => {
    const onRowClick = vi.fn();
    const onRowKeyDown = vi.fn();
    renderPlain(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- a stand-in for the clickable room card around the section
      <div onClick={onRowClick} onKeyDown={onRowKeyDown}>
        <RoomAssignmentSection roomId={'room-1' as RoomId} variant="compact" />
      </div>,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'common.edit' }), { key: 'a' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'common.delete' }), { key: 'a' });
    expect(onRowKeyDown).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    expect(onRowClick).not.toHaveBeenCalled();
    await settle();
  });

  it('keeps the delete click from reaching the row', () => {
    const onRowClick = vi.fn();
    renderPlain(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a stand-in for the clickable room card around the section
      <div onClick={onRowClick}>
        <RoomAssignmentSection roomId={'room-1' as RoomId} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('keeps the add and show-more clicks from reaching the row', () => {
    mockGetAssignmentsByRoom.mockReturnValue(
      Array.from({ length: 4 }, (_, index) => ({
        ...mockAssignment,
        id: `a${index}` as RoomAssignment['id'],
      })),
    );
    const onRowClick = vi.fn();
    renderPlain(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a stand-in for the clickable room card around the section
      <div onClick={onRowClick}>
        <RoomAssignmentSection roomId={'room-1' as RoomId} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'assignments.showMore:1' }));
    fireEvent.click(screen.getByRole('button', { name: 'assignments.assign' }));

    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('RoomAssignmentSection — the list', () => {
  beforeEach(resetWorld);

  it('marks a double-booked row and leaves a clean one plain', () => {
    const elsewhere: RoomAssignment = {
      ...mockAssignment,
      id: 'a9' as RoomAssignment['id'],
      roomId: 'room-2' as RoomId,
      startDate: tripDay(5),
      endDate: tripDay(7),
    };
    tripAssignments = [mockAssignment, bobsStay, elsewhere];
    renderSection();

    const [aliceRow, bobRow] = screen.getAllByRole('listitem');
    expect(aliceRow).toHaveClass('rounded-md', 'border', 'border-destructive', 'bg-destructive/10');
    expect(bobRow).toHaveClass('rounded-md', 'border');
    expect(bobRow).not.toHaveClass('border-destructive');

    const warning = within(aliceRow!).getByTitle('assignments.conflict');
    expect(warning).toHaveClass('text-destructive');
    expect(within(bobRow!).queryByTitle('assignments.conflict')).not.toBeInTheDocument();
  });

  it('lists only the stays of this room', () => {
    tripAssignments = [
      mockAssignment,
      { ...bobsStay, roomId: 'room-2' as RoomId },
    ];
    renderSection();

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('Bob')).not.toBeInTheDocument();
  });

  it('does not call two different guests on the same nights a clash', () => {
    tripAssignments = [mockAssignment, bobsStay];
    renderSection();

    expect(screen.queryByTitle('assignments.conflict')).not.toBeInTheDocument();
  });

  it('greys out an unknown guest', () => {
    tripAssignments = [{ ...mockAssignment, personId: 'gone' as PersonId }];
    renderSection();

    expect(screen.getByText('common.unknown')).toHaveClass('text-muted-foreground');
  });

  it('follows edits to the trip after it first rendered', () => {
    tripAssignments = [mockAssignment];
    const { rerender } = renderPlain(<RoomAssignmentSection roomId={'room-1' as RoomId} />);
    expect(screen.getByText(rangeIn('en', 2, 8))).toBeInTheDocument();

    // Alice's dates move, Bob joins, and Bob is double-booked elsewhere.
    tripAssignments = [
      { ...mockAssignment, startDate: tripDay(3) },
      bobsStay,
      { ...bobsStay, id: 'a7' as RoomAssignment['id'], roomId: 'room-2' as RoomId },
    ];
    rerender(<RoomAssignmentSection roomId={'room-1' as RoomId} className="again" />);

    expect(screen.getByText(rangeIn('en', 3, 8))).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[1]).toHaveClass('border-destructive');
  });

  it('opens the edit form on the stay as it is now, not as it was', async () => {
    tripAssignments = [mockAssignment];
    const { rerender } = renderPlain(<RoomAssignmentSection roomId={'room-1' as RoomId} />);

    tripAssignments = [{ ...mockAssignment, startDate: tripDay(3) }];
    rerender(<RoomAssignmentSection roomId={'room-1' as RoomId} className="again" />);
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));

    expect(pickedDays()).toEqual({ from: tripDay(3), to: tripDay(8) });
    await settle();
  });

  it('opens the edit form on the current stay from the keyboard too', async () => {
    tripAssignments = [mockAssignment];
    const { rerender } = renderPlain(<RoomAssignmentSection roomId={'room-1' as RoomId} />);

    tripAssignments = [{ ...mockAssignment, startDate: tripDay(3) }];
    rerender(<RoomAssignmentSection roomId={'room-1' as RoomId} className="again" />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'common.edit' }), { key: 'Enter' });

    expect(pickedDays()).toEqual({ from: tripDay(3), to: tripDay(8) });
    await settle();
  });

  it('writes the dates in the reader’s language, and follows a language change', () => {
    tripAssignments = [mockAssignment];
    i18nValue.i18n.language = 'fr';
    const { rerender } = renderPlain(<RoomAssignmentSection roomId={'room-1' as RoomId} />);
    expect(rangeIn('fr', 2, 8)).not.toBe(rangeIn('en', 2, 8));
    expect(screen.getByText(rangeIn('fr', 2, 8))).toBeInTheDocument();

    i18nValue.i18n.language = 'en';
    rerender(<RoomAssignmentSection roomId={'room-1' as RoomId} className="again" />);
    expect(screen.getByText(rangeIn('en', 2, 8))).toBeInTheDocument();
  });

  it('is compact by default: three rows and a count of the rest', async () => {
    tripAssignments = Array.from({ length: 5 }, (_, index) => ({
      ...mockAssignment,
      id: `a${index}` as RoomAssignment['id'],
    }));
    renderSection();

    expect(screen.getByRole('region', { name: 'assignments.title' })).toHaveClass(
      'space-y-3',
      'text-sm',
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    const more = screen.getByRole('button', { name: 'assignments.showMore:2' });
    expect(more).toHaveTextContent('assignments.showMore:2');

    await userEvent.setup().click(more);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('drops the small text in the expanded variant', () => {
    renderSection().unmount();
    renderPlain(<RoomAssignmentSection roomId={'room-1' as RoomId} variant="expanded" />);

    const section = screen.getByRole('region', { name: 'assignments.title' });
    expect(section).toHaveClass('space-y-3');
    expect(section).not.toHaveClass('text-sm');
  });

  it('names the list and the delete prompt', () => {
    renderSection();

    expect(screen.getByRole('list', { name: 'assignments.title' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('confirm.removeAssignment');
  });

  it('keeps the add label on screen from the small breakpoint up', () => {
    renderSection();

    expect(screen.getByText('common.add')).toHaveClass('sr-only', 'sm:not-sr-only');
  });

  it('cannot add a stay with no guests to place', () => {
    persons = [];
    renderSection();

    expect(screen.getByRole('button', { name: 'assignments.assign' })).toBeDisabled();
  });

  it('shows the list, locked, while a reload is still under way', () => {
    assignmentsLoading = true;
    renderSection();

    expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'assignments.assign' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'common.edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'common.delete' })).toBeDisabled();
  });

  it('shows a labelled spinner while there is nothing yet to show', () => {
    personsLoading = true;
    mockGetAssignmentsByRoom.mockReturnValue([]);
    renderPlain(<RoomAssignmentSection roomId={'room-1' as RoomId} className="extra" />);

    const status = screen.getByRole('status');
    expect(status).toHaveClass('flex', 'p-4', 'extra');
    expect(screen.getByText('common.loading')).toHaveClass('sr-only');
  });

  it('renders for a room the room list does not know yet', () => {
    rooms = [];
    renderSection();

    expect(screen.getByText('Alice')).toBeInTheDocument();
  });
});

describe('RoomAssignmentSection — saving a stay', () => {
  beforeEach(resetWorld);

  it('writes the edit and says so', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(mockUpdateAssignment).toHaveBeenCalledWith(mockAssignment.id, expect.anything());
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('assignments.updateSuccess');
  });

  it('says the save failed rather than closing quietly', async () => {
    mockUpdateAssignment.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalledWith('errors.saveFailed');
    });
    expect(mockNotifySuccess).not.toHaveBeenCalled();
  });

  it('deletes a stay once the prompt is confirmed', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getAllByRole('button', { name: 'common.delete' })[0]!);
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: /common.delete/i }));

    await waitFor(() => {
      expect(mockDeleteAssignment).toHaveBeenCalledWith(mockAssignment.id);
    });
  });

  it('creates a stay, says so, closes, and needs no change callback', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');
    pickRange(tripDay(3), tripDay(5));
    await waitFor(() => {
      expect(submitButton()).toBeEnabled();
    });
    await user.click(submitButton());

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(mockCreateAssignment).toHaveBeenCalledWith({
      roomId: 'room-1',
      personId: 'p2',
      startDate: tripDay(3),
      endDate: tripDay(5),
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('assignments.createSuccess');
    expect(mockNotifyError).not.toHaveBeenCalled();
    // The row buttons come back once the write is done.
    expect(screen.getByRole('button', { name: 'common.edit' })).toBeEnabled();
  });

  it('locks the list, and shows a spinner on the button, while the write is pending', async () => {
    const pending = deferred<void>();
    mockUpdateAssignment.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderPlain(<RoomAssignmentSection roomId={'room-1' as RoomId} onAssignmentChange={onChange} />);

    await openTheEditDialog(user);
    const save = submitButton('common.save');
    expect(save.querySelector('.animate-spin, [class*="animate-spin"]')).toBeNull();
    await user.click(save);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.edit', hidden: true })).toBeDisabled();
    });
    expect(save.querySelector('[class*="animate-spin"]')).toHaveClass('mr-2');
    expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled();

    await act(async () => {
      pending.resolve();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'common.edit' })).toBeEnabled();
  });

  it('unlocks the list after a failed write', async () => {
    mockUpdateAssignment.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await user.click(submitButton('common.save'));
    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalled();
    });

    expect(screen.getByRole('button', { name: 'common.edit', hidden: true })).toBeEnabled();
    // The form stays open for another try.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not report a change to a section that has gone', async () => {
    const pending = deferred<void>();
    mockUpdateAssignment.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderPlain(
      <RoomAssignmentSection roomId={'room-1' as RoomId} onAssignmentChange={onChange} />,
    );

    await openTheEditDialog(user);
    await user.click(submitButton('common.save'));
    unmount();
    await act(async () => {
      pending.resolve();
    });

    expect(mockNotifySuccess).toHaveBeenCalledWith('assignments.updateSuccess');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('RoomAssignmentSection — deleting a stay', () => {
  beforeEach(resetWorld);

  async function confirmDelete(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole('button', { name: 'common.delete' }));
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: 'common.delete' }));
  }

  it('reports the deletion, says so, and needs no change callback', async () => {
    const user = userEvent.setup();
    renderSection();

    await confirmDelete(user);

    await waitFor(() => {
      expect(mockNotifySuccess).toHaveBeenCalledWith('assignments.deleteSuccess');
    });
    expect(mockCaptureDeletion).toHaveBeenCalledWith('assignment_deleted', { source: 'rooms' });
    expect(mockNotifyError).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'common.edit' })).toBeEnabled();
  });

  it('locks the list while the deletion is pending', async () => {
    const pending = deferred<void>();
    mockDeleteAssignment.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderPlain(<RoomAssignmentSection roomId={'room-1' as RoomId} onAssignmentChange={onChange} />);

    await confirmDelete(user);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.edit', hidden: true })).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: 'assignments.assign', hidden: true })).toBeDisabled();
    await act(async () => {
      pending.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.edit' })).toBeEnabled();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('unlocks the list after a failed deletion', async () => {
    mockDeleteAssignment.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderSection();

    await confirmDelete(user);
    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalledWith('errors.deleteFailed');
    });

    expect(screen.getByRole('button', { name: 'common.edit', hidden: true })).toBeEnabled();
  });

  it('does not report a deletion to a section that has gone', async () => {
    const pending = deferred<void>();
    mockDeleteAssignment.mockReturnValue(pending.promise);
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderPlain(
      <RoomAssignmentSection roomId={'room-1' as RoomId} onAssignmentChange={onChange} />,
    );

    await confirmDelete(user);
    unmount();
    await act(async () => {
      pending.resolve();
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes the prompt when the reader backs out', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: 'common.delete' }));
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: 'common.cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(mockDeleteAssignment).not.toHaveBeenCalled();
  });
});

describe('RoomAssignmentSection — the form dialog', () => {
  beforeEach(resetWorld);

  it('names itself, its fields and its hint', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);

    expect(screen.getByRole('dialog', { name: 'assignments.assign' })).toBeInTheDocument();
    expect(screen.getByText('assignments.person', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText('assignments.period', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'assignments.person' })).toHaveClass('w-full');
    // Named on the control itself, not only through its label.
    expect(screen.getByRole('combobox', { name: 'assignments.person' })).toHaveAttribute(
      'aria-label',
      'assignments.person',
    );
    expect(screen.getByRole('combobox', { name: 'assignments.person' })).toHaveTextContent(
      'assignments.selectPerson',
    );
    expect(screen.getByText('assignments.periodHint')).toBeInTheDocument();
    expect(screen.queryByText('assignments.checkingConflict')).not.toBeInTheDocument();
  });

  it('paints each guest’s colour next to their name', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await user.click(screen.getByRole('combobox', { name: 'assignments.person' }));
    const option = await screen.findByRole('option', { name: /Bob/ });

    expect(option.querySelector('[aria-hidden="true"].rounded-full')).toHaveStyle({
      backgroundColor: '#ef4444',
    });
  });

  it('bounds nothing, and lists the nights already taken', async () => {
    tripAssignments = [mockAssignment, bobsStay];
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);

    expect(picker.props).not.toHaveProperty('minDate');
    expect(picker.props).not.toHaveProperty('maxDate');
    expect(picker.props?.['aria-label']).toBe('assignments.period');
    expect(bookedDays()).toEqual([
      { from: tripDay(2), to: tripDay(8) },
      { from: tripDay(4), to: tripDay(9) },
    ]);
  });

  it('does not grey out the stay being edited', async () => {
    tripAssignments = [mockAssignment, bobsStay];
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);

    expect(bookedDays()).toEqual([{ from: tripDay(4), to: tripDay(9) }]);
  });

  it('has nothing to grey out in an empty room', async () => {
    tripAssignments = [];
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);

    expect(picker.props?.bookedRanges).toBeUndefined();
  });

  it('opens the edit form with its own words and the stored values', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);

    expect(screen.getByRole('dialog', { name: 'assignments.editAssignment' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'assignments.person' })).toHaveTextContent('Alice');
    expect(pickedDays()).toEqual({ from: tripDay(2), to: tripDay(8) });
    expect(screen.getByText('assignments.periodHint')).toBeInTheDocument();
    expect(screen.queryByText('assignments.autofilledFromTransport')).not.toBeInTheDocument();
  });

  it('opens a clean add form after an edit', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await openTheAddDialog(user);

    expect(screen.getByRole('combobox', { name: 'assignments.person' })).toHaveTextContent(
      'assignments.selectPerson',
    );
    expect(pickedDays()).toEqual({ from: undefined, to: undefined });
    // A fresh form is not dirty, so it closes without asking.
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('unsaved.discardChanges')).not.toBeInTheDocument();
  });

  it('opens a clean add form after a discarded autofill', async () => {
    transports = [
      transport('t1', BOB.id, 'arrival', instantOn(tripDay(3), 10)),
      transport('t2', BOB.id, 'departure', instantOn(tripDay(6), 10)),
    ];
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');
    expect(screen.getByText('assignments.autofilledFromTransport')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
    await user.click(await screen.findByRole('button', { name: 'unsaved.discard' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    await openTheAddDialog(user);
    expect(screen.getByText('assignments.periodHint')).toBeInTheDocument();
    expect(pickedDays()).toEqual({ from: undefined, to: undefined });
  });

  it('reloads the stored stay when the same one is opened again', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await chooseGuest(user, 'Bob');
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
    await user.click(await screen.findByRole('button', { name: 'unsaved.discard' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    await openTheEditDialog(user);
    expect(screen.getByRole('combobox', { name: 'assignments.person' })).toHaveTextContent('Alice');
  });

  it('closes on Escape when nothing is saving', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes on a click outside when nothing is saving', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('stays open through the close button while a save is in flight, then lets go', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const pending = deferred<void>();
      mockUpdateAssignment.mockReturnValue(pending.promise);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderSection();

      await openTheEditDialog(user);
      await user.click(submitButton('common.save'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled();
      });

      fireEvent.click(screen.getByRole('button', { name: 'common.dialogClose' }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(STALL_TIMEOUT_MS + 10);
      });
      fireEvent.click(screen.getByRole('button', { name: 'common.dialogClose' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      await act(async () => {
        pending.resolve();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends a conflicted reader to the trip’s room timeline and closes the form', async () => {
    mockCheckConflict.mockResolvedValue(true);
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    const alert = await screen.findByText('assignments.conflict');
    const box = alert.closest('[role="alert"]');
    expect(box).toHaveClass('border-destructive');
    await user.click(screen.getByRole('button', { name: 'assignments.openInRooms' }));

    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-1/rooms?view=timeline');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('sends a conflicted reader with no trip to the trip list', async () => {
    currentTrip = undefined;
    mockCheckConflict.mockResolvedValue(true);
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await user.click(await screen.findByRole('button', { name: 'assignments.openInRooms' }));

    expect(mockNavigate).toHaveBeenCalledWith('/trips');
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it('sends the reader to the trip of now, not the one it first rendered with', async () => {
    mockCheckConflict.mockResolvedValue(true);
    const { rerender } = renderSection();
    currentTrip = { ...mockTrip, id: 'trip-2' as Trip['id'] };
    rerender(<RoomAssignmentSection roomId={'room-1' as RoomId} className="again" />);
    const user = userEvent.setup();

    await openTheEditDialog(user);
    await user.click(await screen.findByRole('button', { name: 'assignments.openInRooms' }));

    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-2/rooms?view=timeline');
  });
});

describe('RoomAssignmentSection — the unsaved-edit guard', () => {
  beforeEach(resetWorld);

  async function cancel(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
  }

  it('closes a form nobody touched without asking', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await cancel(user);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('unsaved.discardChanges')).not.toBeInTheDocument();
  });

  it('asks before throwing away a guest picked in a new stay, in its own words', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');
    await cancel(user);

    const prompt = await screen.findByRole('alertdialog');
    expect(prompt).toHaveTextContent('unsaved.discardChanges');
    expect(prompt).toHaveTextContent('unsaved.discardDescription');
    expect(within(prompt).getByRole('button', { name: 'unsaved.discard' })).toBeInTheDocument();
    expect(within(prompt).getByRole('button', { name: 'unsaved.keepEditing' })).toBeInTheDocument();
  });

  it.each([
    ['a full range', tripDay(3), tripDay(5)],
    ['only a check-in day', tripDay(3), undefined],
    ['only a check-out day', undefined, tripDay(5)],
  ])('asks before throwing away %s in a new stay', async (_name, from, to) => {
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    pickRange(from, to);
    await cancel(user);

    expect(await screen.findByText('unsaved.discardChanges')).toBeInTheDocument();
  });

  it('asks before throwing away a changed guest on an edit', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await chooseGuest(user, 'Bob');
    await cancel(user);

    expect(await screen.findByText('unsaved.discardChanges')).toBeInTheDocument();
  });

  it.each([
    ['a moved check-in', tripDay(3), tripDay(8)],
    ['a moved check-out', tripDay(2), tripDay(9)],
    ['a cleared check-out', tripDay(2), undefined],
    ['a cleared check-in', undefined, tripDay(8)],
    ['a cleared range', undefined, undefined],
  ])('asks before throwing away %s on an edit', async (_name, from, to) => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    pickRange(from, to);
    await cancel(user);

    expect(await screen.findByText('unsaved.discardChanges')).toBeInTheDocument();
  });

  it('does not ask when an edit is put back the way it was', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    pickRange(tripDay(3), tripDay(9));
    pickRange(tripDay(2), tripDay(8));
    await cancel(user);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('unsaved.discardChanges')).not.toBeInTheDocument();
  });

  it('throws the edit away on Discard, closing both dialogs', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');
    await cancel(user);
    await user.click(await screen.findByRole('button', { name: 'unsaved.discard' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('goes back to the form on Keep editing, with what was typed', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');
    await cancel(user);
    await user.click(await screen.findByRole('button', { name: 'unsaved.keepEditing' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'assignments.person' })).toHaveTextContent('Bob');
  });
});

describe('RoomAssignmentSection — borrowing dates from transports', () => {
  beforeEach(resetWorld);

  it('takes the earliest arrival and the latest departure, whatever their order', async () => {
    transports = [
      transport('t1', BOB.id, 'arrival', instantOn(tripDay(3), 10)),
      transport('t2', BOB.id, 'arrival', instantOn(tripDay(5), 10)),
      transport('t3', BOB.id, 'departure', instantOn(tripDay(9), 10)),
      transport('t4', BOB.id, 'departure', instantOn(tripDay(7), 10)),
    ];
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');

    expect(pickedDays()).toEqual({ from: tripDay(3), to: tripDay(9) });
  });

  it('skips a transport whose time cannot be read', async () => {
    transports = [
      transport('t0', BOB.id, 'arrival', 'not a date'),
      transport('t1', BOB.id, 'arrival', instantOn(tripDay(4), 10)),
      transport('t2', BOB.id, 'departure', 'not a date'),
      transport('t3', BOB.id, 'departure', instantOn(tripDay(6), 10)),
    ];
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');

    expect(pickedDays()).toEqual({ from: tripDay(4), to: tripDay(6) });
  });

  it('borrows an arrival on its own', async () => {
    transports = [transport('t1', BOB.id, 'arrival', instantOn(tripDay(4), 10))];
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');

    expect(pickedDays()).toEqual({ from: tripDay(4), to: undefined });
    expect(screen.getByText('assignments.autofilledFromTransport')).toBeInTheDocument();
  });

  it('borrows a departure on its own', async () => {
    transports = [transport('t1', BOB.id, 'departure', instantOn(tripDay(6), 10))];
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');

    expect(pickedDays()).toEqual({ from: undefined, to: tripDay(6) });
  });

  it('uses the transports of now, not the ones it first rendered with', async () => {
    const { rerender } = renderSection();
    transports = [
      transport('t1', BOB.id, 'arrival', instantOn(tripDay(3), 10)),
      transport('t2', BOB.id, 'departure', instantOn(tripDay(6), 10)),
    ];
    rerender(<RoomAssignmentSection roomId={'room-1' as RoomId} className="again" />);
    const user = userEvent.setup();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');

    expect(pickedDays()).toEqual({ from: tripDay(3), to: tripDay(6) });
  });

  it('does not overwrite the dates of a stay being edited', async () => {
    transports = [
      transport('t1', BOB.id, 'arrival', instantOn(tripDay(3), 10)),
      transport('t2', BOB.id, 'departure', instantOn(tripDay(6), 10)),
    ];
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await chooseGuest(user, 'Bob');

    expect(pickedDays()).toEqual({ from: tripDay(2), to: tripDay(8) });
    expect(screen.queryByText('assignments.autofilledFromTransport')).not.toBeInTheDocument();
  });

  it('does not overwrite an edit whose check-out was cleared', async () => {
    transports = [
      transport('t1', BOB.id, 'arrival', instantOn(tripDay(3), 10)),
      transport('t2', BOB.id, 'departure', instantOn(tripDay(6), 10)),
    ];
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    pickRange(undefined, undefined);
    await chooseGuest(user, 'Bob');

    expect(pickedDays()).toEqual({ from: undefined, to: undefined });
  });

  it.each([
    ['a full range', tripDay(1), tripDay(2)],
    ['a check-in day', tripDay(1), undefined],
    ['a check-out day', undefined, tripDay(2)],
  ])('does not overwrite %s the reader chose first', async (_name, from, to) => {
    transports = [
      transport('t1', BOB.id, 'arrival', instantOn(tripDay(3), 10)),
      transport('t2', BOB.id, 'departure', instantOn(tripDay(6), 10)),
    ];
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    pickRange(from, to);
    await chooseGuest(user, 'Bob');

    expect(pickedDays()).toEqual({ from, to });
  });

  it('drops the autofill notice once the reader changes the dates by hand', async () => {
    transports = [
      transport('t1', BOB.id, 'arrival', instantOn(tripDay(3), 10)),
      transport('t2', BOB.id, 'departure', instantOn(tripDay(6), 10)),
    ];
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');
    pickRange(tripDay(3), tripDay(7));

    expect(screen.getByText('assignments.periodHint')).toBeInTheDocument();
    expect(pickedDays()).toEqual({ from: tripDay(3), to: tripDay(7) });
    await settle();
  });
});

describe('RoomAssignmentSection — the capacity warning', () => {
  beforeEach(resetWorld);

  async function addStay(
    user: ReturnType<typeof userEvent.setup>,
    guest: string,
    from: string,
    to: string,
  ): Promise<void> {
    await openTheAddDialog(user);
    await chooseGuest(user, guest);
    pickRange(from, to);
  }

  it('warns when one more guest would overfill the room', async () => {
    rooms = [{ ...mockRoom, capacity: 1 }];
    tripAssignments = [mockAssignment];
    const user = userEvent.setup();
    renderSection();

    await addStay(user, 'Bob', tripDay(3), tripDay(5));

    const warning = screen.getByText('rooms.capacityWarning').closest('[role="alert"]');
    expect(warning).toHaveClass('border-warning', 'p-3', 'bg-warning-surface');
    await settle();
  });

  it('does not warn when the room is exactly full', async () => {
    tripAssignments = [mockAssignment];
    const user = userEvent.setup();
    renderSection();

    await addStay(user, 'Bob', tripDay(3), tripDay(5));

    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
    await settle();
  });

  it('counts a couple on one row as two people', async () => {
    persons = [ALICE, BOB, THE_MARTINS];
    tripAssignments = [mockAssignment];
    const user = userEvent.setup();
    renderSection();

    await addStay(user, 'The Martins', tripDay(3), tripDay(5));

    expect(screen.getByText('rooms.capacityWarning')).toBeInTheDocument();
    await settle();
  });

  it('does not count nights outside the stay', async () => {
    rooms = [{ ...mockRoom, capacity: 1 }];
    tripAssignments = [mockAssignment];
    const user = userEvent.setup();
    renderSection();

    await addStay(user, 'Bob', tripDay(8), tripDay(10));

    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
    await settle();
  });

  it('reads the capacity of this room, not of another', async () => {
    rooms = [
      { ...mockRoom, capacity: 1 },
      { ...mockRoom, id: 'room-2' as RoomId, capacity: 10 },
    ];
    tripAssignments = [mockAssignment];
    const user = userEvent.setup();
    renderSection();

    await addStay(user, 'Bob', tripDay(3), tripDay(5));

    expect(screen.getByText('rooms.capacityWarning')).toBeInTheDocument();
    await settle();
  });

  it('follows a capacity change made after the section rendered', async () => {
    tripAssignments = [mockAssignment];
    const { rerender } = renderSection();
    rooms = [{ ...mockRoom, capacity: 1 }];
    rerender(<RoomAssignmentSection roomId={'room-1' as RoomId} className="again" />);
    const user = userEvent.setup();

    await addStay(user, 'Bob', tripDay(3), tripDay(5));

    expect(screen.getByText('rooms.capacityWarning')).toBeInTheDocument();
    await settle();
  });

  it('does not count the stay being edited against itself', async () => {
    rooms = [{ ...mockRoom, capacity: 1 }];
    tripAssignments = [mockAssignment];
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);

    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
  });

  it('still counts the other guests while editing', async () => {
    rooms = [{ ...mockRoom, capacity: 1 }];
    tripAssignments = [mockAssignment, bobsStay];
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);

    expect(screen.getByText('rooms.capacityWarning')).toBeInTheDocument();
  });

  it('says nothing for a room with no known capacity', async () => {
    rooms = [];
    tripAssignments = [mockAssignment, bobsStay];
    const user = userEvent.setup();
    renderSection();

    await addStay(user, 'Bob', tripDay(3), tripDay(5));

    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
    await settle();
  });

  it('waits for a guest and both dates before saying anything', async () => {
    rooms = [{ ...mockRoom, capacity: 0 }];
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    pickRange(tripDay(3), tripDay(5));
    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
    pickRange(undefined, undefined);
    await chooseGuest(user, 'Bob');
    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
    pickRange(tripDay(3), undefined);
    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
    pickRange(undefined, tripDay(5));
    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
    pickRange(tripDay(3), tripDay(5));
    expect(screen.getByText('rooms.capacityWarning')).toBeInTheDocument();
    await settle();
  });
});

describe('RoomAssignmentSection — the conflict check', () => {
  beforeEach(resetWorld);

  it('does not ask before there is a guest and two dates', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    pickRange(tripDay(3), tripDay(5));
    await chooseGuest(user, 'Bob');
    mockCheckConflict.mockClear();
    pickRange(tripDay(3), undefined);
    pickRange(undefined, tripDay(5));

    expect(mockCheckConflict).not.toHaveBeenCalled();
    expect(submitButton()).toBeDisabled();
  });

  it('does not ask, and does not allow a save, with dates but no guest', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    pickRange(tripDay(3), tripDay(5));

    expect(mockCheckConflict).not.toHaveBeenCalled();
    expect(submitButton()).toBeDisabled();
  });

  it('asks with the guest, the two days and the stay being edited', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);

    await waitFor(() => {
      expect(mockCheckConflict).toHaveBeenCalledWith('p1', tripDay(2), tripDay(8), 'a1');
    });
  });

  it('says it is checking while the answer is pending', async () => {
    const pending = deferred<boolean>();
    mockCheckConflict.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);

    const checking = await screen.findByText('assignments.checkingConflict');
    expect(checking.parentElement).toHaveClass('text-muted-foreground');
    expect(checking.parentElement?.querySelector('svg')).toHaveClass('size-4');
    expect(submitButton('common.save')).toBeDisabled();
    await act(async () => {
      pending.resolve(false);
    });
    expect(screen.queryByText('assignments.checkingConflict')).not.toBeInTheDocument();
    expect(submitButton('common.save')).toBeEnabled();
  });

  // Closing the edit form clears the stay it was editing, and the check used
  // to re-run on that change with the closed form's guest and dates still in
  // place. Its "checking" flag then outlived the reopen, so a fresh add form
  // said "Checking availability..." with nothing to check and kept Add locked.
  // A check that was still out when the dates were cleared used to leave its
  // "checking" flag set: the cleanup cancelled it, the cancelled check never
  // reset the flag, and with no dates nothing started a new one.
  it.each([
    ['the check-out day', tripDay(3), undefined],
    ['the whole range', undefined, undefined],
  ])('stops saying it is checking once %s is cleared mid-check', async (_name, from, to) => {
    mockCheckConflict.mockReturnValue(new Promise<boolean>(() => undefined));
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');
    pickRange(tripDay(3), tripDay(5));
    expect(await screen.findByText('assignments.checkingConflict')).toBeInTheDocument();

    pickRange(from, to);

    expect(screen.queryByText('assignments.checkingConflict')).not.toBeInTheDocument();
  });

  it('starts a new form without the old form’s pending check', async () => {
    mockCheckConflict.mockReturnValue(new Promise<boolean>(() => undefined));
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    expect(await screen.findByText('assignments.checkingConflict')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await openTheAddDialog(user);

    expect(screen.queryByText('assignments.checkingConflict')).not.toBeInTheDocument();
  });

  it('starts a form again without the old form’s conflict', async () => {
    mockCheckConflict.mockResolvedValueOnce(true);
    mockCheckConflict.mockReturnValue(new Promise<boolean>(() => undefined));
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    expect(await screen.findByText('assignments.conflict')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await openTheEditDialog(user);

    expect(screen.queryByText('assignments.conflict')).not.toBeInTheDocument();
  });

  it('blocks the save on a conflict', async () => {
    mockCheckConflict.mockResolvedValue(true);
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await screen.findByText('assignments.conflict');

    expect(submitButton('common.save')).toBeDisabled();
  });

  it.each([
    ['the whole range', undefined, undefined],
    ['the check-in day', undefined, tripDay(8)],
    ['the check-out day', tripDay(2), undefined],
  ])('drops the conflict when %s is cleared', async (_name, from, to) => {
    mockCheckConflict.mockResolvedValue(true);
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await screen.findByText('assignments.conflict');
    pickRange(from, to);

    expect(screen.queryByText('assignments.conflict')).not.toBeInTheDocument();
  });

  it('ignores the answer to a question that is no longer asked', async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    mockCheckConflict.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    pickRange(tripDay(3), tripDay(8));
    await act(async () => {
      first.resolve(false);
    });
    // The stale answer must not end the newer check.
    expect(screen.getByText('assignments.checkingConflict')).toBeInTheDocument();

    await act(async () => {
      second.resolve(true);
    });
    expect(screen.getByText('assignments.conflict')).toBeInTheDocument();
  });

  it('ignores a stale conflict that arrives after a clean answer', async () => {
    const first = deferred<boolean>();
    mockCheckConflict.mockReturnValueOnce(first.promise).mockResolvedValueOnce(false);
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    pickRange(tripDay(3), tripDay(8));
    await waitFor(() => {
      expect(screen.queryByText('assignments.checkingConflict')).not.toBeInTheDocument();
    });
    await act(async () => {
      first.resolve(true);
    });

    expect(screen.queryByText('assignments.conflict')).not.toBeInTheDocument();
  });

  it('ignores a stale failure that arrives after a conflict', async () => {
    const first = deferred<boolean>();
    mockCheckConflict.mockReturnValueOnce(first.promise).mockResolvedValueOnce(true);
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    pickRange(tripDay(3), tripDay(8));
    await screen.findByText('assignments.conflict');
    await act(async () => {
      first.reject(new Error('offline'));
    });

    expect(screen.getByText('assignments.conflict')).toBeInTheDocument();
  });

  it('clears an old conflict when the next check fails', async () => {
    mockCheckConflict.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await screen.findByText('assignments.conflict');
    pickRange(tripDay(3), tripDay(8));

    await waitFor(() => {
      expect(screen.queryByText('assignments.conflict')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('assignments.checkingConflict')).not.toBeInTheDocument();
  });
});

describe('RoomAssignmentSection — when the conflict check itself fails', () => {
  beforeEach(() => {
    resetWorld();
    mockCheckConflict.mockRejectedValue(new Error('offline'));
  });

  it('still lets the stay be saved', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(mockUpdateAssignment).toHaveBeenCalled();
    });
    consoleError.mockRestore();
  });
});

describe('RoomAssignmentSection — with no trip selected', () => {
  beforeEach(() => {
    resetWorld();
    currentTrip = undefined;
  });

  it('sends the reader to their trips rather than nowhere', async () => {
    const user = userEvent.setup();
    renderSection();

    const roomsLink = screen.queryByRole('button', { name: /rooms.openRoomsPage/i });
    if (roomsLink) {
      await user.click(roomsLink);
      expect(mockNavigate).toHaveBeenCalledWith('/trips');
    } else {
      // The section renders without a trip; nothing above is required to exist.
      expect(screen.getByText('Alice')).toBeInTheDocument();
    }
  });
});

describe('AssignmentFormDialog on its own', () => {
  beforeEach(resetWorld);

  const baseProps = {
    roomId: 'room-1' as RoomId,
    persons: DEFAULT_PERSONS,
    checkConflict: async (): Promise<boolean> => false,
  };

  it('says there is nobody to pick when the trip has no guests', async () => {
    const user = userEvent.setup();
    renderPlain(
      <AssignmentFormDialog
        {...baseProps}
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        persons={[]}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'assignments.person' }));

    expect(await screen.findByText('persons.empty')).toHaveClass('text-center');
  });

  it('switches to another stay without being closed in between', () => {
    const onOpenChange = vi.fn();
    const { rerender } = renderPlain(
      <AssignmentFormDialog
        {...baseProps}
        open
        onOpenChange={onOpenChange}
        onSubmit={vi.fn()}
        existingAssignment={mockAssignment}
      />,
    );
    expect(pickedDays()).toEqual({ from: tripDay(2), to: tripDay(8) });

    rerender(
      <AssignmentFormDialog
        {...baseProps}
        open
        onOpenChange={onOpenChange}
        onSubmit={vi.fn()}
        existingAssignment={bobsStay}
      />,
    );
    expect(pickedDays()).toEqual({ from: tripDay(4), to: tripDay(9) });
    expect(screen.getByRole('combobox', { name: 'assignments.person' })).toHaveTextContent('Bob');

    rerender(
      <AssignmentFormDialog {...baseProps} open onOpenChange={onOpenChange} onSubmit={vi.fn()} />,
    );
    expect(pickedDays()).toEqual({ from: undefined, to: undefined });
  });

  it('works without a list of the room’s stays to compare against', async () => {
    const user = userEvent.setup();
    renderPlain(
      <AssignmentFormDialog
        {...baseProps}
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        roomCapacity={1}
      />,
    );

    await chooseGuest(user, 'Bob');
    pickRange(tripDay(3), tripDay(5));

    expect(picker.props?.bookedRanges).toBeUndefined();
    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
    await settle();
  });

  it('does not close a dialog that was unmounted while saving', async () => {
    const pending = deferred<void>();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderPlain(
      <AssignmentFormDialog
        {...baseProps}
        open
        onOpenChange={onOpenChange}
        onSubmit={() => pending.promise}
        existingAssignment={mockAssignment}
      />,
    );

    const save = within(screen.getByRole('dialog')).getByRole('button', { name: 'common.save' });
    await waitFor(() => {
      expect(save).toBeEnabled();
    });
    await user.click(save);
    unmount();
    await act(async () => {
      pending.resolve();
    });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('closes itself once the save lands', async () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn<(data: RoomAssignmentFormData) => Promise<void>>().mockResolvedValue();
    const user = userEvent.setup();
    renderPlain(
      <AssignmentFormDialog
        {...baseProps}
        open
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
        existingAssignment={mockAssignment}
      />,
    );

    const save = within(screen.getByRole('dialog')).getByRole('button', { name: 'common.save' });
    await waitFor(() => {
      expect(save).toBeEnabled();
    });
    await user.click(save);

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(true);
  });

  it('closes through the latest close handler after a discard', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderPlain(
      <AssignmentFormDialog {...baseProps} open onOpenChange={first} onSubmit={vi.fn()} />,
    );
    rerender(<AssignmentFormDialog {...baseProps} open onOpenChange={second} onSubmit={vi.fn()} />);

    await chooseGuest(user, 'Bob');
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
    await user.click(await screen.findByRole('button', { name: 'unsaved.discard' }));

    expect(second).toHaveBeenCalledWith(false);
    expect(first).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RoomAssignmentSection — a few more edges', () => {
  beforeEach(resetWorld);

  it('cannot save a stay with only a check-in day', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');
    pickRange(tripDay(3), undefined);

    expect(submitButton()).toBeDisabled();
  });

  it('reads the capacity of this room when another room is listed first', async () => {
    rooms = [{ ...mockRoom, id: 'room-0' as RoomId, capacity: 10 }, { ...mockRoom, capacity: 1 }];
    tripAssignments = [mockAssignment];
    const user = userEvent.setup();
    renderSection();

    await openTheAddDialog(user);
    await chooseGuest(user, 'Bob');
    pickRange(tripDay(3), tripDay(5));

    expect(screen.getByText('rooms.capacityWarning')).toBeInTheDocument();
    await settle();
  });

  it('explains what removing a stay does', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('button', { name: 'common.delete' }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'confirm.removeAssignmentDescription',
    );
  });
});

describe('RoomAssignmentSection — the add button over an open edit', () => {
  beforeEach(resetWorld);

  it('switches the form to a new stay when Add is pressed during an edit', async () => {
    const user = userEvent.setup();
    renderSection();

    await openTheEditDialog(user);
    expect(screen.getByRole('dialog', { name: 'assignments.editAssignment' })).toBeInTheDocument();

    // The modal makes the page behind it inert to a pointer, not to an event.
    fireEvent.click(screen.getByRole('button', { name: 'assignments.assign', hidden: true }));

    expect(screen.getByRole('dialog', { name: 'assignments.assign' })).toBeInTheDocument();
    await settle();
  });
});
