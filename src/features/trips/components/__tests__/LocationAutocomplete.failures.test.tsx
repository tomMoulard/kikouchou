/**
 * @fileoverview What the location box does when a lookup fails or is undone.
 *
 * The sibling file covers the suggestions themselves. This one covers the paths
 * around them: a trip lookup that throws, a room load that fails after a trip
 * was already picked (the trip-level details still come across, because losing
 * them too would punish the reader twice for one failure), and backspacing
 * below the length that makes a search worth running.
 *
 * @module features/trips/components/__tests__/LocationAutocomplete.failures.test
 */

import { useState } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Coordinates } from '@/components/shared/LocationPicker';
import type { Trip, TripId } from '@/types';

import { LocationAutocomplete } from '../LocationAutocomplete';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/db', () => ({
  getTripsByLocation: vi.fn(),
  getRoomsByTripId: vi.fn(),
}));

import { getTripsByLocation, getRoomsByTripId } from '@/lib/db';

const mockedGetTripsByLocation = vi.mocked(getTripsByLocation);
const mockedGetRoomsByTripId = vi.mocked(getRoomsByTripId);

// ============================================================================
// Helpers
// ============================================================================

const EARLIER_TRIP = {
  id: 'trip-last-year' as TripId,
  shareId: 'share-old' as Trip['shareId'],
  name: 'Brittany 2025',
  location: 'Vannes',
  startDate: '2025-07-01',
  endDate: '2025-07-10',
  createdAt: 1,
  updatedAt: 1,
} as unknown as Trip;

function StatefulWrapper({
  onImportTrip,
}: {
  readonly onImportTrip?: (data: { trip: Trip; rooms: readonly unknown[] }) => void;
}) {
  const [value, setValue] = useState('');
  const [coordinates, setCoordinates] = useState<Coordinates | undefined>(undefined);

  return (
    <LocationAutocomplete
      value={value}
      coordinates={coordinates}
      onChange={(next, nextCoordinates) => {
        setValue(next);
        setCoordinates(nextCoordinates);
      }}
      onImportTrip={onImportTrip ?? vi.fn()}
      placeholder="Enter location"
    />
  );
}

beforeEach(() => {
  mockedGetTripsByLocation.mockResolvedValue([]);
  mockedGetRoomsByTripId.mockResolvedValue([]);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) }),
  );
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('LocationAutocomplete — when a lookup fails', () => {
  it('offers nothing rather than breaking when the trip lookup throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetTripsByLocation.mockRejectedValue(new Error('the read failed'));
    const user = userEvent.setup();

    render(<StatefulWrapper />);
    await user.type(screen.getByPlaceholderText('Enter location'), 'Vann');

    await waitFor(
      () => {
        expect(consoleError).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    expect(screen.queryByText('Brittany 2025')).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('still imports the trip when its rooms will not load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetTripsByLocation.mockResolvedValue([EARLIER_TRIP]);
    mockedGetRoomsByTripId.mockRejectedValue(new Error('the read failed'));
    const onImportTrip = vi.fn();
    const user = userEvent.setup();

    render(<StatefulWrapper onImportTrip={onImportTrip} />);
    await user.type(screen.getByPlaceholderText('Enter location'), 'Vann');

    const suggestion = await screen.findByText('Brittany 2025', undefined, { timeout: 2000 });
    await user.click(suggestion);

    await waitFor(() => {
      expect(onImportTrip).toHaveBeenCalled();
    });
    // The trip's own details are worth having even with no rooms behind them.
    expect(onImportTrip.mock.calls[0]?.[0]).toMatchObject({
      trip: expect.objectContaining({ id: EARLIER_TRIP.id }),
      rooms: [],
    });
    consoleError.mockRestore();
  });
});

describe('LocationAutocomplete — when the query gets too short', () => {
  it('drops the suggestions again', async () => {
    mockedGetTripsByLocation.mockResolvedValue([EARLIER_TRIP]);
    const user = userEvent.setup();

    render(<StatefulWrapper />);
    const input = screen.getByPlaceholderText('Enter location');
    await user.type(input, 'Vann');

    await screen.findByText('Brittany 2025', undefined, { timeout: 2000 });

    await user.clear(input);
    await user.type(input, 'V');

    await waitFor(
      () => {
        expect(screen.queryByText('Brittany 2025')).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
