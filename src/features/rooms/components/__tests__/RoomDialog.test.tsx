import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';
import type { Room, RoomId } from '@/types';

const mockRooms: Room[] = [
  {
    id: 'r1' as RoomId,
    tripId: 't1' as Room['tripId'],
    name: 'Bedroom',
    capacity: 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => ({
    rooms: mockRooms,
    createRoom: vi.fn().mockResolvedValue(undefined),
    updateRoom: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: vi.fn(),
    errorToast: vi.fn(),
  }),
}));

vi.mock('@/features/rooms/components/RoomForm', () => ({
  RoomForm: ({ room, onCancel }: { room?: Room; onCancel: () => void }) => (
    <div data-testid="room-form">
      {room ? <span data-testid="edit-mode">{room.name}</span> : <span data-testid="create-mode">New</span>}
      <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
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
});
