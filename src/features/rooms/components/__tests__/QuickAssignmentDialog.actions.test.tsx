/**
 * @fileoverview The quick-assign dialog's form logic: what it starts on, when it
 * asks before closing, what it warns about, and how it saves.
 *
 * The sibling file drives the real date picker and checks what it shows. This
 * one swaps the picker for a stub that records its props and lets a test pick
 * a range directly, half-chosen ranges included, and uses the real
 * `useFormSubmission`, so the dialog really is "saving" while a write is
 * pending.
 *
 * @module features/rooms/components/__tests__/QuickAssignmentDialog.actions.test
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

import { tripDay } from '@/features/rooms/__tests__/fixture-days';
import { renderPlain, settle } from '@/features/rooms/__tests__/harness';
import { act, fireEvent, screen, waitFor, within } from '@/test/utils';
import userEvent from '@testing-library/user-event';

import type { DateRange, DateRangePickerProps } from '@/components/shared/DateRangePicker';
import type { Person, PersonId, Room, RoomAssignment, RoomId, Trip } from '@/types';

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

const ALICE: Person = {
  id: 'p1' as PersonId,
  tripId: TRIP.id,
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

const BOB: Person = {
  id: 'p2' as PersonId,
  tripId: TRIP.id,
  name: 'Bob',
  color: '#ef4444' as Person['color'],
};

const ATTIC: Room = {
  id: 'room-1' as RoomId,
  tripId: TRIP.id,
  name: 'Attic',
  capacity: 2,
  order: 0,
};

function stay(id: string, personId: PersonId, startDate: string, endDate: string): RoomAssignment {
  return {
    id: id as RoomAssignment['id'],
    tripId: TRIP.id,
    roomId: ATTIC.id,
    personId,
    startDate: startDate as RoomAssignment['startDate'],
    endDate: endDate as RoomAssignment['endDate'],
  };
}

// ============================================================================
// Mocks
// ============================================================================

const { picker, mockNotifySuccess } = vi.hoisted(() => ({
  picker: { props: undefined as DateRangePickerProps | undefined },
  mockNotifySuccess: vi.fn(),
}));

const mockCreateAssignment = vi.fn();
const mockCheckConflict = vi.fn();
let currentTrip: Trip | undefined = TRIP;
let persons: Person[] = [ALICE, BOB];
let rooms: Room[] = [ATTIC];
let roomStays: RoomAssignment[] = [];

vi.mock('@/contexts/TripContext', () => ({ useTripContext: () => ({ currentTrip }) }));
vi.mock('@/contexts/PersonContext', () => ({ usePersonContext: () => ({ persons }) }));
vi.mock('@/contexts/RoomContext', () => ({ useRoomContext: () => ({ rooms }) }));
vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => {
    const snapshot = roomStays;
    return {
      createAssignment: mockCreateAssignment,
      checkConflict: mockCheckConflict,
      getAssignmentsByRoom: (roomId: string) => snapshot.filter((item) => item.roomId === roomId),
    };
  },
}));

// A stable `t`: the conflict-check effect lists it as a dependency.
vi.mock('react-i18next', () => {
  const value = { t: (key: string) => key, i18n: { language: 'en' } };
  return { useTranslation: () => value };
});

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
    return <div data-testid="date-range-picker" />;
  },
}));

import { QuickAssignmentDialog } from '../QuickAssignmentDialog';
import { STALL_TIMEOUT_MS } from '@/hooks/useStalled';
import { toLocalISODateString } from '@/lib/db/utils';

// ============================================================================
// Helpers
// ============================================================================

type DialogProps = Parameters<typeof QuickAssignmentDialog>[0];

const DRAGGED: DialogProps = {
  open: true,
  onOpenChange: vi.fn(),
  person: ALICE,
  roomId: ATTIC.id,
  suggestedStartDate: tripDay(2),
  suggestedEndDate: tripDay(5),
};

function day(key: string): Date {
  const [year, month, date] = key.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, date);
}

function pickRange(from: string | undefined, to: string | undefined): void {
  const range: DateRange | undefined =
    from === undefined && to === undefined
      ? undefined
      : { from: from === undefined ? undefined : day(from), to: to === undefined ? undefined : day(to) };
  act(() => {
    picker.props!.onChange(range);
  });
}

function dayKey(date: Date | undefined): string | undefined {
  return date === undefined ? undefined : toLocalISODateString(date);
}

function pickedDays(): { from: string | undefined; to: string | undefined } {
  return { from: dayKey(picker.props?.value?.from), to: dayKey(picker.props?.value?.to) };
}

function addButton(): HTMLElement {
  return within(screen.getByRole('dialog')).getByRole('button', { name: 'common.add' });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (e: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function chooseGuest(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: 'assignments.person' }));
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

beforeAll(() => {
  Element.prototype.scrollIntoView ??= (): void => undefined;
  Element.prototype.hasPointerCapture ??= (): boolean => false;
  Element.prototype.setPointerCapture ??= (): void => undefined;
  Element.prototype.releasePointerCapture ??= (): void => undefined;
});

beforeEach(() => {
  vi.clearAllMocks();
  currentTrip = TRIP;
  persons = [ALICE, BOB];
  rooms = [ATTIC];
  roomStays = [];
  picker.props = undefined;
  mockCheckConflict.mockResolvedValue(false);
  mockCreateAssignment.mockResolvedValue(undefined);
});

// ============================================================================
// Tests
// ============================================================================

describe('QuickAssignmentDialog — what it opens on', () => {
  it('names the dragged guest, the room and the window', async () => {
    roomStays = [stay('a1', BOB.id, tripDay(1), tripDay(3))];
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    expect(screen.getByRole('dialog', { name: 'assignments.quickAssign' })).toHaveTextContent(
      'assignments.quickAssignDescription',
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Attic')).toHaveClass('rounded-md', 'border');
    expect(screen.queryByRole('combobox', { name: 'assignments.person' })).not.toBeInTheDocument();
    expect(pickedDays()).toEqual({ from: tripDay(2), to: tripDay(5) });
    // The trip dates are indicative: the picker is not bounded by them.
    expect(picker.props).not.toHaveProperty('minDate');
    expect(picker.props).not.toHaveProperty('maxDate');
    expect(picker.props?.['aria-label']).toBe('assignments.period');
    expect(picker.props?.bookedRanges?.map((range) => [dayKey(range.from), dayKey(range.to)])).toEqual(
      [[tripDay(1), tripDay(3)]],
    );
    expect(screen.getByText('assignments.periodHint')).toBeInTheDocument();
    await settle();
  });

  it('has nothing to list as booked in an empty room', async () => {
    currentTrip = undefined;
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    expect(picker.props?.bookedRanges).toBeUndefined();
    await settle();
  });

  it('asks who, under its own title, when nobody was dragged', () => {
    renderPlain(<QuickAssignmentDialog {...DRAGGED} person={null} />);

    expect(screen.getByRole('dialog', { name: 'rooms.assignGuest' })).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'assignments.person' });
    expect(select).toHaveClass('w-full');
    expect(select).toHaveTextContent('assignments.selectPerson');
  });

  it('lists every guest with their colour, or says there is nobody', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPlain(<QuickAssignmentDialog {...DRAGGED} person={null} />);

    await user.click(screen.getByRole('combobox', { name: 'assignments.person' }));
    const bob = await screen.findByRole('option', { name: /Bob/ });
    expect(bob.querySelector('.rounded-full')).toHaveStyle({ backgroundColor: '#ef4444' });
    unmount();

    persons = [];
    renderPlain(<QuickAssignmentDialog {...DRAGGED} person={null} />);
    await user.click(screen.getByRole('combobox', { name: 'assignments.person' }));
    expect(await screen.findByText('persons.empty')).toHaveClass('text-center');
  });

  it('renders nothing for a room that is not there', () => {
    const { container } = renderPlain(<QuickAssignmentDialog {...DRAGGED} roomId={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('opens with no dates when only one end was suggested', () => {
    renderPlain(<QuickAssignmentDialog {...DRAGGED} suggestedEndDate={undefined} />);

    expect(pickedDays()).toEqual({ from: undefined, to: undefined });
    expect(addButton()).toBeDisabled();
  });

  it('starts again from the new suggestion when it is reopened', async () => {
    const { rerender } = renderPlain(<QuickAssignmentDialog {...DRAGGED} />);
    pickRange(tripDay(6), tripDay(8));

    rerender(<QuickAssignmentDialog {...DRAGGED} open={false} />);
    rerender(<QuickAssignmentDialog {...DRAGGED} />);

    expect(pickedDays()).toEqual({ from: tripDay(2), to: tripDay(5) });
    await settle();
  });

  it('follows a new suggestion that arrives while it is open', async () => {
    const { rerender } = renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    rerender(<QuickAssignmentDialog {...DRAGGED} person={BOB} suggestedStartDate={tripDay(3)} />);

    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(pickedDays()).toEqual({ from: tripDay(3), to: tripDay(5) });
    await settle();
  });
});

describe('QuickAssignmentDialog — the unsaved-change guard', () => {
  it.each([
    ['moved dates', tripDay(3), tripDay(5)],
    ['a moved check-out', tripDay(2), tripDay(6)],
    ['cleared dates', undefined, undefined],
  ])('asks before throwing away %s', async (_name, from, to) => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPlain(<QuickAssignmentDialog {...DRAGGED} onOpenChange={onOpenChange} />);

    pickRange(from, to);
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    const prompt = await screen.findByRole('alertdialog');
    expect(prompt).toHaveTextContent('unsaved.discardChanges');
    expect(prompt).toHaveTextContent('unsaved.discardDescription');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('asks before throwing away dates picked with none suggested', async () => {
    const user = userEvent.setup();
    renderPlain(
      <QuickAssignmentDialog
        {...DRAGGED}
        suggestedStartDate={undefined}
        suggestedEndDate={undefined}
      />,
    );

    pickRange(tripDay(3), undefined);
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('closes without asking when the dates were put back', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPlain(<QuickAssignmentDialog {...DRAGGED} onOpenChange={onOpenChange} />);

    pickRange(tripDay(3), tripDay(6));
    pickRange(tripDay(2), tripDay(5));
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks before throwing away a guest picked by hand', async () => {
    const user = userEvent.setup();
    renderPlain(<QuickAssignmentDialog {...DRAGGED} person={null} />);

    await chooseGuest(user, 'Bob');
    await user.keyboard('{Escape}');

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  });

  it('discards on Discard, and goes back to the form on Keep editing', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPlain(<QuickAssignmentDialog {...DRAGGED} onOpenChange={onOpenChange} />);

    pickRange(tripDay(3), tripDay(5));
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
    await user.click(await screen.findByRole('button', { name: 'unsaved.keepEditing' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(pickedDays()).toEqual({ from: tripDay(3), to: tripDay(5) });

    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
    await user.click(await screen.findByRole('button', { name: 'unsaved.discard' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  it('forgets an open question when it is opened afresh', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPlain(<QuickAssignmentDialog {...DRAGGED} />);
    pickRange(tripDay(3), tripDay(5));
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();

    rerender(<QuickAssignmentDialog {...DRAGGED} person={BOB} />);

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });
});

describe('QuickAssignmentDialog — the capacity warning', () => {
  it('warns when the guest would overfill the room', async () => {
    roomStays = [
      stay('a1', BOB.id, tripDay(1), tripDay(8)),
      stay('a2', 'p9' as PersonId, tripDay(1), tripDay(8)),
    ];
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    const warning = screen.getByText('rooms.capacityWarning').closest('[role="alert"]');
    expect(warning).toHaveClass('border-warning', 'p-3', 'bg-warning-surface');
    await settle();
  });

  it('does not warn when the room is exactly full', async () => {
    roomStays = [stay('a1', BOB.id, tripDay(1), tripDay(8))];
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
    await settle();
  });

  it('counts a couple on one row as two', async () => {
    roomStays = [stay('a1', BOB.id, tripDay(1), tripDay(8))];
    renderPlain(<QuickAssignmentDialog {...DRAGGED} person={{ ...ALICE, headcount: 2 }} />);

    expect(screen.getByText('rooms.capacityWarning')).toBeInTheDocument();
    await settle();
  });

  it('waits for both dates before saying anything', () => {
    roomStays = [
      stay('a1', BOB.id, tripDay(1), tripDay(8)),
      stay('a2', 'p9' as PersonId, tripDay(1), tripDay(8)),
    ];
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    pickRange(tripDay(2), undefined);
    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
    pickRange(undefined, tripDay(5));
    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
  });

  it('waits for a guest before saying anything', () => {
    rooms = [{ ...ATTIC, capacity: 0 }];
    renderPlain(<QuickAssignmentDialog {...DRAGGED} person={null} />);

    expect(screen.queryByText('rooms.capacityWarning')).not.toBeInTheDocument();
  });

  it('warns for a guest picked by hand', async () => {
    rooms = [{ ...ATTIC, capacity: 0 }];
    const user = userEvent.setup();
    renderPlain(<QuickAssignmentDialog {...DRAGGED} person={null} />);

    await chooseGuest(user, 'Bob');

    expect(screen.getByText('rooms.capacityWarning')).toBeInTheDocument();
  });
});

describe('QuickAssignmentDialog — the conflict check', () => {
  it('asks about the guest and the two days, and says it is checking meanwhile', async () => {
    const pending = deferred<boolean>();
    mockCheckConflict.mockReturnValue(pending.promise);
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    expect(mockCheckConflict).toHaveBeenCalledWith('p1', tripDay(2), tripDay(5));
    const checking = screen.getByText('assignments.checkingConflict');
    expect(checking.parentElement).toHaveClass('text-muted-foreground');
    expect(addButton()).toBeDisabled();

    await act(async () => {
      pending.resolve(false);
    });
    expect(screen.queryByText('assignments.checkingConflict')).not.toBeInTheDocument();
    expect(addButton()).toBeEnabled();
  });

  it('blocks the save on a conflict, and says so in red', async () => {
    mockCheckConflict.mockResolvedValue(true);
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    const conflict = await screen.findByText('assignments.conflict');
    expect(conflict.closest('[role="alert"]')).toHaveClass('border-destructive', 'text-destructive');
    expect(addButton()).toBeDisabled();
  });

  it.each([
    ['the whole range', undefined, undefined],
    ['the check-in day', undefined, tripDay(5)],
    ['the check-out day', tripDay(2), undefined],
  ])('drops the conflict when %s is cleared', async (_name, from, to) => {
    mockCheckConflict.mockResolvedValue(true);
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);
    await screen.findByText('assignments.conflict');

    mockCheckConflict.mockClear();
    pickRange(from, to);

    expect(screen.queryByText('assignments.conflict')).not.toBeInTheDocument();
    expect(mockCheckConflict).not.toHaveBeenCalled();
  });

  it('does not ask before a guest is chosen', () => {
    renderPlain(<QuickAssignmentDialog {...DRAGGED} person={null} />);

    expect(mockCheckConflict).not.toHaveBeenCalled();
    expect(addButton()).toBeDisabled();
  });

  it('ignores the answer to a question that is no longer asked', async () => {
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    mockCheckConflict.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    pickRange(tripDay(3), tripDay(5));
    await act(async () => {
      first.resolve(true);
    });
    expect(screen.queryByText('assignments.conflict')).not.toBeInTheDocument();
    expect(screen.getByText('assignments.checkingConflict')).toBeInTheDocument();

    await act(async () => {
      second.resolve(false);
    });
    expect(screen.queryByText('assignments.checkingConflict')).not.toBeInTheDocument();
  });

  it('ignores a stale failure that arrives after a conflict', async () => {
    const first = deferred<boolean>();
    mockCheckConflict.mockReturnValueOnce(first.promise).mockResolvedValueOnce(true);
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    pickRange(tripDay(3), tripDay(5));
    await screen.findByText('assignments.conflict');
    await act(async () => {
      first.reject(new Error('offline'));
    });

    expect(screen.getByText('assignments.conflict')).toBeInTheDocument();
  });

  it('clears an old conflict when the next check fails', async () => {
    mockCheckConflict.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('offline'));
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);
    await screen.findByText('assignments.conflict');

    pickRange(tripDay(3), tripDay(5));

    await waitFor(() => {
      expect(screen.queryByText('assignments.conflict')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('assignments.checkingConflict')).not.toBeInTheDocument();
  });

  // A check that was still out when the dates were cleared used to leave its
  // "checking" flag set: the cleanup cancelled it, the cancelled check never
  // reset the flag, and with no dates nothing started a new one.
  it('stops saying it is checking once the dates are cleared mid-check', () => {
    mockCheckConflict.mockReturnValue(new Promise<boolean>(() => undefined));
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);
    expect(screen.getByText('assignments.checkingConflict')).toBeInTheDocument();

    pickRange(tripDay(2), undefined);

    expect(screen.queryByText('assignments.checkingConflict')).not.toBeInTheDocument();
  });

  it('starts a reopened form without the old form’s conflict or pending check', async () => {
    mockCheckConflict.mockResolvedValueOnce(true);
    mockCheckConflict.mockReturnValue(new Promise<boolean>(() => undefined));
    const { rerender } = renderPlain(<QuickAssignmentDialog {...DRAGGED} />);
    await screen.findByText('assignments.conflict');

    // How the rooms page closes it: the dragged guest and the room are cleared.
    rerender(<QuickAssignmentDialog {...DRAGGED} open={false} person={null} roomId={null} />);
    rerender(
      <QuickAssignmentDialog
        {...DRAGGED}
        person={null}
        suggestedStartDate={undefined}
        suggestedEndDate={undefined}
      />,
    );

    expect(screen.queryByText('assignments.conflict')).not.toBeInTheDocument();
    expect(screen.queryByText('assignments.checkingConflict')).not.toBeInTheDocument();
  });
});

describe('QuickAssignmentDialog — saving', () => {
  it('writes the stay, says so and closes', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPlain(<QuickAssignmentDialog {...DRAGGED} onOpenChange={onOpenChange} />);

    await waitFor(() => {
      expect(addButton()).toBeEnabled();
    });
    await user.click(addButton());

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mockCreateAssignment).toHaveBeenCalledWith({
      roomId: 'room-1',
      personId: 'p1',
      startDate: tripDay(2),
      endDate: tripDay(5),
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('assignments.createSuccess');
  });

  it('locks the form, with a spinner, while the write is pending, then lets go of one that hangs', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const pending = deferred<void>();
      mockCreateAssignment.mockReturnValue(pending.promise);
      const onOpenChange = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderPlain(<QuickAssignmentDialog {...DRAGGED} onOpenChange={onOpenChange} />);

      await waitFor(() => {
        expect(addButton()).toBeEnabled();
      });
      expect(addButton().querySelector('[class*="animate-spin"]')).toBeNull();
      await user.click(addButton());

      await waitFor(() => {
        expect(addButton()).toBeDisabled();
      });
      expect(addButton().querySelector('[class*="animate-spin"]')).toHaveClass('mr-2');
      expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled();
      expect(picker.props?.disabled).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: 'common.dialogClose' }));
      await user.keyboard('{Escape}');
      expect(onOpenChange).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(STALL_TIMEOUT_MS + 10);
      });
      fireEvent.click(screen.getByRole('button', { name: 'common.dialogClose' }));
      expect(onOpenChange).toHaveBeenCalledWith(false);

      await act(async () => {
        pending.resolve();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // The dialog let go of a hung save through its close button, but Escape and
  // a click outside were still refused for good: those two prevented the close
  // whenever a save was in flight, stalled or not.
  it('lets Escape and a click outside close a dialog whose save hangs', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockCreateAssignment.mockReturnValue(new Promise<void>(() => undefined));
      const onOpenChange = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { unmount } = renderPlain(<QuickAssignmentDialog {...DRAGGED} onOpenChange={onOpenChange} />);

      await waitFor(() => {
        expect(addButton()).toBeEnabled();
      });
      await user.click(addButton());
      await waitFor(() => {
        expect(addButton()).toBeDisabled();
      });
      await act(async () => {
        vi.advanceTimersByTime(STALL_TIMEOUT_MS + 10);
      });

      await user.keyboard('{Escape}');
      expect(onOpenChange).toHaveBeenCalledWith(false);
      unmount();

      const onOpenChangeAgain = vi.fn();
      renderPlain(<QuickAssignmentDialog {...DRAGGED} onOpenChange={onOpenChangeAgain} />);
      await waitFor(() => {
        expect(addButton()).toBeEnabled();
      });
      await user.click(addButton());
      await act(async () => {
        vi.advanceTimersByTime(STALL_TIMEOUT_MS + 10);
      });
      fireEvent.pointerDown(document.body);
      await waitFor(() => {
        expect(onOpenChangeAgain).toHaveBeenCalledWith(false);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not close or report a dialog that was unmounted while saving', async () => {
    const pending = deferred<void>();
    mockCreateAssignment.mockReturnValue(pending.promise);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderPlain(<QuickAssignmentDialog {...DRAGGED} onOpenChange={onOpenChange} />);

    await waitFor(() => {
      expect(addButton()).toBeEnabled();
    });
    await user.click(addButton());
    unmount();
    await act(async () => {
      pending.resolve();
    });

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mockNotifySuccess).not.toHaveBeenCalled();
  });

  it('closes on Escape and on a click outside when nothing is saving', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPlain(<QuickAssignmentDialog {...DRAGGED} onOpenChange={onOpenChange} />);

    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    fireEvent.pointerDown(document.body);
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});

describe('QuickAssignmentDialog — following its inputs', () => {
  it('shows the room it was given, not the first one listed', async () => {
    rooms = [{ ...ATTIC, id: 'room-0' as RoomId, name: 'Barn' }, ATTIC];
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    expect(screen.getByText('Attic')).toBeInTheDocument();
    expect(screen.queryByText('Barn')).not.toBeInTheDocument();
    await settle();
  });

  it('follows the room, the trip and the room’s stays after the first render', async () => {
    const { rerender } = renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    rooms = [{ ...ATTIC, name: 'Loft' }];
    currentTrip = { ...TRIP, startDate: tripDay(-2), endDate: tripDay(12) };
    roomStays = [stay('a1', BOB.id, tripDay(6), tripDay(8))];
    // A new handler makes the memoised dialog render again, as a context change would.
    rerender(<QuickAssignmentDialog {...DRAGGED} onOpenChange={vi.fn()} />);

    expect(screen.getByText('Loft')).toBeInTheDocument();
    expect(picker.props?.bookedRanges?.map((range) => dayKey(range.from))).toEqual([tripDay(6)]);
    await settle();
  });

  it('starts again when only the suggested guest changes', async () => {
    const { rerender } = renderPlain(
      <QuickAssignmentDialog {...DRAGGED} person={null} suggestedPersonId={ALICE.id} />,
    );
    expect(screen.getByRole('combobox', { name: 'assignments.person' })).toHaveTextContent('Alice');

    rerender(<QuickAssignmentDialog {...DRAGGED} person={null} suggestedPersonId={BOB.id} />);

    expect(screen.getByRole('combobox', { name: 'assignments.person' })).toHaveTextContent('Bob');
    await settle();
  });

  it.each([
    ['check-in', { suggestedStartDate: tripDay(3) }, { from: tripDay(3), to: tripDay(5) }],
    ['check-out', { suggestedEndDate: tripDay(6) }, { from: tripDay(2), to: tripDay(6) }],
  ])('starts again when only the suggested %s changes', async (_name, change, expected) => {
    const { rerender } = renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    rerender(<QuickAssignmentDialog {...DRAGGED} {...change} />);

    expect(pickedDays()).toEqual(expected);
    await settle();
  });

  it('opens empty after a dialog that had dates', () => {
    const { rerender } = renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    rerender(<QuickAssignmentDialog {...DRAGGED} open={false} />);
    rerender(
      <QuickAssignmentDialog {...DRAGGED} suggestedStartDate={undefined} suggestedEndDate={undefined} />,
    );

    expect(pickedDays()).toEqual({ from: undefined, to: undefined });
  });

  it('starts again without the old suggestion’s conflict', async () => {
    mockCheckConflict.mockResolvedValueOnce(true);
    mockCheckConflict.mockReturnValue(new Promise<boolean>(() => undefined));
    const { rerender } = renderPlain(<QuickAssignmentDialog {...DRAGGED} />);
    await screen.findByText('assignments.conflict');

    rerender(<QuickAssignmentDialog {...DRAGGED} person={BOB} />);

    expect(screen.queryByText('assignments.conflict')).not.toBeInTheDocument();
  });

  it('closes a claim nobody filled in without asking', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderPlain(
      <QuickAssignmentDialog
        {...DRAGGED}
        person={null}
        onOpenChange={onOpenChange}
        suggestedStartDate={undefined}
        suggestedEndDate={undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it.each([
    ['a check-in alone', tripDay(2), undefined],
    ['a check-out alone', undefined, tripDay(5)],
  ])('cannot save with %s', (_name, from, to) => {
    renderPlain(<QuickAssignmentDialog {...DRAGGED} />);

    pickRange(from, to);

    expect(addButton()).toBeDisabled();
  });

  it('labels the guest, the room and the period', () => {
    const { unmount } = renderPlain(<QuickAssignmentDialog {...DRAGGED} />);
    expect(screen.getByText('assignments.person', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText('assignments.room', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText('assignments.period', { selector: 'label' })).toBeInTheDocument();
    unmount();

    renderPlain(<QuickAssignmentDialog {...DRAGGED} person={null} />);
    expect(screen.getByText('assignments.person', { selector: 'label' })).toHaveAttribute(
      'for',
      'claim-person-select',
    );
    expect(screen.getByRole('combobox', { name: 'assignments.person' })).toHaveAttribute(
      'aria-label',
      'assignments.person',
    );
  });

  it('closes through the latest close handler after a discard', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const user = userEvent.setup();
    const { rerender } = renderPlain(<QuickAssignmentDialog {...DRAGGED} onOpenChange={first} />);
    rerender(<QuickAssignmentDialog {...DRAGGED} onOpenChange={second} />);

    pickRange(tripDay(3), tripDay(5));
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));
    await user.click(await screen.findByRole('button', { name: 'unsaved.discard' }));

    expect(second).toHaveBeenCalledWith(false);
    expect(first).not.toHaveBeenCalled();
  });
});

describe('QuickAssignmentDialog — before and just after it opens', () => {
  // The discard question is the dialog's alertdialog, and it starts closed:
  // mounted shut with a room, nothing may be waiting for an answer.
  it('asks nothing while it is closed', () => {
    renderPlain(<QuickAssignmentDialog {...DRAGGED} open={false} />);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  // Opening resets the "checking" flag. With no guest and no dates nothing
  // starts a check, so a flag set on open would stay on for good.
  it('does not say it is checking when there is nothing to check', () => {
    renderPlain(
      <QuickAssignmentDialog
        {...DRAGGED}
        person={null}
        suggestedStartDate={undefined}
        suggestedEndDate={undefined}
      />,
    );

    expect(screen.queryByText('assignments.checkingConflict')).not.toBeInTheDocument();
  });
});
