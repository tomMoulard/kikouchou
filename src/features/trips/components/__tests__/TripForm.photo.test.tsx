/**
 * @fileoverview Tests for the cover photo field of the trip form.
 *
 * Create mode only: the form reports the prepared photo out, counts it as an
 * unsaved change, and an existing trip leaves the photo to its own card.
 *
 * @module features/trips/components/__tests__/TripForm.photo.test
 */

import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@/test/utils';

import type { PhotoChange } from '@/components/shared/PhotoField';
import type { Trip } from '@/types';

import { TripForm } from '../TripForm';

// ============================================================================
// Test doubles
// ============================================================================

let fieldChange: ((change: PhotoChange) => void) | undefined;

vi.mock('@/components/shared/PhotoField', () => ({
  PhotoField: (props: { onChange: (change: PhotoChange) => void }) => {
    fieldChange = props.onChange;
    return <div data-testid="photo-field" />;
  },
}));

// ============================================================================
// Tests
// ============================================================================

describe('TripForm, cover photo', () => {
  it('reports the picked photo out and marks the form dirty', async () => {
    const onPhotoChange = vi.fn();
    const onDirtyChange = vi.fn();
    render(
      <TripForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onPhotoChange={onPhotoChange}
        onDirtyChange={onDirtyChange}
      />,
      { withProviders: false },
    );
    const blob = new Blob(['x'], { type: 'image/webp' });

    act(() => {
      fieldChange?.(blob);
    });

    await waitFor(() => {
      expect(onPhotoChange).toHaveBeenLastCalledWith(blob);
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    act(() => {
      fieldChange?.(null);
    });

    await waitFor(() => {
      expect(onPhotoChange).toHaveBeenLastCalledWith(null);
    });
  });

  it('has no photo field on an existing trip', () => {
    const trip = {
      id: 'trip-1',
      name: 'Chalet',
      startDate: '2026-07-01',
      endDate: '2026-07-05',
      shareId: 'share-1',
      createdAt: 1,
      updatedAt: 1,
    } as Trip;

    render(<TripForm trip={trip} onSubmit={vi.fn()} onCancel={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.queryByTestId('photo-field')).not.toBeInTheDocument();
  });
});
