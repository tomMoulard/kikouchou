/**
 * @fileoverview The trips map read through the real catalogue.
 *
 * The suite-wide i18n mock drops `count` and has no language, so neither the
 * counted summary nor the language of the dates can be checked with it.
 *
 * @module features/trips/components/__tests__/TripsLocationMap.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { act, renderWithRealI18n, screen } from '@/test/utils';
import type { MapMarkerData } from '@/components/shared/MapView';
import type { ISODateString, ShareId, Trip, TripId } from '@/types';

import { TripsLocationMap } from '../TripsLocationMap';

vi.unmock('i18next');
vi.unmock('react-i18next');

vi.mock('@/components/shared/MapView', () => ({
  MapView: ({ markers = [] }: { markers?: readonly MapMarkerData[] }) => (
    <div>
      {markers.map((marker) => (
        <div key={marker.id} data-testid={`tooltip-${marker.id}`}>
          {marker.tooltipContent}
        </div>
      ))}
    </div>
  ),
}));

function trip(id: string, coordinates?: { lat: number; lon: number }): Trip {
  return {
    id: id as TripId,
    name: `Trip ${id}`,
    location: 'Brest',
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-22' as ISODateString,
    shareId: `share-${id}` as ShareId,
    ...(coordinates ? { coordinates } : {}),
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('TripsLocationMap in a real language', () => {
  it('counts the trips on the map and the ones without a pin', async () => {
    await renderWithRealI18n(
      <TripsLocationMap
        trips={[
          trip('a', { lat: 1, lon: 2 }),
          trip('b', { lat: 3, lon: 4 }),
          trip('c'),
        ]}
      />,
      { withProviders: false },
    );

    expect(
      screen.getByText('2 trips on the map · 1 trip without a map pin'),
    ).toBeInTheDocument();
  });

  it('writes the dates in the language the app is read in, also after a switch', async () => {
    const { i18n } = await renderWithRealI18n(
      <TripsLocationMap trips={[trip('a', { lat: 1, lon: 2 })]} />,
      { withProviders: false, language: 'fr' },
    );
    expect(screen.getByTestId('tooltip-a')).toHaveTextContent('juil.');

    try {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
      expect(screen.getByTestId('tooltip-a')).toHaveTextContent('Jul');
    } finally {
      await i18n.changeLanguage('fr');
    }
  });
});
