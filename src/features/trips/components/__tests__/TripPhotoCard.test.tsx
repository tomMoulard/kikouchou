/**
 * @fileoverview Tests for TripPhotoCard.
 *
 * A photo is saved the moment it is picked, a failure says so and keeps the
 * page, and a viewer sees the photo with no control and no empty card.
 *
 * @module features/trips/components/__tests__/TripPhotoCard.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';

import type { PhotoChange } from '@/components/shared/PhotoField';
import { usePhotoUrl } from '@/hooks/usePhotoUrl';
import { setTripPhoto } from '@/lib/db/repositories/photo-repository';
import { notify } from '@/lib/notifications';
import type { Trip } from '@/types';

import { TripPhotoCard } from '../TripPhotoCard';

// ============================================================================
// Test doubles
// ============================================================================

/** The field's `onChange`, captured so a test can play the user's pick. */
let fieldChange: ((change: PhotoChange) => void) | undefined;

vi.mock('@/components/shared/PhotoField', () => ({
  PhotoField: (props: { onChange: (change: PhotoChange) => void; storedUrl?: string }) => {
    fieldChange = props.onChange;
    return <div data-testid="photo-field" data-stored={props.storedUrl ?? ''} />;
  },
}));
vi.mock('@/hooks/usePhotoUrl', () => ({ usePhotoUrl: vi.fn() }));
vi.mock('@/lib/db/repositories/photo-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db/repositories/photo-repository')>()),
  setTripPhoto: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

const TRIP = {
  id: 'trip-1',
  name: 'Chalet',
  startDate: '2026-07-01',
  endDate: '2026-07-05',
  shareId: 'share-1',
  createdAt: 1,
  updatedAt: 1,
} as Trip;

beforeEach(() => {
  vi.clearAllMocks();
  fieldChange = undefined;
  vi.mocked(usePhotoUrl).mockReturnValue(undefined);
  vi.mocked(setTripPhoto).mockResolvedValue(undefined);
});

// ============================================================================
// Tests
// ============================================================================

describe('TripPhotoCard', () => {
  it('offers the field to somebody who can edit, with the stored photo', () => {
    vi.mocked(usePhotoUrl).mockReturnValue('blob:cover');

    render(<TripPhotoCard trip={TRIP} canEdit />);

    expect(screen.getByTestId('photo-field')).toHaveAttribute('data-stored', 'blob:cover');
  });

  it('saves a picked photo at once', async () => {
    render(<TripPhotoCard trip={TRIP} canEdit />);
    const blob = new Blob(['x'], { type: 'image/webp' });

    fieldChange?.(blob);

    await waitFor(() => {
      expect(setTripPhoto).toHaveBeenCalledWith('trip-1', blob);
    });
    await waitFor(() => {
      expect(notify.success).toHaveBeenCalled();
    });
  });

  it('removes the photo on null', async () => {
    render(<TripPhotoCard trip={TRIP} canEdit />);

    fieldChange?.(null);

    await waitFor(() => {
      expect(setTripPhoto).toHaveBeenCalledWith('trip-1', null);
    });
  });

  it('ignores a change that changes nothing', async () => {
    render(<TripPhotoCard trip={TRIP} canEdit />);

    fieldChange?.(undefined);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(setTripPhoto).not.toHaveBeenCalled();
  });

  it('says so when the save fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(setTripPhoto).mockRejectedValue(new Error('quota'));
    render(<TripPhotoCard trip={TRIP} canEdit />);

    fieldChange?.(new Blob(['x']));

    await waitFor(() => {
      expect(notify.error).toHaveBeenCalledWith('photos.saveFailed');
    });
  });

  it('shows a viewer the photo and no control', () => {
    vi.mocked(usePhotoUrl).mockReturnValue('blob:cover');

    render(<TripPhotoCard trip={TRIP} canEdit={false} />);

    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:cover');
    expect(screen.queryByTestId('photo-field')).not.toBeInTheDocument();
  });

  it('shows a viewer no card when there is no photo', () => {
    const { container } = render(<TripPhotoCard trip={TRIP} canEdit={false} />);

    expect(container).toBeEmptyDOMElement();
  });
});
