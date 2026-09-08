/**
 * Component tests for the create-mode room list in TripForm.
 *
 * A house is typed once, on the form that creates the trip: six identical
 * doubles are six rows here rather than six passes through the Rooms page
 * dialog. These tests cover the list itself; the page turns what it reports
 * into `Room` records.
 *
 * @module features/trips/components/__tests__/TripForm.rooms.test
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TripForm } from '@/features/trips/components/TripForm';
import type { Trip, TripId, ShareId } from '@/types';
import { isoDate } from '@/test/utils';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * An existing trip, for the edit-mode case.
 */
function createTestTrip(): Trip {
  return {
    id: 'trip-1' as TripId,
    name: 'Beach Vacation',
    location: 'Brittany, France',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-22'),
    shareId: 'share-123' as ShareId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  // Typing in the location field triggers a place lookup; keep it off the wire.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================================
// Helpers
// ============================================================================

/** The create-mode room list, addressed through its `<legend>`. */
function roomList(): HTMLElement {
  return screen.getByRole('group', { name: /trips\.rooms/iu });
}

/**
 * The room name inputs, in list order.
 *
 * The bed steppers sit in the same rows and are deliberately not here: a
 * `type="number"` field is a spinbutton, not a textbox.
 */
function roomInputs(): readonly HTMLInputElement[] {
  return within(roomList()).getAllByRole('textbox');
}

/** The bed steppers, in list order. */
function bedInputs(): readonly HTMLInputElement[] {
  return within(roomList()).getAllByRole('spinbutton');
}

/** Adds a room row and types a name into it. */
async function addRoom(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: /trips\.addRoom/iu }));
  await user.type(roomInputs().at(-1)!, name);
}

// ============================================================================
// Tests
// ============================================================================

describe('TripForm Room List', () => {
  it('starts empty, with only the button that adds a room', () => {
    // Nothing to prefill: no house comes with a room the form can guess, and a
    // blank row above the button would read as work already begun.
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(within(roomList()).queryAllByRole('textbox')).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: /trips\.addRoom/iu }),
    ).toBeInTheDocument();
  });

  it('is not offered in edit mode', () => {
    // An existing trip's rooms belong to the Rooms page, which also holds who
    // sleeps in them; a second editor here would have nothing to say about that.
    render(
      <TripForm trip={createTestTrip()} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.queryByRole('group', { name: /trips\.rooms/iu })).toBeNull();
  });

  it('adds a row and puts the cursor in it', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /trips\.addRoom/iu }));

    expect(roomInputs()).toHaveLength(1);
    expect(roomInputs()[0]).toHaveFocus();
  });

  it('reports the trimmed names and their beds, dropping rows left empty', async () => {
    const user = userEvent.setup();
    const onRoomsChange = vi.fn();

    render(
      <TripForm onSubmit={vi.fn()} onCancel={vi.fn()} onRoomsChange={onRoomsChange} />,
    );

    await addRoom(user, '  Double bed  ');
    // A second row added and left blank: an abandoned click, not a nameless room.
    await user.click(screen.getByRole('button', { name: /trips\.addRoom/iu }));

    await waitFor(() => {
      expect(onRoomsChange).toHaveBeenLastCalledWith([
        { name: 'Double bed', capacity: 1 },
      ]);
    });
  });

  it('steps the beds of one row without touching the others', async () => {
    const user = userEvent.setup();
    const onRoomsChange = vi.fn();

    render(
      <TripForm onSubmit={vi.fn()} onCancel={vi.fn()} onRoomsChange={onRoomsChange} />,
    );

    await addRoom(user, 'Double bed');
    await addRoom(user, 'Single bed');

    await user.click(
      within(roomList()).getAllByRole('button', {
        name: /trips\.roomBedsIncrease/iu,
      })[0]!,
    );

    expect(bedInputs().map((field) => field.value)).toEqual(['2', '1']);
    await waitFor(() => {
      expect(onRoomsChange).toHaveBeenLastCalledWith([
        { name: 'Double bed', capacity: 2 },
        { name: 'Single bed', capacity: 1 },
      ]);
    });
  });

  it('removes a row, keeping the rest in order', async () => {
    const user = userEvent.setup();
    render(<TripForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await addRoom(user, 'Attic');
    await addRoom(user, 'Cellar');

    await user.click(
      within(roomList()).getAllByRole('button', { name: /trips\.removeRoom/iu })[0]!,
    );

    expect(roomInputs().map((field) => field.value)).toEqual(['Cellar']);
  });

  it('arms the unsaved-changes guard only once a room is named', async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();

    render(
      <TripForm onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />,
    );

    await user.click(screen.getByRole('button', { name: /trips\.addRoom/iu }));
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);

    await user.type(roomInputs()[0]!, 'Attic');
    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenCalledWith(true);
    });
  });
});
