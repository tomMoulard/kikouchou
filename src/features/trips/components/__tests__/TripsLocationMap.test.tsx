/**
 * Component tests for TripsLocationMap.
 *
 * MapView is stubbed so the assertions are about *which* trips reach the map,
 * not about Leaflet rendering (covered by MapView's own tests).
 *
 * @module features/trips/components/__tests__/TripsLocationMap.test
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { TripsLocationMap } from '@/features/trips/components/TripsLocationMap';
import type { MapMarkerData } from '@/components/shared/MapView';
import type { ISODateString, ShareId, Trip, TripId } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/components/shared/MapView', () => ({
  MapView: ({
    markers = [],
    center,
    zoom,
  }: {
    markers?: readonly MapMarkerData[];
    center: readonly [number, number];
    zoom?: number;
  }) => (
    <div
      data-testid="mock-map-view"
      data-center={JSON.stringify(center)}
      data-zoom={zoom}
    >
      {markers.map((marker) => (
        <div
          key={marker.id}
          data-testid={`mock-marker-${marker.id}`}
          data-label={marker.label}
          data-position={JSON.stringify(marker.position)}
        >
          {/* Leaflet renders these on hover / click; render them inline so the
              tests can assert on what they say. */}
          <div data-testid={`mock-tooltip-${marker.id}`}>{marker.tooltipContent}</div>
          <div data-testid={`mock-popup-${marker.id}`}>{marker.popupContent}</div>
        </div>
      ))}
    </div>
  ),
}));

// ============================================================================
// Test Data
// ============================================================================

/**
 * Builds a trip, pinned unless `coordinates` is overridden to undefined.
 */
function createTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1' as TripId,
    name: 'Summer Vacation',
    location: 'Brest, Bretagne',
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-22' as ISODateString,
    shareId: 'share-1' as ShareId,
    coordinates: { lat: 48.3904, lon: -4.4861 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/**
 * Renders the map inside a router, which the popup links need.
 */
function renderMap(trips: readonly Trip[]) {
  return render(
    <MemoryRouter>
      <TripsLocationMap trips={trips} />
    </MemoryRouter>,
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('TripsLocationMap', () => {
  it('renders one marker per pinned trip', () => {
    renderMap([
      createTrip(),
      createTrip({
        id: 'trip-2' as TripId,
        name: 'Winter Retreat',
        coordinates: { lat: 45.9237, lon: 6.8694 },
      }),
    ]);

    expect(screen.getByTestId('mock-marker-trip-1')).toHaveAttribute(
      'data-label',
      'Summer Vacation',
    );
    expect(screen.getByTestId('mock-marker-trip-2')).toHaveAttribute(
      'data-label',
      'Winter Retreat',
    );
  });

  it('names the trip, its location and its dates in the hover tooltip', () => {
    renderMap([createTrip()]);

    const tooltip = screen.getByTestId('mock-tooltip-trip-1');
    expect(tooltip).toHaveTextContent('Summer Vacation');
    expect(tooltip).toHaveTextContent('Brest, Bretagne');
    // Same-month range collapses to "15 - 22 Jul 2026".
    expect(tooltip).toHaveTextContent('15 - 22 Jul 2026');
  });

  it('shows the dates in the tooltip even for a trip with no location text', () => {
    renderMap([createTrip({ location: undefined })]);

    const tooltip = screen.getByTestId('mock-tooltip-trip-1');
    expect(tooltip).toHaveTextContent('15 - 22 Jul 2026');
  });

  it('spells out both months in the tooltip when the trip spans two', () => {
    renderMap([
      createTrip({
        startDate: '2026-07-28' as ISODateString,
        endDate: '2026-08-05' as ISODateString,
      }),
    ]);

    expect(screen.getByTestId('mock-tooltip-trip-1')).toHaveTextContent(
      '28 Jul - 5 Aug 2026',
    );
  });

  it('links the popup through to that trip\'s analytics', () => {
    renderMap([createTrip()]);

    const popup = screen.getByTestId('mock-popup-trip-1');
    expect(popup).toHaveTextContent('analytics.openTrip');
    expect(popup.querySelector('a')).toHaveAttribute('href', '/trips/trip-1/analytics');
  });

  it('places the marker at the trip coordinates', () => {
    renderMap([createTrip()]);

    expect(screen.getByTestId('mock-marker-trip-1')).toHaveAttribute(
      'data-position',
      JSON.stringify([48.3904, -4.4861]),
    );
  });

  it('leaves out trips that were never pinned', () => {
    renderMap([
      createTrip(),
      createTrip({ id: 'trip-2' as TripId, coordinates: undefined }),
    ]);

    expect(screen.getByTestId('mock-marker-trip-1')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-marker-trip-2')).not.toBeInTheDocument();
  });

  it('leaves out trips whose coordinates are unusable', () => {
    renderMap([
      createTrip(),
      // A NaN pair would put Leaflet at an undefined centre.
      createTrip({
        id: 'trip-2' as TripId,
        coordinates: { lat: Number.NaN, lon: 2.35 },
      }),
      createTrip({
        id: 'trip-3' as TripId,
        coordinates: { lat: 48.85, lon: 999 },
      }),
    ]);

    expect(screen.getByTestId('mock-marker-trip-1')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-marker-trip-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-marker-trip-3')).not.toBeInTheDocument();
  });

  it('reports how many trips have no pin, so the map cannot under-report silently', () => {
    renderMap([
      createTrip(),
      createTrip({ id: 'trip-2' as TripId, coordinates: undefined }),
      createTrip({ id: 'trip-3' as TripId, coordinates: undefined }),
    ]);

    expect(screen.getByText(/analytics\.tripsMapSummary/)).toBeInTheDocument();
    expect(screen.getByText(/analytics\.tripsMapUnpinned/)).toBeInTheDocument();
  });

  it('omits the unpinned note when every trip is on the map', () => {
    renderMap([createTrip()]);

    expect(screen.queryByText(/analytics\.tripsMapUnpinned/)).not.toBeInTheDocument();
  });

  it('shows a hint instead of an empty map when no trip is pinned', () => {
    renderMap([createTrip({ coordinates: undefined })]);

    expect(screen.getByText('analytics.tripsMapEmpty')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-map-view')).not.toBeInTheDocument();
  });

  it('shows the hint for an empty trip list', () => {
    renderMap([]);

    expect(screen.getByText('analytics.tripsMapEmpty')).toBeInTheDocument();
  });

  it('carries its own heading by default', () => {
    renderMap([createTrip()]);

    expect(screen.getByText('analytics.tripsMapTitle')).toBeInTheDocument();
  });

  it('drops the heading when the surrounding view already names it', () => {
    render(
      <MemoryRouter>
        <TripsLocationMap trips={[createTrip()]} asCard={false} />
      </MemoryRouter>,
    );

    expect(screen.queryByText('analytics.tripsMapTitle')).not.toBeInTheDocument();
    // Everything else still renders.
    expect(screen.getByTestId('mock-marker-trip-1')).toBeInTheDocument();
    expect(screen.getByText(/analytics\.tripsMapSummary/)).toBeInTheDocument();
  });

  it('still shows the empty hint without its heading', () => {
    render(
      <MemoryRouter>
        <TripsLocationMap trips={[createTrip({ coordinates: undefined })]} asCard={false} />
      </MemoryRouter>,
    );

    expect(screen.getByText('analytics.tripsMapEmpty')).toBeInTheDocument();
  });

  it('centres on the single trip and zooms in when there is only one', () => {
    renderMap([createTrip()]);

    const map = screen.getByTestId('mock-map-view');
    expect(map).toHaveAttribute('data-center', JSON.stringify([48.3904, -4.4861]));
    expect(map).toHaveAttribute('data-zoom', '11');
  });

  it('centres on the centroid and pulls back when several trips are pinned', () => {
    renderMap([
      createTrip({ coordinates: { lat: 10, lon: 20 } }),
      createTrip({ id: 'trip-2' as TripId, coordinates: { lat: 30, lon: 40 } }),
    ]);

    const map = screen.getByTestId('mock-map-view');
    expect(map).toHaveAttribute('data-center', JSON.stringify([20, 30]));
    expect(map).toHaveAttribute('data-zoom', '4');
  });
});
