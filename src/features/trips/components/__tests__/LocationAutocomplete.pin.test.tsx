/**
 * What a dragged pin does to the trip's location.
 *
 * Its own file because it stubs the map. The main suite renders the real
 * `LocationMapPicker` to check that the panel appears at all, and dragging a
 * Leaflet marker is not something jsdom can do. The stub gives the one seam
 * that matters here: the callback the map fires when the marker moves.
 *
 * @module features/trips/components/__tests__/LocationAutocomplete.pin.test
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { LocationAutocomplete } from '@/features/trips/components/LocationAutocomplete';
import type { Coordinates } from '@/lib/geocoding';

vi.mock('@/lib/db', () => ({
  getTripsByLocation: vi.fn().mockResolvedValue([]),
  getRoomsByTripId: vi.fn().mockResolvedValue([]),
}));

const MOVED_TO: Coordinates = { lat: 43.2957, lon: 5.3806 };

vi.mock('@/components/shared/LocationMapPicker', () => ({
  LocationMapPicker: ({
    coordinates,
    onCoordinatesChange,
    onRemove,
  }: {
    coordinates: Coordinates;
    onCoordinatesChange: (next: Coordinates) => void;
    onRemove?: () => void;
  }) => (
    <div data-testid="map-stub" data-lat={coordinates.lat} data-lon={coordinates.lon}>
      <button type="button" onClick={() => onCoordinatesChange(MOVED_TO)}>
        drag the pin
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove}>
          remove the pin
        </button>
      )}
    </div>
  ),
}));

function Harness({
  onLocationChange,
}: {
  onLocationChange: (value: string, coordinates?: Coordinates) => void;
}) {
  const [value, setValue] = useState('Villa des Luquettes');
  const [coordinates, setCoordinates] = useState<Coordinates | undefined>({
    lat: 43.2156,
    lon: 5.7382,
  });

  return (
    <LocationAutocomplete
      value={value}
      coordinates={coordinates}
      onChange={(next, nextCoordinates) => {
        setValue(next);
        setCoordinates(nextCoordinates);
        onLocationChange(next, nextCoordinates);
      }}
      onImportTrip={vi.fn()}
    />
  );
}

describe('LocationAutocomplete pin', () => {
  let onLocationChange: ReturnType<
    typeof vi.fn<(value: string, coordinates?: Coordinates) => void>
  >;

  beforeEach(() => {
    onLocationChange = vi.fn<(value: string, coordinates?: Coordinates) => void>();
  });

  // The point of the change: moving the pin is the edit, so it is saved as it
  // happens. There used to be a confirm button, and a pin moved without
  // pressing it was thrown away when the panel closed.
  it('saves a moved pin without anything else being pressed', async () => {
    const user = userEvent.setup();
    render(<Harness onLocationChange={onLocationChange} />);

    await user.click(screen.getByRole('button', { name: 'drag the pin' }));

    expect(onLocationChange).toHaveBeenCalledTimes(1);
    expect(onLocationChange).toHaveBeenCalledWith('Villa des Luquettes', MOVED_TO);
  });

  it('keeps the place name when only the pin moves', async () => {
    const user = userEvent.setup();
    render(<Harness onLocationChange={onLocationChange} />);

    await user.click(screen.getByRole('button', { name: 'drag the pin' }));

    const [name] = onLocationChange.mock.calls[0]!;
    expect(name).toBe('Villa des Luquettes');
  });

  it('shows the map at the new position after the move', async () => {
    const user = userEvent.setup();
    render(<Harness onLocationChange={onLocationChange} />);

    await user.click(screen.getByRole('button', { name: 'drag the pin' }));

    expect(screen.getByTestId('map-stub')).toHaveAttribute('data-lat', String(MOVED_TO.lat));
  });

  it('drops the pin but keeps the name when removed', async () => {
    const user = userEvent.setup();
    render(<Harness onLocationChange={onLocationChange} />);

    await user.click(screen.getByRole('button', { name: 'remove the pin' }));

    expect(onLocationChange).toHaveBeenCalledWith('Villa des Luquettes', undefined);
    expect(screen.queryByTestId('map-stub')).not.toBeInTheDocument();
  });
});
