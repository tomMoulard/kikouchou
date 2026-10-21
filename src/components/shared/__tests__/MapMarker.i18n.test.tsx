/**
 * @fileoverview A map marker's popup name, through the shipped catalogues.
 *
 * The suite-wide mock echoes the key, so only the real catalogue shows that
 * the place's label reaches the dialog name a screen reader hears.
 *
 * @module components/shared/__tests__/MapMarker.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen } from '@/test/utils';

import { MapMarker } from '../MapMarker';

// Hoisted above the imports: the real i18next, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

// Leaflet does not run under jsdom; the marker only has to hold its popup.
vi.mock('react-leaflet', () => ({
  Marker: ({ children }: { readonly children?: React.ReactNode }) => <div>{children}</div>,
  Popup: ({ children }: { readonly children?: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { readonly children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('leaflet', () => ({ divIcon: vi.fn(() => ({})) }));

describe('MapMarker popup name', () => {
  it('names the popup after the place it describes', async () => {
    await renderWithRealI18n(
      <MapMarker marker={{ id: 'm', position: [48.85, 2.35], label: 'Paris', popupContent: <p>Details</p> }} />,
      { withProviders: false },
    );

    expect(screen.getByRole('dialog', { name: 'Details for Paris' })).toBeInTheDocument();
  });
});
