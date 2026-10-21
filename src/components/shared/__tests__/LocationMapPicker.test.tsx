/**
 * @fileoverview The map under a picked place, where dragging the pin or
 * clicking the map moves it.
 *
 * Leaflet does not run under jsdom, so react-leaflet is replaced at its module
 * boundary: the marker becomes a button that reports a drag, and the map's
 * click handler is captured so the test can click the map.
 *
 * @module components/shared/__tests__/LocationMapPicker.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, fireEvent, render, screen } from '@/test/utils';

import { LocationMapPicker } from '../LocationMapPicker';

// ============================================================================
// Leaflet boundary
// ============================================================================

const { leaflet } = vi.hoisted(() => ({
  leaflet: {
    click: null as ((event: { latlng: { lat: number; lng: number } }) => void) | null,
    icon: null as { options: Record<string, unknown> } | null,
    mapProps: null as Record<string, unknown> | null,
    tileUrl: null as string | null,
  },
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, ...props }: { readonly children: React.ReactNode } & Record<string, unknown>) => {
    leaflet.mapProps = props;
    return <div data-testid="map">{children}</div>;
  },
  TileLayer: ({ url }: { readonly url: string }) => {
    leaflet.tileUrl = url;
    return null;
  },
  Marker: ({
    position,
    draggable,
    icon,
    eventHandlers,
  }: {
    readonly position: [number, number];
    readonly draggable: boolean;
    readonly icon: { options: Record<string, unknown> };
    readonly eventHandlers: { dragend: (event: { target: { getLatLng: () => { lat: number; lng: number } } }) => void };
  }) => {
    leaflet.icon = icon;
    return (
      <button
        type="button"
        data-testid="marker"
        aria-label="marker"
        data-position={position.join(',')}
        data-draggable={String(draggable)}
        onClick={() => eventHandlers.dragend({ target: { getLatLng: () => ({ lat: 45.5, lng: 6.25 }) } })}
      />
    );
  },
  useMapEvents: (handlers: { click: (event: { latlng: { lat: number; lng: number } }) => void }) => {
    leaflet.click = handlers.click;
    return null;
  },
}));

// ============================================================================
// Tests
// ============================================================================

describe('LocationMapPicker', () => {
  beforeEach(() => {
    leaflet.click = null;
    leaflet.icon = null;
    leaflet.mapProps = null;
    leaflet.tileUrl = null;
  });

  it('centres a street-level map on the pin', () => {
    render(
      <LocationMapPicker coordinates={{ lat: 48.85, lon: 2.35 }} onCoordinatesChange={vi.fn()} />,
      { withProviders: false },
    );

    expect(leaflet.mapProps).toMatchObject({
      center: [48.85, 2.35],
      zoom: 15,
      zoomControl: true,
      dragging: true,
      touchZoom: true,
      doubleClickZoom: false,
      scrollWheelZoom: true,
      className: 'h-full w-full',
      attributionControl: false,
    });
    expect(leaflet.tileUrl).toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(screen.getByTestId('marker')).toHaveAttribute('data-position', '48.85,2.35');
    expect(screen.getByTestId('marker')).toHaveAttribute('data-draggable', 'true');
  });

  it('draws the pin as a round blue grab handle anchored at its point', () => {
    render(
      <LocationMapPicker coordinates={{ lat: 48.85, lon: 2.35 }} onCoordinatesChange={vi.fn()} />,
      { withProviders: false },
    );

    expect(leaflet.icon?.options).toMatchObject({
      className: 'draggable-marker-icon',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
    });
    expect(String(leaflet.icon?.options.html)).toContain('background-color: #3b82f6');
    expect(String(leaflet.icon?.options.html)).toContain('cursor: grab');
  });

  it('saves the pin where it is dropped', () => {
    const onCoordinatesChange = vi.fn();
    render(
      <LocationMapPicker coordinates={{ lat: 48.85, lon: 2.35 }} onCoordinatesChange={onCoordinatesChange} />,
      { withProviders: false },
    );

    fireEvent.click(screen.getByTestId('marker'));

    expect(onCoordinatesChange).toHaveBeenCalledWith({ lat: 45.5, lon: 6.25 });
  });

  it('moves the pin to where the map is clicked', () => {
    const onCoordinatesChange = vi.fn();
    render(
      <LocationMapPicker coordinates={{ lat: 48.85, lon: 2.35 }} onCoordinatesChange={onCoordinatesChange} />,
      { withProviders: false },
    );

    act(() => {
      leaflet.click?.({ latlng: { lat: 43.3, lng: 5.4 } });
    });

    expect(onCoordinatesChange).toHaveBeenCalledWith({ lat: 43.3, lon: 5.4 });
  });

  it('reports to the newest callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <LocationMapPicker coordinates={{ lat: 48.85, lon: 2.35 }} onCoordinatesChange={first} />,
      { withProviders: false },
    );
    rerender(<LocationMapPicker coordinates={{ lat: 48.85, lon: 2.35 }} onCoordinatesChange={second} />);

    fireEvent.click(screen.getByTestId('marker'));

    expect(second).toHaveBeenCalledWith({ lat: 45.5, lon: 6.25 });
    expect(first).not.toHaveBeenCalled();
  });

  it('frames the map at its default height, with the instruction over it and no remove button', () => {
    render(
      <LocationMapPicker coordinates={{ lat: 48.85, lon: 2.35 }} onCoordinatesChange={vi.fn()} className="extra" />,
      { withProviders: false },
    );

    const panel = screen.getByTestId('location-map-picker');
    expect(panel).toHaveClass('mt-2', 'rounded-md', 'border', 'border-border', 'overflow-hidden', 'extra');
    const frame = screen.getByTestId('map').parentElement as HTMLElement;
    expect(frame).toHaveClass('relative');
    expect(frame.style.height).toBe('200px');
    const hint = screen.getByText('locationPicker.dragToAdjust');
    expect(hint).toHaveClass('bg-background/90', 'rounded-md', 'px-2', 'py-1', 'text-xs', 'text-muted-foreground', 'text-center');
    expect(hint.parentElement).toHaveClass('absolute', 'top-2', 'left-2', 'right-2', 'z-[1000]', 'pointer-events-none');
    expect(screen.queryByRole('button', { name: 'Remove pin' })).not.toBeInTheDocument();
  });

  it('takes a height, and offers a remove button when asked', () => {
    const onRemove = vi.fn();
    render(
      <LocationMapPicker
        coordinates={{ lat: 48.85, lon: 2.35 }}
        onCoordinatesChange={vi.fn()}
        onRemove={onRemove}
        removeLabel="Remove pin"
        height={320}
      />,
      { withProviders: false },
    );

    expect((screen.getByTestId('map').parentElement as HTMLElement).style.height).toBe('320px');
    const remove = screen.getByRole('button', { name: 'Remove pin' });
    expect(remove).toHaveClass('shadow-md');
    expect(remove.parentElement).toHaveClass('absolute', 'bottom-2', 'right-2', 'z-[1000]');
    expect(remove.querySelector('svg')).toHaveClass('size-3.5');

    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
