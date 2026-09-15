/**
 * Component tests for LocationAutocomplete
 *
 * Tests rendering, search behavior, import selection, and accessibility.
 *
 * @module features/trips/components/__tests__/LocationAutocomplete.test
 */
import { useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  LocationAutocomplete,
  ImportBadge,
  type TripImportData,
} from '@/features/trips/components/LocationAutocomplete';
import type { Coordinates } from '@/lib/geocoding';
import type { TripId, ShareId, ISODateString } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

const mockTrips = [
  {
    id: 'trip-1' as TripId,
    name: 'Summer Vacation 2023',
    location: 'Beach House, Brittany',
    startDate: '2023-07-15' as ISODateString,
    endDate: '2023-07-22' as ISODateString,
    shareId: 'share-1' as ShareId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'trip-2' as TripId,
    name: 'Winter Retreat',
    location: 'Mountain Cabin',
    startDate: '2023-12-20' as ISODateString,
    endDate: '2023-12-27' as ISODateString,
    shareId: 'share-2' as ShareId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

const mockRooms = [
  {
    id: 'room-1',
    tripId: 'trip-1' as TripId,
    name: 'Master Bedroom',
    capacity: 2,
    order: 0,
  },
];

/** Raw Nominatim payload the geocoder is fed in these tests. */
const mockPlaces = [
  {
    place_id: 101,
    display_name: 'Brest, Finistère, Bretagne, France',
    lat: '48.3904',
    lon: '-4.4861',
    type: 'city',
    class: 'place',
  },
];

vi.mock('@/lib/db', () => ({
  getTripsByLocation: vi.fn(),
  getRoomsByTripId: vi.fn(),
}));

import { getTripsByLocation, getRoomsByTripId } from '@/lib/db';

const mockedGetTripsByLocation = vi.mocked(getTripsByLocation);
const mockedGetRoomsByTripId = vi.mocked(getRoomsByTripId);

// ============================================================================
// Test Wrapper (manages controlled state for typing tests)
// ============================================================================

/**
 * Wrapper that manages the controlled value state so typing works in tests.
 */
function StatefulWrapper({
  initialValue = '',
  initialCoordinates,
  onImportTrip,
  onLocationChange,
}: {
  readonly initialValue?: string;
  readonly initialCoordinates?: Coordinates;
  readonly onImportTrip?: (data: TripImportData) => void;
  readonly onLocationChange?: (value: string, coordinates?: Coordinates) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [coordinates, setCoordinates] = useState<Coordinates | undefined>(
    initialCoordinates,
  );

  return (
    <LocationAutocomplete
      value={value}
      coordinates={coordinates}
      onChange={(next, nextCoordinates) => {
        setValue(next);
        setCoordinates(nextCoordinates);
        onLocationChange?.(next, nextCoordinates);
      }}
      onImportTrip={onImportTrip ?? vi.fn()}
      placeholder="Enter location"
    />
  );
}

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  mockedGetTripsByLocation.mockResolvedValue([]);
  mockedGetRoomsByTripId.mockResolvedValue([]);
  // The place search must never reach the real Nominatim from a test.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
  );
  // Mock scrollIntoView for cmdk (not available in JSDOM)
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Points the stubbed fetch at the given Nominatim payload.
 */
function respondWithPlaces(payload: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }),
  );
}

// ============================================================================
// Rendering Tests
// ============================================================================

