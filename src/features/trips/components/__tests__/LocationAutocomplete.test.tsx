/**
 * Component tests for LocationAutocomplete
 *
 * Tests rendering, search behavior, import selection, and accessibility.
 *
 * @module features/trips/components/__tests__/LocationAutocomplete.test
 */
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  LocationAutocomplete,
  ImportBadge,
  type TripImportData,
} from '@/features/trips/components/LocationAutocomplete';
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
  onImportTrip,
}: {
  readonly initialValue?: string;
  readonly onImportTrip?: (data: TripImportData) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <LocationAutocomplete
      value={value}
      onChange={setValue}
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
  // Mock scrollIntoView for cmdk (not available in JSDOM)
  Element.prototype.scrollIntoView = vi.fn();
});

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

    expect(onChange).toHaveBeenCalledWith('B');
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
