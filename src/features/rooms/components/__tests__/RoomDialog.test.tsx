import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import type { Room, RoomId } from '@/types';

const mockCreateRoom = vi
  .fn()
  .mockImplementation((data: { name: string }) =>
    Promise.resolve({ ...data, id: 'new-room' }),
  );
const mockUpdateRoom = vi.fn().mockResolvedValue(undefined);
const mockSuccessToast = vi.fn();

const BEDROOM: Room = {
  id: 'r1' as RoomId,
  tripId: 't1' as Room['tripId'],
  name: 'Bedroom',
  capacity: 2,
  order: 0,
};

/** The rooms the context holds; a test may swap them between renders. */
let mockRooms: Room[] = [BEDROOM];
const { mockCaptureUsage } = vi.hoisted(() => ({ mockCaptureUsage: vi.fn() }));

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => ({
    rooms: mockRooms,
    createRoom: mockCreateRoom,
    updateRoom: mockUpdateRoom,
  }),
}));

vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  captureUsage: mockCaptureUsage,
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({
    notifySuccess: mockSuccessToast,
    errorToast: vi.fn(),
  }),
}));

vi.mock('@/features/rooms/components/RoomForm', () => ({
  RoomForm: ({ room, onCancel, onSubmit, onDirtyChange }: {
    room?: Room;
    onCancel: () => void;
    onSubmit: (data: unknown) => Promise<void>;
    onDirtyChange?: (dirty: boolean) => void;
  }) => (
    <div data-testid="room-form">
      {room ? <span data-testid="edit-mode">{room.name}</span> : <span data-testid="create-mode">New</span>}
      <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
      <button data-testid="submit-btn" onClick={() => onSubmit({ name: 'Test', capacity: 2 })}>Submit</button>
      <button data-testid="dirty-btn" onClick={() => onDirtyChange?.(true)}>Mark Dirty</button>
    </div>
  ),
}));

import { RoomDialog } from '../RoomDialog';