describe('LocationAutocomplete Rendering', () => {
  it('renders an input element', () => {
    const onChange = vi.fn();
    const onImportTrip = vi.fn();

    render(
      <LocationAutocomplete
        value=""
        onChange={onChange}
        onImportTrip={onImportTrip}
      />,
    );

    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders with provided value', () => {
    const onChange = vi.fn();
    const onImportTrip = vi.fn();

    render(
      <LocationAutocomplete
        value="Beach House"
        onChange={onChange}
        onImportTrip={onImportTrip}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveValue('Beach House');
  });

  it('renders with placeholder text', () => {
    const onChange = vi.fn();
    const onImportTrip = vi.fn();

    render(
      <LocationAutocomplete
        value=""
        onChange={onChange}
        onImportTrip={onImportTrip}
        placeholder="Enter location"
      />,
    );

    expect(screen.getByPlaceholderText('Enter location')).toBeInTheDocument();
  });

  it('renders disabled state', () => {
    const onChange = vi.fn();
    const onImportTrip = vi.fn();

    render(
      <LocationAutocomplete
        value=""
        onChange={onChange}
        onImportTrip={onImportTrip}
        disabled
      />,
    );

    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('has combobox aria attributes', () => {
    const onChange = vi.fn();
    const onImportTrip = vi.fn();

    render(
      <LocationAutocomplete
        value=""
        onChange={onChange}
        onImportTrip={onImportTrip}
      />,
    );

    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-haspopup', 'listbox');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
  });
});

// ============================================================================
// Input Change Tests
// ============================================================================

describe('LocationAutocomplete Input Change', () => {
  it('calls onChange when user types', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onImportTrip = vi.fn();

    render(
      <LocationAutocomplete
        value=""
        onChange={onChange}
        onImportTrip={onImportTrip}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.type(input, 'B');

    // Coordinates travel with every change: free text carries none.
    expect(onChange).toHaveBeenCalledWith('B', undefined);
  });

  it('triggers search after debounce with 2+ characters', async () => {
    const user = userEvent.setup();
    mockedGetTripsByLocation.mockResolvedValue([]);

    render(<StatefulWrapper />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'Be');

    await waitFor(() => {
      expect(mockedGetTripsByLocation).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Dropdown Tests
// ============================================================================

describe('LocationAutocomplete Dropdown', () => {
  it('shows suggestions when matches are found', async () => {
    const user = userEvent.setup();
    mockedGetTripsByLocation.mockResolvedValue([mockTrips[0]!]);

    render(<StatefulWrapper />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'Beach');

    await waitFor(() => {
      expect(screen.getByText('Beach House, Brittany')).toBeInTheDocument();
    });

    expect(screen.getByText('Summer Vacation 2023')).toBeInTheDocument();
  });

  it('calls onImportTrip when a suggestion is selected', async () => {
    const user = userEvent.setup();
    const onImportTrip = vi.fn();
    mockedGetTripsByLocation.mockResolvedValue([mockTrips[0]!]);
    mockedGetRoomsByTripId.mockResolvedValue(mockRooms as never);

    render(<StatefulWrapper onImportTrip={onImportTrip} />);

    const input = screen.getByRole('combobox');
    await user.type(input, 'Beach');

    await waitFor(() => {
      expect(screen.getByText('Beach House, Brittany')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Beach House, Brittany'));

    await waitFor(() => {
      expect(onImportTrip).toHaveBeenCalledTimes(1);
      expect(onImportTrip).toHaveBeenCalledWith(
        expect.objectContaining({
          trip: mockTrips[0],
          rooms: mockRooms,
        }),
      );
    });
  });
});

// ============================================================================
// Map Place Tests
// ============================================================================

describe('LocationAutocomplete Map Places', () => {
  it('offers places from the geocoder alongside previous trips', async () => {
    const user = userEvent.setup();
    respondWithPlaces(mockPlaces);
    mockedGetTripsByLocation.mockResolvedValue([mockTrips[0]!]);

    render(<StatefulWrapper />);

    await user.type(screen.getByRole('combobox'), 'Bre');

    await waitFor(() => {
      expect(screen.getByText('Brest, Finistère, Bretagne')).toBeInTheDocument();
    });
    // Both sources share the dropdown.
    expect(screen.getByText('Beach House, Brittany')).toBeInTheDocument();
  });

  it('shows the map for confirmation instead of committing the place straight away', async () => {
    const user = userEvent.setup();
    respondWithPlaces(mockPlaces);
    const onLocationChange = vi.fn();

    render(<StatefulWrapper onLocationChange={onLocationChange} />);

    await user.type(screen.getByRole('combobox'), 'Bre');

    await waitFor(() => {
      expect(screen.getByText('Brest, Finistère, Bretagne')).toBeInTheDocument();
    });

    onLocationChange.mockClear();
    await user.click(screen.getByText('Brest, Finistère, Bretagne'));

    // Picking the place is the decision: it is saved at once, and the map that
    // follows is only for nudging the pin.
    expect(onLocationChange).toHaveBeenCalledWith('Brest, Finistère, Bretagne', {
      lat: 48.3904,
      lon: -4.4861,
    });
    expect(await screen.findByTestId('location-map-picker')).toBeInTheDocument();
  });

  it('offers no confirm or cancel button on the map', async () => {
    const user = userEvent.setup();
    respondWithPlaces(mockPlaces);
    const onLocationChange = vi.fn();

    render(<StatefulWrapper onLocationChange={onLocationChange} />);

    await user.type(screen.getByRole('combobox'), 'Bre');
    await waitFor(() => {
      expect(screen.getByText('Brest, Finistère, Bretagne')).toBeInTheDocument();
    });
    await user.click(screen.getByText('Brest, Finistère, Bretagne'));

    await screen.findByTestId('location-map-picker');

    expect(
      screen.queryByRole('button', { name: /confirmLocation/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /common\.cancel/i })).not.toBeInTheDocument();
  });

  it('still shows trip suggestions when the geocoder fails', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetTripsByLocation.mockResolvedValue([mockTrips[0]!]);

    render(<StatefulWrapper />);

    await user.type(screen.getByRole('combobox'), 'Beach');

    // A dead Nominatim must not take the local suggestions down with it.
    await waitFor(() => {
      expect(screen.getByText('Beach House, Brittany')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Existing Pin Tests
// ============================================================================

describe('LocationAutocomplete Existing Pin', () => {
  // A map, and nothing else. The panel used to print the latitude and
  // longitude under it, which says less to a reader than the pin does.
  it('shows the map for an already-pinned trip, without its coordinates', () => {
    render(
      <StatefulWrapper
        initialValue="Brest, Bretagne"
        initialCoordinates={{ lat: 48.3904, lon: -4.4861 }}
      />,
    );

    expect(screen.getByTestId('location-map-picker')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /trips\.removePin/ })).toBeInTheDocument();
    expect(screen.queryByText(/48\.390400/)).not.toBeInTheDocument();
  });

  it('shows no map when the trip has only a free-text location', () => {
    render(<StatefulWrapper initialValue="Somewhere nice" />);

    expect(screen.queryByTestId('location-map-picker')).not.toBeInTheDocument();
  });

  it('drops the pin but keeps the name when the pin is removed', async () => {
    const user = userEvent.setup();
    const onLocationChange = vi.fn();

    render(
      <StatefulWrapper
        initialValue="Brest, Bretagne"
        initialCoordinates={{ lat: 48.3904, lon: -4.4861 }}
        onLocationChange={onLocationChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: /trips\.removePin/ }));

    expect(onLocationChange).toHaveBeenCalledWith('Brest, Bretagne', undefined);
    await waitFor(() => {
      expect(screen.queryByText(/trips\.pinnedAt/)).not.toBeInTheDocument();
    });
    expect(screen.getByRole('combobox')).toHaveValue('Brest, Bretagne');
  });

  it('drops a pin the typed name no longer describes', async () => {
    const user = userEvent.setup();
    const onLocationChange = vi.fn();

    render(
      <StatefulWrapper
        initialValue="Brest"
        initialCoordinates={{ lat: 48.3904, lon: -4.4861 }}
        onLocationChange={onLocationChange}
      />,
    );

    await user.type(screen.getByRole('combobox'), 'x');

    expect(onLocationChange).toHaveBeenCalledWith('Brestx', undefined);
    await waitFor(() => {
      expect(screen.queryByText(/trips\.pinnedAt/)).not.toBeInTheDocument();
    });
  });

  // There is no "adjust pin" button any more, and nothing to press to get the
  // map back: it is on screen for as long as the trip has a pin.
  it('keeps the map on screen without an adjust step', () => {
    render(
      <StatefulWrapper
        initialValue="Brest, Bretagne"
        initialCoordinates={{ lat: 48.3904, lon: -4.4861 }}
      />,
    );

    expect(screen.getByTestId('location-map-picker')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /trips\.adjustPin/ })).not.toBeInTheDocument();
  });
});

// ============================================================================
// ImportBadge Tests
// ============================================================================

describe('ImportBadge', () => {
  it('renders trip name and room count', () => {
    const onRemove = vi.fn();

    render(
      <ImportBadge
        tripName="Summer Vacation"
        roomCount={3}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText(/trips\.importedFrom/)).toBeInTheDocument();
    expect(screen.getByText(/3 rooms/)).toBeInTheDocument();
  });

  it('calls onRemove when remove button is clicked', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();

    render(
      <ImportBadge
        tripName="Summer Vacation"
        roomCount={3}
        onRemove={onRemove}
      />,
    );

    const removeButton = screen.getByRole('button', { name: /trips\.removeImport/ });
    await user.click(removeButton);

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('disables remove button when disabled prop is true', () => {
    const onRemove = vi.fn();

    render(
      <ImportBadge
        tripName="Summer Vacation"
        roomCount={3}
        onRemove={onRemove}
        disabled
      />,
    );

    const removeButton = screen.getByRole('button', { name: /trips\.removeImport/ });
    expect(removeButton).toBeDisabled();
  });

  it('shows singular room text for 1 room', () => {
    const onRemove = vi.fn();

    render(
      <ImportBadge
        tripName="Summer Vacation"
        roomCount={1}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText(/1 room\b/)).toBeInTheDocument();
  });
});
