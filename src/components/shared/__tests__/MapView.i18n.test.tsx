/**
 * @fileoverview The map's marker count announcement, through the shipped
 * catalogues.
 *
 * The suite-wide mock drops `count`, so only the real catalogue shows that the
 * number reaches the sentence a screen reader hears.
 *
 * @module components/shared/__tests__/MapView.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { renderSwitchingLanguage, renderWithRealI18n, screen } from '@/test/utils';

import { MapView } from '../MapView';

// Hoisted above the imports: the real i18next, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

const map = {
  panTo: vi.fn(),
  setZoom: vi.fn(),
  fitBounds: vi.fn(),
  getContainer: () => document.createElement('div'),
  getBounds: () => ({ contains: () => true }),
};

// Leaflet does not run under jsdom; none of the map is needed for the count.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { readonly children?: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Polyline: () => null,
  useMap: () => map,
  useMapEvents: () => null,
}));
vi.mock('leaflet', () => ({ divIcon: vi.fn(() => ({})) }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('@/components/shared/MapMarker', () => ({ MapMarker: () => null }));

describe('MapView marker count', () => {
  it('counts the markers aloud', async () => {
    await renderWithRealI18n(
      <MapView
        center={[0, 0]}
        markers={[
          { id: 'a', position: [1, 1], label: 'A' },
          { id: 'b', position: [2, 2], label: 'B' },
        ]}
      />,
      { withProviders: false },
    );

    expect(screen.getByText('2 locations on map')).toBeInTheDocument();
  });
});

describe('MapView across a language switch', () => {
  it('renames the map in the new language without being remounted', async () => {
    const { switchTo } = await renderSwitchingLanguage(<MapView center={[0, 0]} markers={[]} />, {
      withProviders: false,
    });
    expect(screen.getByRole('application', { name: 'Interactive map' })).toBeInTheDocument();

    await switchTo('fr');

    expect(screen.getByRole('application', { name: 'Carte interactive' })).toBeInTheDocument();
  });
});
