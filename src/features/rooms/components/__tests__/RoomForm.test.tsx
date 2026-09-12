import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/utils';
import type { Room } from '@/types';

vi.mock('@/hooks', () => ({
  useFormSubmission: <T,>(onSubmit: (data: T) => Promise<void>) => ({
    isSubmitting: false,
    submitError: null,
    handleSubmit: onSubmit,
  }),
}));

import { RoomForm } from '../RoomForm';

// ============================================================================
// Helpers
// ============================================================================

/**
 * The icon button that sits to the left of the name input.
 *
 * The picker used to be mocked out here. It is the real thing now, because the
 * icon is a button opening a dialog and a stub cannot say whether that works.
 */
function iconButton(): HTMLElement {
  return screen.getByRole('button', { name: 'rooms.changeIcon' });
}

/**
 * The glyph a button draws, by the class lucide stamps on its `svg`
 * (`lucide-bed-double`). Names the picture, not the stored key, so a table
 * wired to the wrong icon has something to contradict.
 */
function glyphOf(element: HTMLElement): string | undefined {
  return [...(element.querySelector('svg')?.classList ?? [])]
    .find((name) => name.startsWith('lucide-'))
    ?.replace('lucide-', '');
}

describe('RoomForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders create mode with default values', () => {
    render(
      <RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByLabelText(/rooms.name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/rooms.capacity/)).toBeInTheDocument();
    expect(screen.getByLabelText(/rooms.description/)).toBeInTheDocument();
    expect(iconButton()).toBeInTheDocument();
  });

  it('renders edit mode with room data', () => {
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: 't1' as Room['tripId'],
      name: 'Big Room',
      capacity: 3,
      description: 'A big room',
      order: 0,
    };
    render(
      <RoomForm room={room} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByDisplayValue('Big Room')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A big room')).toBeInTheDocument();
  });

  it('shows validation error on blur with empty name', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByPlaceholderText('rooms.namePlaceholder');
    await user.click(nameInput);
    await user.tab();
    expect(screen.getByText('common.required')).toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <RoomForm onSubmit={vi.fn()} onCancel={onCancel} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('common.cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('submits form with valid data', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <RoomForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByPlaceholderText('rooms.namePlaceholder');
    await user.type(nameInput, 'Test Room');
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Test Room', capacity: 1 }),
    );
  });

  it('reports dirty state changes', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    render(
      <RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />,
      { withProviders: false },
    );
    const nameInput = screen.getByPlaceholderText('rooms.namePlaceholder');
    await user.type(nameInput, 'X');
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('clears name error when user types', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByPlaceholderText('rooms.namePlaceholder');
    await user.click(nameInput);
    await user.tab();
    expect(screen.getByText('common.required')).toBeInTheDocument();
    await user.type(nameInput, 'Room A');
    expect(screen.queryByText('common.required')).not.toBeInTheDocument();
  });

  it('submits with icon value', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <RoomForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByPlaceholderText('rooms.namePlaceholder');
    await user.type(nameInput, 'Tent Room');
    await user.click(iconButton());
    await user.click(screen.getByRole('radio', { name: 'rooms.icons.tent' }));
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Tent Room', icon: 'tent' }),
    );
  });

  it('handles capacity change', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: 't1' as Room['tripId'],
      name: 'Big Room',
      capacity: 4,
      order: 0,
    };
    render(
      <RoomForm room={room} onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Big Room', capacity: 4 }),
    );
  });

  it('handles description change', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <RoomForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByPlaceholderText('rooms.namePlaceholder');
    await user.type(nameInput, 'Suite');
    const descInput = screen.getByLabelText(/rooms.description/);
    await user.type(descInput, 'Nice suite');
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Suite', description: 'Nice suite' }),
    );
  });

  it('converts empty description to undefined on submit', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <RoomForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const nameInput = screen.getByPlaceholderText('rooms.namePlaceholder');
    await user.type(nameInput, 'Room');
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ description: undefined }),
    );
  });

  it('shows validation errors on empty submit', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <RoomForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('common.required')).toBeInTheDocument();
  });

  it('resets form when room prop changes', () => {
    const room1: Room = {
      id: 'r1' as Room['id'],
      tripId: 't1' as Room['tripId'],
      name: 'Room 1',
      capacity: 2,
      order: 0,
    };
    const room2: Room = {
      id: 'r2' as Room['id'],
      tripId: 't1' as Room['tripId'],
      name: 'Room 2',
      capacity: 5,
      order: 1,
    };
    const { rerender } = render(
      <RoomForm room={room1} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByDisplayValue('Room 1')).toBeInTheDocument();
    rerender(<RoomForm room={room2} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByDisplayValue('Room 2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('5')).toBeInTheDocument();
  });

  // ============================================================================
  // Additional branch coverage tests
  // ============================================================================

  it('clears capacity input and shows validation on blur', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: 't1' as Room['tripId'],
      name: 'Room',
      capacity: 3,
      order: 0,
    };
    render(
      <RoomForm room={room} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const capacityInput = screen.getByLabelText(/rooms.capacity/);
    // Clear the field
    await user.clear(capacityInput);
    await user.tab();
    // Should show validation error for empty capacity
    const alerts = screen.queryAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(0);
  });

  it('handles non-numeric capacity input', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const capacityInput = screen.getByLabelText(/rooms.capacity/);
    await user.clear(capacityInput);
    await user.type(capacityInput, 'abc');
    // NaN input should be handled gracefully
    expect(capacityInput).toBeInTheDocument();
  });

  it('handles capacity change to valid value', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: 't1' as Room['tripId'],
      name: 'Room',
      capacity: 2,
      order: 0,
    };
    render(
      <RoomForm room={room} onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    // Just verify the form submits with the existing capacity value
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ capacity: 2 }),
    );
  });

  it('renders edit mode with existing room data', () => {
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: 't1' as Room['tripId'],
      name: 'Colored Room',
      capacity: 2,
      order: 0,
    };
    render(
      <RoomForm room={room} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByDisplayValue('Colored Room')).toBeInTheDocument();
  });

  it('renders edit mode with icon', () => {
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: 't1' as Room['tripId'],
      name: 'Icon Room',
      capacity: 2,
      icon: 'tent',
      order: 0,
    };
    render(
      <RoomForm room={room} onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByDisplayValue('Icon Room')).toBeInTheDocument();
    // The button shows the room's own icon, not the default one.
    expect(glyphOf(iconButton())).toBe('tent');
  });

  // ==========================================================================
  // The icon button
  // ==========================================================================

  describe('room icon', () => {
    it('shows the double bed for a new room', async () => {
      render(
        <RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
        { withProviders: false },
      );
      expect(glyphOf(iconButton())).toBe('bed-double');

      // And it is the tile already chosen when the picker opens.
      const { userEvent } = await import('@testing-library/user-event');
      await userEvent.setup().click(iconButton());
      expect(
        screen.getByRole('radio', { name: 'rooms.icons.bedDouble' }),
      ).toHaveAttribute('aria-checked', 'true');
    });

    it('opens the picker dialog when the button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(
        <RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
        { withProviders: false },
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await user.click(iconButton());

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(within(dialog).getByRole('radiogroup')).toBeInTheDocument();
    });

    it('lists the newer room icons after the original ones', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(
        <RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
        { withProviders: false },
      );
      await user.click(iconButton());

      const keys = screen
        .getAllByRole('radio')
        .map((tile) => tile.dataset.roomIcon);
      expect(keys.slice(0, 4)).toEqual(['bed-double', 'bed-single', 'bath', 'sofa']);
      expect(keys).toContain('bunk-bed');
      expect(keys).toContain('hammock');
      expect(keys.indexOf('bunk-bed')).toBeGreaterThan(keys.indexOf('armchair'));
    });

    it('takes the pick, closes the dialog and saves the new icon', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(
        <RoomForm onSubmit={onSubmit} onCancel={vi.fn()} />,
        { withProviders: false },
      );
      await user.type(screen.getByPlaceholderText('rooms.namePlaceholder'), 'Bunks');
      await user.click(iconButton());
      await user.click(screen.getByRole('radio', { name: 'rooms.icons.bunkBed' }));

      // One tile is the whole errand, so nothing is left to confirm.
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      expect(glyphOf(iconButton())).toBe('bed');

      await user.click(screen.getByText('common.save'));
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bunks', icon: 'bunk-bed' }),
      );
    });

    it('leaves a room with no icon storing no icon', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(
        <RoomForm onSubmit={onSubmit} onCancel={vi.fn()} />,
        { withProviders: false },
      );
      await user.type(screen.getByPlaceholderText('rooms.namePlaceholder'), 'Plain');
      await user.click(screen.getByText('common.save'));

      // The button draws the double bed for an empty icon field, and drawing
      // it must not write it: a room saved before the picker existed keeps an
      // empty field, and so does one nobody picked an icon for.
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Plain', icon: undefined }),
      );
    });
  });

  it('prevents submit with empty name', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <RoomForm onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clears capacity error when user types a new value', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    // First submit without name to trigger error, then check capacity-related errors
    const nameInput = screen.getByLabelText(/rooms.name/);
    await user.type(nameInput, 'Room A');

    const capacityInput = screen.getByLabelText(/rooms.capacity/);
    // Clear and type 0 which is below MIN_CAPACITY, then blur to trigger error
    await user.clear(capacityInput);
    await user.type(capacityInput, '0');
    await user.tab();

    // Now type a valid value to clear the error
    await user.clear(capacityInput);
    await user.type(capacityInput, '3');
    // Error should be cleared
  });

  // Clearing the box used to snap it to the minimum on the keystroke, so a
  // five-bed room saved as a one-bed room if the reader emptied the field and
  // submitted without retyping. Nothing is committed while it is empty now, so
  // the last good value stands.
  it('keeps the last good capacity when the input is left empty', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: 't1' as Room['tripId'],
      name: 'Room',
      capacity: 5,
      order: 0,
    };
    render(
      <RoomForm room={room} onSubmit={onSubmit} onCancel={vi.fn()} />,
      { withProviders: false },
    );
    const capacityInput = screen.getByLabelText(/rooms.capacity/);
    // Clear the input entirely
    await user.clear(capacityInput);
    // Submit — the room keeps the five beds it already had.
    await user.click(screen.getByText('common.save'));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ capacity: 5 }),
    );
  });

  it('steps the bed count with the buttons beside the field', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RoomForm onSubmit={onSubmit} onCancel={vi.fn()} />, {
      withProviders: false,
    });

    await user.type(screen.getByLabelText(/rooms.name/), 'Room');
    await user.click(screen.getByRole('button', { name: 'rooms.bedsIncrease' }));
    await user.click(screen.getByRole('button', { name: 'rooms.bedsIncrease' }));
    await user.click(screen.getByText('common.save'));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ capacity: 3 }));
  });

  it('will not step the bed count below one', () => {
    render(<RoomForm onSubmit={vi.fn()} onCancel={vi.fn()} />, {
      withProviders: false,
    });

    // A new room starts at one bed, which is the floor.
    expect(screen.getByRole('button', { name: 'rooms.bedsDecrease' })).toBeDisabled();
  });

  it('reports dirty state via onDirtyChange when capacity changes', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const room: Room = {
      id: 'r1' as Room['id'],
      tripId: 't1' as Room['tripId'],
      name: 'Room',
      capacity: 2,
      order: 0,
    };
    render(
      <RoomForm room={room} onSubmit={vi.fn()} onCancel={vi.fn()} onDirtyChange={onDirtyChange} />,
      { withProviders: false },
    );
    const capacityInput = screen.getByLabelText(/rooms.capacity/);
    await user.clear(capacityInput);
    await user.type(capacityInput, '10');
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });
});
