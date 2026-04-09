import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import type { Room, RoomId } from '@/types';

const mockCreateRoom = vi.fn().mockResolvedValue(undefined);
const mockUpdateRoom = vi.fn().mockResolvedValue(undefined);
const mockSuccessToast = vi.fn();

const mockRooms: Room[] = [
  {
    id: 'r1' as RoomId,
    tripId: 't1' as Room['tripId'],
    name: 'Bedroom',
    capacity: 2,
    order: 0,
  },
];

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => ({
    rooms: mockRooms,
    createRoom: mockCreateRoom,
    updateRoom: mockUpdateRoom,
  }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: mockSuccessToast,
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
      expect(mockCreateRoom).toHaveBeenCalled();
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
});
