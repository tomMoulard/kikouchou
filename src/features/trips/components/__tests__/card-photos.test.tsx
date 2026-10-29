/**
 * @fileoverview Tests for the photo on a trip card and on a room card.
 *
 * Each card shows its photo across the top and asks for it by the trip it
 * belongs to; with no photo, the card is what it was before photos existed.
 *
 * @module features/trips/components/__tests__/card-photos.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';

import { RoomCard } from '@/features/rooms/components/RoomCard';
import { usePhotoUrl } from '@/hooks/usePhotoUrl';
import type { PhotoId, Room, RoomId, ShareId, Trip, TripId } from '@/types';

import { TripCard } from '../TripCard';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/hooks/usePhotoUrl', () => ({ usePhotoUrl: vi.fn() }));

const TRIP: Trip = {
  id: 'trip-1' as TripId,
  name: 'Chalet',
  startDate: '2026-07-01' as Trip['startDate'],
  endDate: '2026-07-05' as Trip['endDate'],
  shareId: 'share-1' as ShareId,
  photoId: 'coverPhoto0001' as PhotoId,
  remoteTripId: 'remote-1',
  createdAt: 1 as Trip['createdAt'],
  updatedAt: 1 as Trip['updatedAt'],
};

const ROOM: Room = {
  id: 'r1' as RoomId,
  tripId: TRIP.id,
  name: 'Red room',
  capacity: 2,
  order: 0,
  photoId: 'roomPhoto0001' as PhotoId,
};

function renderRoom(trip?: Trip) {
  return render(
    <RoomCard
      room={ROOM}
      occupants={[]}
      peakOccupancy={0}
      availableSpots={2}
      isFull={false}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      trip={trip}
    />,
    { withProviders: false },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('TripCard photo', () => {
  it('shows the cover photo, asked for by the trip', () => {
    vi.mocked(usePhotoUrl).mockReturnValue('blob:cover');

    render(<TripCard trip={TRIP} persons={[]} onClick={vi.fn()} onArchiveToggle={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByRole('img', { name: 'photos.tripAlt' })).toHaveAttribute('src', 'blob:cover');
    expect(usePhotoUrl).toHaveBeenCalledWith(TRIP, 'coverPhoto0001');
  });

  it('shows no image without a photo', () => {
    vi.mocked(usePhotoUrl).mockReturnValue(undefined);

    render(<TripCard trip={TRIP} persons={[]} onClick={vi.fn()} />, { withProviders: false });

    expect(screen.queryByRole('img', { name: 'photos.tripAlt' })).not.toBeInTheDocument();
  });
});

describe('RoomCard photo', () => {
  it('shows the room photo, asked for by the trip it was given', () => {
    vi.mocked(usePhotoUrl).mockReturnValue('blob:room');

    renderRoom(TRIP);

    expect(screen.getByRole('img', { name: 'photos.roomAlt' })).toHaveAttribute('src', 'blob:room');
    expect(usePhotoUrl).toHaveBeenCalledWith(TRIP, 'roomPhoto0001');
  });

  it('shows no image without a photo', () => {
    vi.mocked(usePhotoUrl).mockReturnValue(undefined);

    renderRoom(undefined);

    expect(screen.queryByRole('img', { name: 'photos.roomAlt' })).not.toBeInTheDocument();
  });
});
