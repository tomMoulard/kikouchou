/**
 * @fileoverview Tests for AllocationSuggestionDialog — the review step.
 * @module features/rooms/components/__tests__/AllocationSuggestionDialog.test
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