describe('RoomDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRooms = [BEDROOM];
  });

  it('renders create mode when roomId is undefined', () => {
    render(
      <RoomDialog open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('rooms.new')).toBeInTheDocument();
    expect(screen.getByTestId('create-mode')).toBeInTheDocument();
  });

  it('renders edit mode when roomId is provided', () => {
    render(
      <RoomDialog roomId={'r1' as RoomId} open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('rooms.edit')).toBeInTheDocument();
    expect(screen.getByTestId('edit-mode')).toBeInTheDocument();
  });

  it('shows error state when room is not found in edit mode', () => {
    render(
      <RoomDialog roomId={'nonexistent' as RoomId} open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('rooms.edit')).toBeInTheDocument();
    expect(screen.getByText('errors.roomNotFound')).toBeInTheDocument();
  });

  it('calls onOpenChange when cancel is clicked (not dirty)', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <RoomDialog open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    await user.click(screen.getByTestId('cancel-btn'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not render when not open', () => {
    render(
      <RoomDialog open={false} onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.queryByText('rooms.new')).not.toBeInTheDocument();
    // Nor does it ask a question about changes nobody made.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  // ===========================================================================
  // New tests for improved coverage
  // ===========================================================================

  it('calls createRoom and closes dialog on submit in create mode', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <RoomDialog open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    await user.click(screen.getByTestId('submit-btn'));
    await waitFor(() => {
      expect(mockCreateRoom).toHaveBeenCalledWith({ name: 'Test', capacity: 2 });
    });
    expect(mockSuccessToast).toHaveBeenCalledWith('rooms.createSuccess');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls updateRoom and closes dialog on submit in edit mode', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <RoomDialog roomId={'r1' as RoomId} open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    await user.click(screen.getByTestId('submit-btn'));
    await waitFor(() => {
      expect(mockUpdateRoom).toHaveBeenCalledWith('r1', expect.anything());
    });
    expect(mockSuccessToast).toHaveBeenCalledWith('rooms.updateSuccess');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows discard confirm when cancel is clicked on dirty form', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <RoomDialog open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    // Mark form as dirty
    await user.click(screen.getByTestId('dirty-btn'));
    // Cancel — should show discard confirmation
    await user.click(screen.getByTestId('cancel-btn'));
    expect(screen.getByText('unsaved.discardChanges')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('confirms discard and closes dialog', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <RoomDialog open onOpenChange={onOpenChange} />,
      { withProviders: false },
    );
    // Mark dirty
    await user.click(screen.getByTestId('dirty-btn'));
    // Cancel — opens discard dialog
    await user.click(screen.getByTestId('cancel-btn'));
    // Click discard button
    await user.click(screen.getByRole('button', { name: 'unsaved.discard' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders accessibility description in create mode', () => {
    render(
      <RoomDialog open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('rooms.newDescription')).toBeInTheDocument();
  });

  it('renders accessibility description in edit mode', () => {
    render(
      <RoomDialog roomId={'r1' as RoomId} open onOpenChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('rooms.editDescription')).toBeInTheDocument();
  });

  describe('what it reports', () => {
    it('counts a new room as a saved room', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<RoomDialog open onOpenChange={vi.fn()} />, { withProviders: false });

      await user.click(screen.getByTestId('submit-btn'));

      await waitFor(() => {
        expect(mockCaptureUsage).toHaveBeenCalledWith('room_saved', {
          operation: 'created',
          capacity: 2,
          count: 1,
        });
      });
    });

    it('counts an edited room as an update', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<RoomDialog roomId={'r1' as RoomId} open onOpenChange={vi.fn()} />, {
        withProviders: false,
      });

      await user.click(screen.getByTestId('submit-btn'));

      await waitFor(() => {
        expect(mockCaptureUsage).toHaveBeenCalledWith('room_saved', {
          operation: 'updated',
          capacity: 2,
        });
      });
    });

    it('edits the room it is given now, not the one it opened on', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const { rerender } = render(<RoomDialog open onOpenChange={onOpenChange} />, {
        withProviders: false,
      });

      rerender(<RoomDialog roomId={'r1' as RoomId} open onOpenChange={onOpenChange} />);
      await user.click(screen.getByTestId('submit-btn'));

      await waitFor(() => {
        expect(mockUpdateRoom).toHaveBeenCalledWith('r1', { name: 'Test', capacity: 2 });
      });
      expect(mockCreateRoom).not.toHaveBeenCalled();
    });
  });

  describe('a room that arrives late', () => {
    it('shows the form once the room it was asked for loads', () => {
      mockRooms = [];
      const onOpenChange = vi.fn();
      const { rerender } = render(
        <RoomDialog roomId={'r1' as RoomId} open onOpenChange={onOpenChange} />,
        { withProviders: false },
      );
      expect(screen.getByText('errors.roomNotFound')).toBeInTheDocument();

      mockRooms = [BEDROOM];
      rerender(<RoomDialog roomId={'r1' as RoomId} open onOpenChange={vi.fn()} />);

      expect(screen.getByTestId('edit-mode')).toHaveTextContent('Bedroom');
    });
  });

  describe('the unsaved-changes guard', () => {
    async function makeDirtyAndCancel(): Promise<void> {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      await user.click(screen.getByTestId('dirty-btn'));
      await user.click(screen.getByTestId('cancel-btn'));
    }

    it('names every part of the question', async () => {
      render(<RoomDialog open onOpenChange={vi.fn()} />, { withProviders: false });

      await makeDirtyAndCancel();

      const prompt = screen.getByRole('alertdialog');
      expect(prompt).toHaveTextContent('unsaved.discardDescription');
      expect(screen.getByRole('button', { name: 'unsaved.keepEditing' })).toBeInTheDocument();
    });

    it('closes the question and forgets the changes on Discard', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      render(<RoomDialog open onOpenChange={onOpenChange} />, { withProviders: false });

      await makeDirtyAndCancel();
      await user.click(screen.getByRole('button', { name: 'unsaved.discard' }));
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });

      // Nothing is unsaved any more, so a second cancel closes without asking.
      onOpenChange.mockClear();
      await user.click(screen.getByTestId('cancel-btn'));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('closes the question and keeps the form on Keep editing', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      render(<RoomDialog open onOpenChange={onOpenChange} />, { withProviders: false });

      await makeDirtyAndCancel();
      await user.click(screen.getByRole('button', { name: 'unsaved.keepEditing' }));

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByTestId('room-form')).toBeInTheDocument();
    });

    it('asks on Escape too while the form is dirty', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      render(<RoomDialog open onOpenChange={onOpenChange} />, { withProviders: false });

      await user.click(screen.getByTestId('dirty-btn'));
      await user.keyboard('{Escape}');

      expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('closes on Escape without asking while the form is clean', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      render(<RoomDialog open onOpenChange={onOpenChange} />, { withProviders: false });

      await user.keyboard('{Escape}');

      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('starts a reopened dialog clean and unasked', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      const { rerender } = render(<RoomDialog open onOpenChange={onOpenChange} />, {
        withProviders: false,
      });
      await makeDirtyAndCancel();
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();

      rerender(<RoomDialog open={false} onOpenChange={onOpenChange} />);
      // Closed from outside, the question is still waiting for an answer.
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      rerender(<RoomDialog open onOpenChange={onOpenChange} />);

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
      await user.click(screen.getByTestId('cancel-btn'));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('closes through the latest close handler', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = render(<RoomDialog open onOpenChange={first} />, {
        withProviders: false,
      });
      rerender(<RoomDialog open onOpenChange={second} />);

      await makeDirtyAndCancel();
      await user.click(screen.getByRole('button', { name: 'unsaved.discard' }));

      expect(second).toHaveBeenCalledWith(false);
      expect(first).not.toHaveBeenCalled();
    });
  });
});
