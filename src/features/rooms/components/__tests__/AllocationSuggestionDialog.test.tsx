/**
 * @fileoverview Tests for AllocationSuggestionDialog — the review step.
 * @module features/rooms/components/__tests__/AllocationSuggestionDialog.test
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { tripDay } from '@/features/rooms/__tests__/fixture-days';
import { AllocationSuggestionDialog } from '../AllocationSuggestionDialog';
import type { SuggestedStay } from '@/features/rooms/utils/allocation-planner';
import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  TripId,
} from '@/types';

// ============================================================================
// Mock Data
// ============================================================================

function makePerson(id: string, name: string, headcount?: number): Person {
  return {
    id: id as PersonId,
    tripId: 'trip-1' as TripId,
    name,
    color: '#3b82f6' as HexColor,
    ...(headcount === undefined ? {} : { headcount }),
  };
}

function makeRoom(id: string, name: string, capacity: number, order: number): Room {
  return {
    id: id as RoomId,
    tripId: 'trip-1' as TripId,
    name,
    capacity,
    order,
  };
}

function makeStay(
  personId: string,
  roomId: string | null,
  startDate: string,
  endDate: string,
  nights: readonly string[],
  partyKey = personId,
): SuggestedStay {
  return {
    personId: personId as PersonId,
    roomId: roomId as RoomId | null,
    startDate,
    endDate,
    nights,
    partyKey,
  };
}

function makeAssignment(
  id: string,
  personId: string,
  roomId: string,
  startDate: string,
  endDate: string,
): RoomAssignment {
  return {
    id: id as RoomAssignmentId,
    tripId: 'trip-1' as TripId,
    roomId: roomId as RoomId,
    personId: personId as PersonId,
    startDate: startDate as ISODateString,
    endDate: endDate as ISODateString,
  };
}

const alice = makePerson('alice', 'Alice');
const bob = makePerson('bob', 'Bob');
const rooms = [makeRoom('room-1', 'Master Bedroom', 2, 0), makeRoom('room-2', 'Attic', 1, 1)];

// ============================================================================
// Mocks
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// ============================================================================
// Tests
// ============================================================================

describe('AllocationSuggestionDialog', () => {
  beforeAll(() => {
    // Radix Select reaches for pointer-capture and scroll APIs jsdom omits.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderDialog(
    overrides: Partial<React.ComponentProps<typeof AllocationSuggestionDialog>> = {},
  ) {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <AllocationSuggestionDialog
        open={true}
        onOpenChange={onOpenChange}
        stays={[makeStay('alice', 'room-1', '2026-07-01', '2026-07-03', ['2026-07-01', '2026-07-02'])]}
        rooms={rooms}
        persons={[alice, bob]}
        assignments={[]}
        onApply={onApply}
        {...overrides}
      />,
    );
    return { onApply, onOpenChange };
  }

  it('lists a row per suggested stay with the room the planner chose', () => {
    renderDialog();

    expect(screen.getByText('rooms.suggest.title')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'rooms.suggest.roomFor' }),
    ).toHaveTextContent('Master Bedroom');
  });

  // The whole point of a review step: reading it must not write anything.
  it('writes nothing until the reader applies', async () => {
    const user = userEvent.setup();
    const { onApply, onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('applies the stays as suggested', async () => {
    const user = userEvent.setup();
    const { onApply, onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'rooms.suggest.apply' }));

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith([
        {
          personId: 'alice',
          roomId: 'room-1',
          startDate: '2026-07-01',
          endDate: '2026-07-03',
        },
      ]);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('applies the room the reader picked instead of the suggested one', async () => {
    const user = userEvent.setup();
    const { onApply } = renderDialog();

    await user.click(screen.getByRole('combobox', { name: 'rooms.suggest.roomFor' }));
    await user.click(await screen.findByRole('option', { name: /Attic/ }));
    await user.click(screen.getByRole('button', { name: 'rooms.suggest.apply' }));

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith([
        expect.objectContaining({ personId: 'alice', roomId: 'room-2' }),
      ]);
    });
  });

  it('leaves out a row the reader gave no room', async () => {
    const user = userEvent.setup();
    const { onApply } = renderDialog({
      stays: [
        makeStay('alice', 'room-1', '2026-07-01', '2026-07-02', ['2026-07-01']),
        makeStay('bob', 'room-2', '2026-07-01', '2026-07-02', ['2026-07-01']),
      ],
    });

    const [aliceRoom] = screen.getAllByRole('combobox', {
      name: 'rooms.suggest.roomFor',
    });
    await user.click(aliceRoom!);
    await user.click(await screen.findByRole('option', { name: 'rooms.suggest.noRoom' }));

    await user.click(screen.getByRole('button', { name: 'rooms.suggest.apply' }));

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith([
        expect.objectContaining({ personId: 'bob' }),
      ]);
    });
  });

  it('cannot apply when every row was given no room', async () => {
    renderDialog({
      stays: [makeStay('alice', null, '2026-07-01', '2026-07-02', ['2026-07-01'])],
    });

    expect(screen.getByRole('button', { name: 'rooms.suggest.apply' })).toBeDisabled();
    expect(screen.getByText('rooms.suggest.nothingFits')).toBeInTheDocument();
  });

  it('warns when a room the reader picked goes over capacity', async () => {
    const user = userEvent.setup();
    // The attic sleeps one and Bob already has it for that night.
    renderDialog({
      stays: [makeStay('alice', 'room-1', '2026-07-01', '2026-07-02', ['2026-07-01'])],
      assignments: [makeAssignment('a1', 'bob', 'room-2', '2026-07-01', '2026-07-02')],
    });

    expect(screen.queryByText('rooms.suggest.overCapacity')).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'rooms.suggest.roomFor' }));
    await user.click(await screen.findByRole('option', { name: /Attic/ }));

    expect(await screen.findByText('rooms.suggest.overCapacity')).toBeInTheDocument();
    // A warning, not a veto: over capacity is the reader's call to make.
    expect(screen.getByRole('button', { name: 'rooms.suggest.apply' })).toBeEnabled();
  });

  it('counts people rather than rows when warning about capacity', async () => {
    const user = userEvent.setup();
    // One row, two people: the double is full the moment they are put in it.
    const couple = makePerson('couple', 'Alice + Bob', 2);
    renderDialog({
      stays: [makeStay('couple', 'room-1', '2026-07-01', '2026-07-02', ['2026-07-01'])],
      persons: [couple],
      assignments: [makeAssignment('a1', 'bob', 'room-1', '2026-07-01', '2026-07-02')],
    });

    expect(await screen.findByText('rooms.suggest.overCapacity')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'rooms.suggest.roomFor' }));
    await user.click(await screen.findByRole('option', { name: 'rooms.suggest.noRoom' }));

    expect(screen.queryByText('rooms.suggest.overCapacity')).not.toBeInTheDocument();
  });

  it('names the guests it kept together', () => {
    renderDialog({
      stays: [
        makeStay('alice', 'room-1', '2026-07-01', '2026-07-02', ['2026-07-01'], 'party'),
        makeStay('bob', 'room-1', '2026-07-01', '2026-07-02', ['2026-07-01'], 'party'),
      ],
    });

    expect(screen.getByText('rooms.suggest.travelsTogether')).toBeInTheDocument();
  });

  it('says nothing about a party of one', () => {
    renderDialog();

    expect(screen.queryByText('rooms.suggest.travelsTogether')).not.toBeInTheDocument();
  });

  it('stays open when the write fails, so the rows can be tried again', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn().mockRejectedValue(new Error('offline'));
    const { onOpenChange } = renderDialog({ onApply });

    await user.click(screen.getByRole('button', { name: 'rooms.suggest.apply' }));

    await waitFor(() => {
      expect(onApply).toHaveBeenCalled();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'rooms.suggest.apply' })).toBeEnabled();
  });

  it('drops a stay whose guest has left the trip', () => {
    renderDialog({
      stays: [makeStay('ghost', 'room-1', '2026-07-01', '2026-07-02', ['2026-07-01'])],
    });

    expect(screen.getByText('rooms.suggest.nothingToPlace')).toBeInTheDocument();
  });
});

describe('AllocationSuggestionDialog — the capacity warning', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  function review(stays: readonly SuggestedStay[], assignments: readonly RoomAssignment[] = []) {
    render(
      <AllocationSuggestionDialog
        open
        onOpenChange={vi.fn()}
        stays={stays}
        rooms={rooms}
        persons={[alice, bob]}
        assignments={assignments}
        onApply={vi.fn().mockResolvedValue(undefined)}
      />,
    );
  }

  it('warns on every row that overfills a room nobody was in yet', () => {
    review([
      makeStay('alice', 'room-2', tripDay(1), tripDay(2), [tripDay(1)]),
      makeStay('bob', 'room-2', tripDay(1), tripDay(2), [tripDay(1)]),
    ]);

    const warnings = screen.getAllByRole('alert');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toHaveTextContent('rooms.suggest.overCapacity');
    expect(warnings[0]).toHaveClass('text-warning-on-surface', 'flex', 'text-xs');
  });

  it('warns when only one of the nights is over', () => {
    review(
      [makeStay('alice', 'room-2', tripDay(1), tripDay(3), [tripDay(1), tripDay(2)])],
      [makeAssignment('a1', 'bob', 'room-2', tripDay(2), tripDay(3))],
    );

    expect(screen.getByText('rooms.suggest.overCapacity')).toBeInTheDocument();
  });

  it('does not warn about a room that is exactly full', () => {
    review(
      [makeStay('alice', 'room-1', tripDay(1), tripDay(2), [tripDay(1)])],
      [makeAssignment('a1', 'bob', 'room-1', tripDay(1), tripDay(2))],
    );

    expect(screen.queryByText('rooms.suggest.overCapacity')).not.toBeInTheDocument();
  });

  it('copes with a suggested room that has since been removed', () => {
    review([makeStay('alice', 'gone', tripDay(1), tripDay(2), [tripDay(1)])]);

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('rooms.suggest.overCapacity')).not.toBeInTheDocument();
  });
});

describe('AllocationSuggestionDialog — the review itself', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('starts again from the proposal each time it opens', async () => {
    const user = userEvent.setup();
    const stays = [makeStay('alice', 'room-1', tripDay(1), tripDay(2), [tripDay(1)])];
    const props = {
      onOpenChange: vi.fn(),
      stays,
      rooms,
      persons: [alice, bob],
      assignments: [],
      onApply: vi.fn(),
    };
    const { rerender } = render(<AllocationSuggestionDialog open {...props} />);

    await user.click(screen.getByRole('combobox', { name: 'rooms.suggest.roomFor' }));
    await user.click(await screen.findByRole('option', { name: /Attic/ }));
    expect(screen.getByRole('combobox', { name: 'rooms.suggest.roomFor' })).toHaveTextContent('Attic');

    rerender(<AllocationSuggestionDialog open={false} {...props} />);
    rerender(<AllocationSuggestionDialog open {...props} />);

    expect(screen.getByRole('combobox', { name: 'rooms.suggest.roomFor' })).toHaveTextContent(
      'Master Bedroom',
    );
  });

  it('says nothing fits only while the guest still has no room', async () => {
    const user = userEvent.setup();
    render(
      <AllocationSuggestionDialog
        open
        onOpenChange={vi.fn()}
        stays={[
          makeStay('alice', null, tripDay(1), tripDay(2), [tripDay(1)]),
          makeStay('bob', 'room-1', tripDay(1), tripDay(2), [tripDay(1)]),
        ]}
        rooms={rooms}
        persons={[alice, bob]}
        assignments={[]}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getAllByText('rooms.suggest.nothingFits')).toHaveLength(1);

    const [aliceRoom, bobRoom] = screen.getAllByRole('combobox', { name: 'rooms.suggest.roomFor' });
    // Bob had a room on offer, so giving him none is the reader's choice, not a dead end.
    await user.click(bobRoom!);
    await user.click(await screen.findByRole('option', { name: 'rooms.suggest.noRoom' }));
    expect(screen.getAllByText('rooms.suggest.nothingFits')).toHaveLength(1);

    await user.click(aliceRoom!);
    await user.click(await screen.findByRole('option', { name: /Master Bedroom/ }));
    expect(screen.queryByText('rooms.suggest.nothingFits')).not.toBeInTheDocument();
  });

  it('locks itself while the stays are written, then lets go of a write that hangs', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let finish!: () => void;
      const onApply = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const onOpenChange = vi.fn();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(
        <AllocationSuggestionDialog
          open
          onOpenChange={onOpenChange}
          stays={[makeStay('alice', 'room-1', tripDay(1), tripDay(2), [tripDay(1)])]}
          rooms={rooms}
          persons={[alice, bob]}
          assignments={[]}
          onApply={onApply}
        />,
      );

      const apply = screen.getByRole('button', { name: 'rooms.suggest.apply' });
      expect(apply.querySelector('[class*="animate-spin"]')).toBeNull();
      await user.click(apply);

      expect(apply).toBeDisabled();
      expect(apply.querySelector('[class*="animate-spin"]')).toHaveClass('mr-2');
      expect(screen.getByRole('button', { name: 'common.cancel' })).toBeDisabled();
      expect(screen.getByRole('combobox', { name: 'rooms.suggest.roomFor' })).toBeDisabled();

      await user.keyboard('{Escape}');
      expect(onOpenChange).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(8100);
      });
      await user.keyboard('{Escape}');
      expect(onOpenChange).toHaveBeenCalledWith(false);

      await act(async () => {
        finish();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AllocationSuggestionDialog — following a proposal that changes while open', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  const common = {
    open: true,
    onOpenChange: vi.fn(),
    persons: [alice, bob],
    assignments: [],
    onApply: vi.fn(),
  };

  it('shows the new rows, and the new room for the same row', () => {
    const { rerender } = render(
      <AllocationSuggestionDialog
        {...common}
        rooms={rooms}
        stays={[makeStay('alice', 'room-1', tripDay(1), tripDay(2), [tripDay(1)])]}
      />,
    );

    rerender(
      <AllocationSuggestionDialog
        {...common}
        rooms={rooms}
        stays={[makeStay('alice', 'room-2', tripDay(1), tripDay(2), [tripDay(1)])]}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'rooms.suggest.roomFor' })).toHaveTextContent('Attic');

    rerender(
      <AllocationSuggestionDialog
        {...common}
        rooms={rooms}
        stays={[makeStay('bob', 'room-1', tripDay(3), tripDay(4), [tripDay(3)])]}
      />,
    );
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'rooms.suggest.roomFor' })).toHaveTextContent(
      'Master Bedroom',
    );
  });

  it('measures capacity against the rooms of now', () => {
    const stays = [makeStay('alice', 'room-2', tripDay(1), tripDay(2), [tripDay(1)])];
    const { rerender } = render(<AllocationSuggestionDialog {...common} rooms={rooms} stays={stays} />);
    expect(screen.queryByText('rooms.suggest.overCapacity')).not.toBeInTheDocument();

    rerender(
      <AllocationSuggestionDialog
        {...common}
        rooms={[rooms[0]!, { ...rooms[1]!, capacity: 0 }]}
        stays={stays}
      />,
    );

    expect(screen.getByText('rooms.suggest.overCapacity')).toBeInTheDocument();
  });

  it('counts the rows left without a room as the reader makes them', async () => {
    const user = userEvent.setup();
    render(
      <AllocationSuggestionDialog
        {...common}
        rooms={rooms}
        stays={[makeStay('alice', 'room-1', tripDay(1), tripDay(2), [tripDay(1)])]}
      />,
    );
    expect(screen.queryByText('rooms.suggest.leftOut')).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'rooms.suggest.roomFor' }));
    await user.click(await screen.findByRole('option', { name: 'rooms.suggest.noRoom' }));

    expect(screen.getByText('rooms.suggest.leftOut')).toBeInTheDocument();
  });

  it('describes itself and ties each picker to its row', () => {
    render(
      <AllocationSuggestionDialog
        {...common}
        rooms={rooms}
        stays={[makeStay('alice', 'room-1', tripDay(1), tripDay(2), [tripDay(1)])]}
      />,
    );

    expect(screen.getByRole('dialog')).toHaveTextContent('rooms.suggest.description');
    const picker = screen.getByRole('combobox', { name: 'rooms.suggest.roomFor' });
    expect(picker).toHaveAttribute('aria-label', 'rooms.suggest.roomFor');
    expect(picker.id).toBe(`suggested-room-alice|${tripDay(1)}|${tripDay(2)}`);
  });
});

describe('AllocationSuggestionDialog — proposals that only look alike', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  it('tells two proposals apart even when their rows run together', () => {
    // Bob's row key, glued onto a room id: written without a separator, this
    // one-row proposal reads exactly like the two-row one before it.
    const bobKey = `bob|${tripDay(3)}|${tripDay(4)}`;
    const oddRoom = makeRoom(`room-1${bobKey}>room-2`, 'Odd room', 2, 2);
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      rooms: [...rooms, oddRoom],
      persons: [alice, bob],
      assignments: [],
      onApply: vi.fn(),
    };
    const { rerender } = render(
      <AllocationSuggestionDialog
        {...props}
        stays={[
          makeStay('alice', 'room-1', tripDay(1), tripDay(2), [tripDay(1)]),
          makeStay('bob', 'room-2', tripDay(3), tripDay(4), [tripDay(3)]),
        ]}
      />,
    );

    rerender(
      <AllocationSuggestionDialog
        {...props}
        stays={[makeStay('alice', oddRoom.id, tripDay(1), tripDay(2), [tripDay(1)])]}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'rooms.suggest.roomFor' })).toHaveTextContent(
      'Odd room',
    );
  });

  it('does not put a guest left without a room into a room whose id is "none"', () => {
    // A room whose id is the picker's own "no room" value, already over its
    // beds. A guest given no room is not in it, so nothing is over capacity.
    const noneRoom = makeRoom('none', 'Shed', 0, 2);
    render(
      <AllocationSuggestionDialog
        open
        onOpenChange={vi.fn()}
        rooms={[...rooms, noneRoom]}
        persons={[alice, bob]}
        assignments={[makeAssignment('a1', 'bob', 'none', tripDay(1), tripDay(2))]}
        stays={[makeStay('alice', null, tripDay(1), tripDay(2), [tripDay(1)])]}
        onApply={vi.fn()}
      />,
    );

    expect(screen.queryByText('rooms.suggest.overCapacity')).not.toBeInTheDocument();
  });
});
