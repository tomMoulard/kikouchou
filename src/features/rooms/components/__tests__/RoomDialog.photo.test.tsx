/**
 * @fileoverview Tests for the photo a room is saved with.
 *
 * The room is saved first and the photo after it, under the trip the dialog
 * was given. A photo that fails keeps the room and says so.
 *
 * @module features/rooms/components/__tests__/RoomDialog.photo.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/utils';

import { setRoomPhoto } from '@/lib/db/repositories/photo-repository';
import { notify } from '@/lib/notifications';
import type { PhotoId, Room, RoomId, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

const mockCreateRoom = vi.fn(async () => ({ id: 'new-room' }));
const mockUpdateRoom = vi.fn(async () => undefined);

const BEDROOM: Room = {
  id: 'r1' as RoomId,
  tripId: 't1' as TripId,
  name: 'Bedroom',
  capacity: 2,
  order: 0,
  photoId: 'roomPhoto0001' as PhotoId,
};

/** What the next submit hands over as the photo change. */
let nextPhoto: Blob | null | undefined;

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => ({
    rooms: [BEDROOM],
    createRoom: mockCreateRoom,
    updateRoom: mockUpdateRoom,
  }),
}));
vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: vi.fn() }),
}));
vi.mock('@/hooks/usePhotoUrl', () => ({ usePhotoUrl: vi.fn(() => 'blob:stored') }));
vi.mock('@/lib/db/repositories/photo-repository', () => ({ setRoomPhoto: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/features/rooms/components/RoomForm', () => ({
  RoomForm: ({
    onSubmit,
    photoUrl,
  }: {
    onSubmit: (data: unknown, photo?: Blob | null) => Promise<void>;
    photoUrl?: string;
  }) => (
    <div>
      <span data-testid="stored">{photoUrl}</span>
      <button
        type="button"
        onClick={() =>
          void (nextPhoto === undefined
            ? onSubmit({ name: 'Room', capacity: 2 })
            : onSubmit({ name: 'Room', capacity: 2 }, nextPhoto))
        }
      >
        submit
      </button>
    </div>
  ),
}));

import { RoomDialog } from '../RoomDialog';

const TRIP = { id: 't1' as TripId, remoteTripId: 'remote-1' };

beforeEach(() => {
  vi.clearAllMocks();
  nextPhoto = undefined;
  vi.mocked(setRoomPhoto).mockResolvedValue('newPhoto00001' as PhotoId);
});

// ============================================================================
// Tests
// ============================================================================

describe('RoomDialog, photo', () => {
  it('hands the form the stored photo of the room being edited', () => {
    render(<RoomDialog roomId={'r1' as RoomId} open onOpenChange={vi.fn()} trip={TRIP} />, {
      withProviders: false,
    });

    expect(screen.getByTestId('stored')).toHaveTextContent('blob:stored');
  });

  it('saves a new room photo under the created room', async () => {
    nextPhoto = new Blob(['x'], { type: 'image/webp' });
    render(<RoomDialog open onOpenChange={vi.fn()} trip={TRIP} />, { withProviders: false });

    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => {
      expect(setRoomPhoto).toHaveBeenCalledWith('t1', 'new-room', nextPhoto);
    });
  });

  it('removes the photo of an edited room on null', async () => {
    nextPhoto = null;
    render(<RoomDialog roomId={'r1' as RoomId} open onOpenChange={vi.fn()} trip={TRIP} />, {
      withProviders: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => {
      expect(setRoomPhoto).toHaveBeenCalledWith('t1', 'r1', null);
    });
    expect(mockUpdateRoom).toHaveBeenCalled();
  });

  it('touches no photo when the form did not change it', async () => {
    const onOpenChange = vi.fn();
    render(<RoomDialog roomId={'r1' as RoomId} open onOpenChange={onOpenChange} trip={TRIP} />, {
      withProviders: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(setRoomPhoto).not.toHaveBeenCalled();
  });

  it('keeps the room and says so when the photo fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(setRoomPhoto).mockRejectedValue(new Error('quota'));
    nextPhoto = new Blob(['x'], { type: 'image/webp' });
    const onOpenChange = vi.fn();
    render(<RoomDialog open onOpenChange={onOpenChange} trip={TRIP} />, { withProviders: false });

    fireEvent.click(screen.getByRole('button', { name: 'submit' }));

    await waitFor(() => {
      expect(notify.error).toHaveBeenCalledWith('photos.saveFailed');
    });
    expect(mockCreateRoom).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
