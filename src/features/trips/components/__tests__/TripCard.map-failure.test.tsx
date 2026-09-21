/**
 * @fileoverview What a trip card does when its map preview will not load.
 *
 * PostHog issue `01a0be39-9bb1-7792-ad03-63460ab2f2fe`: on 2026-09-20 a mobile
 * session on `/trips` lost the network for a moment, and the lazy Leaflet
 * chunk rejected with `Unable to preload CSS for
 * /assets/leaflet-CIGW-MKW.css`. The card wrapped that chunk in a `Suspense`
 * boundary and nothing else, so the rejection travelled up to the route
 * boundary and replaced the whole trip list with the error screen. A preview
 * that does not load must cost the preview, not the page.
 *
 * RED before the fix: the rejection escapes `TripCard`, the surrounding
 * boundary catches it, and the card is replaced by the error screen.
 *
 * @module features/trips/components/__tests__/TripCard.map-failure.test
 */
import { describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

import { TripCard } from '../TripCard';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { render } from '@/test/utils';
import { isoDate } from '@/test/utils';
import type { ShareId, Trip, TripId } from '@/types';

// The production failure, as the module graph sees it: the chunk the card
// imports never resolves. A factory that throws is how Vitest expresses a
// dynamic import that rejects.
vi.mock('../TripLocationMap', () => {
  throw new Error('Unable to preload CSS for /assets/leaflet-CIGW-MKW.css');
});

// ============================================================================
// Test Data Factories
// ============================================================================

/** A trip with coordinates, which is what makes the card render a map. */
function createTestTrip(): Trip {
  return {
    id: 'trip-1' as TripId,
    name: 'Beach Vacation',
    location: 'Brittany, France',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-22'),
    shareId: 'share-123' as ShareId,
    coordinates: { lat: 48.8566, lon: 2.3522 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Renders one card the way a route does: inside the boundary that stands
 * between the trip list and the error screen.
 *
 * @returns Nothing; assert against `screen`
 */
async function renderCardUnderRouteBoundary(): Promise<void> {
  render(
    <ErrorBoundary>
      <TripCard
        trip={createTestTrip()}
        persons={[]}
        onClick={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    </ErrorBoundary>
  );

  // Let the rejected `import()` reach React and the tree re-render on it.
  // Without this the assertions run on the frame that still shows the
  // `Suspense` fallback.
  await act(async () => {
    await Promise.resolve();
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('TripCard when the map chunk fails to load', () => {
  it('leaves the surrounding boundary alone', async () => {
    await renderCardUnderRouteBoundary();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the card on screen', async () => {
    await renderCardUnderRouteBoundary();

    expect(screen.getByText('Beach Vacation')).toBeInTheDocument();
    expect(screen.getByText('Brittany, France')).toBeInTheDocument();
  });

  it('drops the map preview rather than the card', async () => {
    await renderCardUnderRouteBoundary();

    // The preview button carries `aria-haspopup="dialog"`; the card menu
    // trigger carries `aria-haspopup="menu"`.
    const preview = screen
      .queryAllByRole('button')
      .find((button) => button.getAttribute('aria-haspopup') === 'dialog');

    expect(preview).toBeUndefined();
  });
});
