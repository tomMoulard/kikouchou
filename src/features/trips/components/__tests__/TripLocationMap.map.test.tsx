/**
 * @fileoverview What the trip location map hands its two maps, read in English.
 *
 * MapView is stubbed so the props it receives can be read back: the preview
 * is a still picture, the dialog map is the one you can move. The strings come
 * from the real catalogue, because the suite-wide mock drops the place name
 * the labels are built around.
 *
 * @module features/trips/components/__tests__/TripLocationMap.map.test
 */

import { describe, expect, it, vi } from 'vitest';

import { fireEvent, renderWithRealI18n, screen, within } from '@/test/utils';
import type { MapMarkerData } from '@/components/shared/MapView';

import { TripLocationMap } from '../TripLocationMap';

vi.unmock('i18next');
vi.unmock('react-i18next');

vi.mock('@/components/shared/MapView', () => ({
  MapView: (props: {
    center: readonly [number, number];
    markers: readonly MapMarkerData[];
    interactive: boolean;
    showZoomControl: boolean;
    showAttribution: boolean;
    'aria-label': string;
  }) => (
    <div
      data-testid="map"
      aria-label={props['aria-label']}
      data-center={JSON.stringify(props.center)}
      data-markers={JSON.stringify(
        props.markers.map(({ id, position, label, type }) => ({ id, position, label, type })),
      )}
      data-flags={[props.interactive, props.showZoomControl, props.showAttribution].join(',')}
    />
  ),
}));

const PLACE = 'Beach House, Brittany';
const POINT = { lat: 48.8566, lon: 2.3522 };

function preview(): HTMLElement {
  return screen.getByRole('button', { name: `View location on map: ${PLACE}` });
}

async function renderMap(location = PLACE, coordinates = POINT) {
  return renderWithRealI18n(<TripLocationMap location={location} coordinates={coordinates} />, {
    withProviders: false,
  });
}

const MARKERS = JSON.stringify([
  { id: 'trip-location', position: [48.8566, 2.3522], label: PLACE, type: 'trip' },
]);

describe('TripLocationMap maps', () => {
  it('shows a still preview centred on the trip, with its one marker', async () => {
    await renderMap();

    const map = screen.getByTestId('map');
    expect(map).toHaveAttribute('aria-label', 'Trip location preview');
    expect(map).toHaveAttribute('data-center', '[48.8566,2.3522]');
    expect(map).toHaveAttribute('data-markers', MARKERS);
    expect(map).toHaveAttribute('data-flags', 'false,false,false');
  });

  it('styles the preview as a framed, clickable tile with a corner hint', async () => {
    await renderMap();

    expect(preview()).toHaveClass(
      'relative',
      'rounded-md',
      'border-border',
      'cursor-pointer',
      'hover:shadow-sm',
    );
    const hint = preview().querySelector('[aria-hidden="true"].absolute');
    expect(hint).toHaveClass('bottom-1', 'right-1', 'backdrop-blur-sm', 'text-muted-foreground');
    expect(hint).toHaveClass('pointer-events-none');
  });

  it('offers directions on the preview as an icon, named for readers', async () => {
    await renderMap();

    const directions = screen.getByRole('button', { name: 'Get directions' });
    expect(directions).toHaveTextContent(/^$/);
  });

  it('opens a map you can move, centred and named after the place', async () => {
    const { user } = await renderMap();

    await user.click(preview());

    const dialog = await screen.findByRole('dialog');
    const map = within(dialog).getByTestId('map');
    expect(map).toHaveAttribute('aria-label', `Trip location: ${PLACE}`);
    expect(map).toHaveAttribute('data-center', '[48.8566,2.3522]');
    expect(map).toHaveAttribute('data-markers', MARKERS);
    expect(map).toHaveAttribute('data-flags', 'true,true,true');
  });

  it('opens on Enter and Space without letting the key through, and on no other key', async () => {
    await renderMap();

    expect(fireEvent.keyDown(preview(), { key: 'a' })).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    expect(fireEvent.keyDown(preview(), { key: 'Enter' })).toBe(false);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('opens on Space', async () => {
    await renderMap();

    expect(fireEvent.keyDown(preview(), { key: ' ' })).toBe(false);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('opens and copies the place it is given now', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { user, rerender } = await renderMap();
    rerender(<TripLocationMap location="Harbour" coordinates={{ lat: 1, lon: 2 }} />);

    await user.click(screen.getByRole('button', { name: 'View location on map: Harbour' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Copy address' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Open in Maps' }));
    await user.click(within(dialog).getByRole('button', { name: 'Copy address' }));

    expect(open).toHaveBeenCalledWith(
      'https://www.google.com/maps/search/?api=1&query=1,2',
      '_blank',
      'noopener,noreferrer',
    );
    expect(await navigator.clipboard.readText()).toBe('Harbour');
    open.mockRestore();
  });
});
