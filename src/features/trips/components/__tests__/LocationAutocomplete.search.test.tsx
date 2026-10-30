/**
 * @fileoverview The two lookups behind the location box, in the order they land.
 *
 * The trip lookup and the place lookup are held here as promises the test
 * settles by hand, so each race the component guards against (a stale answer
 * arriving after a newer one, an abort, a failure, an unmount) is played in a
 * fixed order rather than left to timing. The map is a stub with one button
 * per callback, as in the `.pin` file, and the strings come from the real
 * English catalogue, so a heading or a count that lost its key shows here.
 *
 * @module features/trips/components/__tests__/LocationAutocomplete.search.test
 */

import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act, fireEvent, renderWithRealI18n, screen, waitFor, within } from '@/test/utils';
import { getRoomsByTripId, getTripsByLocation } from '@/lib/db';
import { GeocodingError, searchPlaces, type Coordinates, type GeocodingPlace } from '@/lib/geocoding';
import type { Room, Trip, TripId } from '@/types';

import { ImportBadge, LocationAutocomplete, type TripImportData } from '../LocationAutocomplete';

vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/lib/db', () => ({
  getTripsByLocation: vi.fn(),
  getRoomsByTripId: vi.fn(),
}));

vi.mock('@/lib/geocoding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/geocoding')>()),
  searchPlaces: vi.fn(),
}));

const MOVED_TO: Coordinates = { lat: 43.2957, lon: 5.3806 };

vi.mock('@/components/shared/LocationMapPicker', () => ({
  LocationMapPicker: ({
    onCoordinatesChange,
    onRemove,
  }: {
    onCoordinatesChange: (next: Coordinates) => void;
    onRemove?: () => void;
  }) => (
    <div data-testid="map-stub">
      <button type="button" onClick={() => onCoordinatesChange(MOVED_TO)}>
        drag the pin
      </button>
      <button type="button" onClick={onRemove}>
        remove the pin
      </button>
    </div>
  ),
}));

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tripLookups: { query: string; answer: Deferred<Trip[]> }[] = [];
const placeLookups: {
  query: string;
  options: { signal?: AbortSignal; limit?: number } | undefined;
  answer: Deferred<readonly GeocodingPlace[]>;
}[] = [];

function trip(id: string, location: string): Trip {
  return {
    id: id as TripId,
    name: `Trip ${id}`,
    location,
    startDate: '2025-07-01',
    endDate: '2025-07-10',
    shareId: `share-${id}`,
    createdAt: 1,
    updatedAt: 1,
  } as unknown as Trip;
}

const NANTES = trip('nantes', 'Nantes');
const BREST_TRIP = trip('brest', 'Brest harbour');

const BREST: GeocodingPlace = {
  id: 'p-brest',
  label: 'Brest',
  detail: 'Finistère, France',
  typeLabel: 'City',
  coordinates: { lat: 48.39, lon: -4.49 },
};
const BRETAGNE: GeocodingPlace = {
  id: 'p-bretagne',
  label: 'Bretagne',
  detail: '',
  typeLabel: 'Region',
  coordinates: { lat: 48.2, lon: -2.9 },
};

interface HarnessProps {
  readonly excludeTripId?: TripId;
  readonly onImportTrip?: (data: TripImportData) => void;
  readonly onLocationChange?: (value: string, coordinates?: Coordinates) => void;
}

function Harness({ excludeTripId, onImportTrip, onLocationChange }: HarnessProps) {
  const [value, setValue] = useState('');
  const [coordinates, setCoordinates] = useState<Coordinates | undefined>(undefined);

  return (
    <LocationAutocomplete
      value={value}
      {...(coordinates === undefined ? {} : { coordinates })}
      {...(excludeTripId === undefined ? {} : { excludeTripId })}
      onChange={(next, nextCoordinates) => {
        setValue(next);
        setCoordinates(nextCoordinates);
        onLocationChange?.(next, nextCoordinates);
      }}
      onImportTrip={onImportTrip ?? vi.fn()}
    />
  );
}

async function renderHarness(props: HarnessProps = {}) {
  return renderWithRealI18n(<Harness {...props} />, { withProviders: false });
}

function combobox(): HTMLElement {
  return screen.getByRole('combobox');
}

function spinner(container: HTMLElement): Element | null {
  return container.querySelector('.animate-spin');
}

/** Waits until the debounce has fired the n-th trip lookup. */
async function tripLookup(n: number) {
  await waitFor(() => {
    expect(tripLookups).toHaveLength(n);
  });
  return tripLookups[n - 1] as (typeof tripLookups)[number];
}

async function placeLookup(n: number) {
  await waitFor(() => {
    expect(placeLookups).toHaveLength(n);
  });
  return placeLookups[n - 1] as (typeof placeLookups)[number];
}

async function settle(run: () => void): Promise<void> {
  await act(async () => {
    run();
    await Promise.resolve();
  });
}

/** Waits for the n-th trip lookup, then answers it. */
async function answerTrips(n: number, trips: Trip[]): Promise<void> {
  const lookup = await tripLookup(n);
  await settle(() => {
    lookup.answer.resolve(trips);
  });
}

/** Waits for the n-th place lookup, then answers it. */
async function answerPlaces(n: number, places: readonly GeocodingPlace[]): Promise<void> {
  const lookup = await placeLookup(n);
  await settle(() => {
    lookup.answer.resolve(places);
  });
}

/** Waits longer than the debounce, for a keystroke that must not search. */
async function pastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

beforeEach(() => {
  tripLookups.length = 0;
  placeLookups.length = 0;
  vi.mocked(getTripsByLocation).mockImplementation((query: string) => {
    const answer = deferred<Trip[]>();
    tripLookups.push({ query, answer });
    return answer.promise;
  });
  vi.mocked(searchPlaces).mockImplementation((query, options) => {
    const answer = deferred<readonly GeocodingPlace[]>();
    placeLookups.push({ query, options, answer });
    return answer.promise;
  });
  vi.mocked(getRoomsByTripId).mockResolvedValue([]);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.mocked(getTripsByLocation).mockReset();
  vi.mocked(searchPlaces).mockReset();
});

// ============================================================================
// Tests
// ============================================================================

describe('LocationAutocomplete lookups', () => {
  it('opens nothing and spins nothing before anything is searched', async () => {
    const { user, container } = await renderHarness();

    expect(spinner(container)).toBeNull();
    expect(combobox()).not.toHaveClass('pr-10');

    await user.type(combobox(), 'a');

    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    expect(spinner(container)).toBeNull();
    await pastDebounce();
    expect(tripLookups).toHaveLength(0);
  });

  it('looks up trips from two letters and places from three, on the trimmed text', async () => {
    const { user, container } = await renderHarness();

    await user.type(combobox(), '  Br  ');
    const lookup = await tripLookup(1);

    expect(lookup.query).toBe('Br');
    expect(searchPlaces).not.toHaveBeenCalled();
    // Only the trip lookup runs, and it alone keeps the spinner going.
    expect(spinner(container)).not.toBeNull();
    expect(combobox()).toHaveClass('pr-10');

    await settle(() => {
      lookup.answer.resolve([NANTES]);
    });

    expect(spinner(container)).toBeNull();
    expect(combobox()).toHaveAttribute('aria-expanded', 'true');
    expect(combobox()).toHaveFocus();
    expect(screen.getByText('Previously used location')).toBeInTheDocument();
    expect(screen.queryByText('Places on the map')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Nantes/ })).toBeInTheDocument();
  });

  it('keeps spinning while only the place lookup is out, then lists the places', async () => {
    const { user, container } = await renderHarness();

    await user.type(combobox(), 'Bre');
    await answerTrips(1, []);
    const lookup = await placeLookup(1);

    expect(lookup.query).toBe('Bre');
    expect(lookup.options).toEqual({ signal: expect.any(AbortSignal), limit: 5 });
    expect(spinner(container)).not.toBeNull();

    await settle(() => {
      lookup.answer.resolve([BREST, BRETAGNE]);
    });

    expect(spinner(container)).toBeNull();
    expect(screen.getByText('Places on the map')).toBeInTheDocument();
    expect(screen.queryByText('Previously used location')).not.toBeInTheDocument();
    const brest = screen.getByRole('option', { name: /^Brest/ });
    expect(within(brest).getByText('Finistère, France')).toHaveClass('text-xs', 'truncate');
    expect(within(brest).getByText('City')).toBeInTheDocument();
    // No secondary line for a place whose label is its whole name.
    const bretagne = screen.getByRole('option', { name: /^Bretagne/ });
    expect(bretagne.querySelectorAll('span.truncate')).toHaveLength(1);
  });

  it('ignores a trip answer that a newer keystroke overtook', async () => {
    const { user } = await renderHarness();

    await user.type(combobox(), 'Br');
    const first = await tripLookup(1);
    await user.type(combobox(), 'e');
    const second = await tripLookup(2);

    await settle(() => {
      second.answer.resolve([BREST_TRIP]);
    });
    await settle(() => {
      first.answer.resolve([NANTES]);
    });

    expect(screen.getByRole('option', { name: /Brest harbour/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Nantes/ })).not.toBeInTheDocument();
  });

  it('ignores a trip answer that a too-short query cancelled', async () => {
    const { user } = await renderHarness();

    await user.type(combobox(), 'Br');
    const first = await tripLookup(1);
    await user.type(combobox(), '{Backspace}');
    await pastDebounce();
    await user.type(combobox(), 'x');
    const second = await tripLookup(2);
    expect(second.query).toBe('Bx');

    await settle(() => {
      first.answer.resolve([NANTES]);
    });
    expect(screen.queryByRole('option', { name: /Nantes/ })).not.toBeInTheDocument();

    await settle(() => {
      second.answer.resolve([BREST_TRIP]);
    });
    expect(screen.getByRole('option', { name: /Brest harbour/ })).toBeInTheDocument();
  });

  it('keeps spinning when an overtaken trip lookup ends, and stops with the newest', async () => {
    const { user, container } = await renderHarness();

    await user.type(combobox(), 'Br');
    const first = await tripLookup(1);
    await user.type(combobox(), '{Backspace}x');
    const second = await tripLookup(2);

    await settle(() => {
      first.answer.resolve([NANTES]);
    });
    expect(spinner(container)).not.toBeNull();

    await settle(() => {
      second.answer.resolve([]);
    });
    expect(spinner(container)).toBeNull();
  });

  it('clears the trip suggestions when the newest trip lookup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = await renderHarness();

    await user.type(combobox(), 'Br');
    await answerTrips(1, [NANTES]);
    expect(screen.getByRole('option', { name: /Nantes/ })).toBeInTheDocument();

    await user.type(combobox(), '{Backspace}x');
    const failing = await tripLookup(2);
    const failure = new Error('IndexedDB closed');
    await settle(() => {
      failing.answer.reject(failure);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('Failed to search trips by location:', failure);
  });

  it('keeps the newer trip suggestions when an overtaken lookup fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = await renderHarness();

    await user.type(combobox(), 'Br');
    const first = await tripLookup(1);
    await user.type(combobox(), '{Backspace}x');
    const second = await tripLookup(2);
    await settle(() => {
      second.answer.resolve([BREST_TRIP]);
    });

    await settle(() => {
      first.answer.reject(new Error('late'));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('option', { name: /Brest harbour/ })).toBeInTheDocument();
  });

  it('clears everything once the text is too short again', async () => {
    const { user, container } = await renderHarness();

    await user.type(combobox(), 'Br');
    await answerTrips(1, [NANTES]);
    expect(screen.getByRole('option', { name: /Nantes/ })).toBeInTheDocument();

    await user.type(combobox(), '{Backspace}');
    await pastDebounce();

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    expect(spinner(container)).toBeNull();
  });

  it('stops spinning when the text gets too short mid-lookup', async () => {
    const { user, container } = await renderHarness();

    await user.type(combobox(), 'Bre');
    await placeLookup(1);
    expect(spinner(container)).not.toBeNull();

    await user.type(combobox(), '{Backspace}{Backspace}');
    await pastDebounce();

    expect(spinner(container)).toBeNull();
    expect(placeLookups[0]?.options?.signal?.aborted).toBe(true);
  });

  it('drops the places when the text is down to two letters', async () => {
    const { user } = await renderHarness();

    await user.type(combobox(), 'Bre');
    await answerTrips(1, []);
    await answerPlaces(1, [BREST]);
    expect(screen.getByText('Places on the map')).toBeInTheDocument();

    await user.type(combobox(), '{Backspace}');
    await tripLookup(2);
    await answerTrips(2, [NANTES]);

    expect(screen.queryByText('Places on the map')).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('waits for the typing to stop before it looks anything up', async () => {
    const { user } = await renderHarness();

    await user.type(combobox(), 'Bres');
    await tripLookup(1);
    await pastDebounce();

    expect(tripLookups.map((lookup) => lookup.query)).toEqual(['Bres']);
  });

  it('looks nothing up after it is gone, and aborts what was in flight', async () => {
    const { user, unmount } = await renderHarness();

    await user.type(combobox(), 'Bre');
    const lookup = await placeLookup(1);
    unmount();

    expect(lookup.options?.signal?.aborted).toBe(true);
  });

  it('runs no search once it is gone mid-debounce', async () => {
    const { user, unmount } = await renderHarness();

    await user.type(combobox(), 'Bre');
    unmount();
    await pastDebounce();

    expect(tripLookups).toHaveLength(0);
  });
});

describe('LocationAutocomplete place lookup failures', () => {
  it('clears the places when the newest place lookup fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user, container } = await renderHarness();

    await user.type(combobox(), 'Bre');
    await answerTrips(1, [NANTES]);
    await answerPlaces(1, [BREST]);
    expect(screen.getByRole('option', { name: /^Brest/ })).toBeInTheDocument();

    await user.type(combobox(), 's');
    const failing = await placeLookup(2);
    const failure = new GeocodingError('network');
    await settle(() => {
      failing.answer.reject(failure);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole('option', { name: /^Brest/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Places on the map')).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('Failed to search places:', failure);
    expect(spinner(container)).not.toBeNull();
  });

  it('clears the places on a failure that is not a geocoding error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = await renderHarness();

    await user.type(combobox(), 'Bre');
    await answerTrips(1, [NANTES]);
    await answerPlaces(1, [BREST]);

    await user.type(combobox(), 's');
    const failing = await placeLookup(2);
    await settle(() => {
      failing.answer.reject(new TypeError('Failed to fetch'));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole('option', { name: /^Brest/ })).not.toBeInTheDocument();
  });

  it('says nothing about an aborted lookup and keeps the newer places', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = await renderHarness();

    await user.type(combobox(), 'Bre');
    const first = await placeLookup(1);
    await user.type(combobox(), 's');
    const second = await placeLookup(2);
    expect(first.options?.signal?.aborted).toBe(true);

    await settle(() => {
      second.answer.resolve([BREST]);
    });
    await settle(() => {
      first.answer.reject(new GeocodingError('aborted'));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('option', { name: /^Brest/ })).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalledWith('Failed to search places:', expect.anything());
  });

  it('keeps spinning when an aborted place lookup ends, and stops with the newest', async () => {
    const { user, container } = await renderHarness();

    await user.type(combobox(), 'Bre');
    const first = await placeLookup(1);
    await user.type(combobox(), 's');
    const second = await placeLookup(2);
    await settle(() => {
      tripLookups.forEach((lookup) => {
        lookup.answer.resolve([]);
      });
    });

    await settle(() => {
      first.answer.reject(new GeocodingError('aborted'));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(spinner(container)).not.toBeNull();

    await settle(() => {
      second.answer.resolve([]);
    });
    expect(spinner(container)).toBeNull();
  });
});

describe('LocationAutocomplete picks', () => {
  it('hides the trip being edited, also when told after the first render', async () => {
    const { user, rerender } = await renderHarness();
    rerender(<Harness excludeTripId={'nantes' as TripId} />);

    await user.type(combobox(), 'Br');
    await answerTrips(1, [NANTES, BREST_TRIP]);

    expect(screen.queryByRole('option', { name: /Nantes/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Brest harbour/ })).toBeInTheDocument();
  });

  it('reports typing to the latest change handler', async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { user, rerender } = await renderHarness({ onLocationChange: first });
    rerender(<Harness onLocationChange={latest} />);

    await user.type(combobox(), 'B');

    expect(latest).toHaveBeenCalledWith('B', undefined);
    expect(first).not.toHaveBeenCalled();
  });

  it('imports a picked trip with its rooms, closes, and stays closed', async () => {
    const rooms = [{ id: 'r1', name: 'Attic' }] as unknown as Room[];
    vi.mocked(getRoomsByTripId).mockResolvedValue(rooms);
    const first = vi.fn();
    const onImportTrip = vi.fn();
    const { user, rerender } = await renderHarness({ onImportTrip: first });
    rerender(<Harness onImportTrip={onImportTrip} />);

    await user.type(combobox(), 'Bre');
    await answerTrips(1, [BREST_TRIP]);
    await user.click(screen.getByRole('option', { name: /Brest harbour/ }));

    await waitFor(() => {
      expect(onImportTrip).toHaveBeenCalledWith({ trip: BREST_TRIP, rooms });
    });
    expect(first).not.toHaveBeenCalled();
    expect(combobox()).toHaveFocus();
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');

    // The place lookup lands after the pick: it must not reopen the list.
    await answerPlaces(1, [BREST]);
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts the next keystroke after a trip pick from an empty list', async () => {
    const { user } = await renderHarness();

    await user.type(combobox(), 'Bre');
    await answerTrips(1, [BREST_TRIP]);
    await answerPlaces(1, []);
    await user.click(screen.getByRole('option', { name: /Brest harbour/ }));
    await waitFor(() => {
      expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    });

    await user.type(combobox(), 'x');
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
  });

  it('says why when the rooms of a picked trip could not be read', async () => {
    const failure = new Error('rooms gone');
    vi.mocked(getRoomsByTripId).mockRejectedValue(failure);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onImportTrip = vi.fn();
    const { user } = await renderHarness({ onImportTrip });

    await user.type(combobox(), 'Br');
    await answerTrips(1, [BREST_TRIP]);
    await user.click(screen.getByRole('option', { name: /Brest harbour/ }));

    await waitFor(() => {
      expect(onImportTrip).toHaveBeenCalledWith({ trip: BREST_TRIP, rooms: [] });
    });
    expect(consoleError).toHaveBeenCalledWith('Failed to load rooms for import:', failure);
  });

  it('saves a picked place, closes, and stays closed', async () => {
    const first = vi.fn();
    const onLocationChange = vi.fn();
    const { user, rerender } = await renderHarness({ onLocationChange: first });

    await user.type(combobox(), 'Bre');
    await answerPlaces(1, [BREST]);
    rerender(<Harness onLocationChange={onLocationChange} />);
    await user.click(screen.getByRole('option', { name: /^Brest/ }));

    expect(onLocationChange).toHaveBeenLastCalledWith('Brest', BREST.coordinates);
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');

    await answerTrips(1, [BREST_TRIP]);
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts the next keystroke after a place pick from an empty list', async () => {
    const { user } = await renderHarness();

    await user.type(combobox(), 'Bre');
    await answerTrips(1, []);
    await answerPlaces(1, [BREST]);
    await user.click(screen.getByRole('option', { name: /^Brest/ }));

    await user.type(combobox(), 'x');
    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
  });

  it('moves and removes the pin of the place now in the box', async () => {
    const onLocationChange = vi.fn();
    const { user } = await renderHarness({ onLocationChange });

    await user.type(combobox(), 'Bre');
    await answerPlaces(1, [BREST]);
    await user.click(screen.getByRole('option', { name: /^Brest/ }));

    await user.click(screen.getByRole('button', { name: 'drag the pin' }));
    expect(onLocationChange).toHaveBeenLastCalledWith('Brest', MOVED_TO);

    await user.click(screen.getByRole('button', { name: 'remove the pin' }));
    expect(onLocationChange).toHaveBeenLastCalledWith('Brest', undefined);
  });

  it('closes on Escape', async () => {
    const { user } = await renderHarness();

    await user.type(combobox(), 'Br');
    await answerTrips(1, [NANTES]);
    expect(combobox()).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');

    expect(combobox()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('LocationAutocomplete keyboard', () => {
  async function openWithTwoPlaces() {
    const result = await renderHarness({ onLocationChange: vi.fn() });
    await result.user.type(combobox(), 'Bre');
    await answerTrips(1, []);
    await answerPlaces(1, [BREST, BRETAGNE]);
    return result;
  }

  it('leaves the keys alone while the list is closed', async () => {
    await renderHarness();

    expect(fireEvent.keyDown(combobox(), { key: 'ArrowDown' })).toBe(true);
    expect(fireEvent.keyDown(combobox(), { key: 'Enter' })).toBe(true);
  });

  it('moves the highlight with the arrows, one option at a time', async () => {
    await openWithTwoPlaces();
    const [brest, bretagne] = screen.getAllByRole('option');
    expect(brest).toHaveAttribute('aria-selected', 'true');
    expect(bretagne).toHaveAttribute('aria-selected', 'false');

    expect(fireEvent.keyDown(combobox(), { key: 'ArrowDown', code: 'ArrowDown' })).toBe(false);

    expect(brest).toHaveAttribute('aria-selected', 'false');
    expect(bretagne).toHaveAttribute('aria-selected', 'true');
  });

  it('picks the highlighted option on Enter, and lets other keys through', async () => {
    const onLocationChange = vi.fn();
    const { user } = await renderHarness({ onLocationChange });
    await user.type(combobox(), 'Bre');
    await answerPlaces(1, [BREST, BRETAGNE]);

    expect(fireEvent.keyDown(combobox(), { key: 'a' })).toBe(true);
    fireEvent.keyDown(combobox(), { key: 'ArrowDown', code: 'ArrowDown' });
    expect(fireEvent.keyDown(combobox(), { key: 'Enter', code: 'Enter' })).toBe(false);

    expect(onLocationChange).toHaveBeenLastCalledWith('Bretagne', BRETAGNE.coordinates);
  });
});

describe('ImportBadge in English', () => {
  it('names the trip and counts its rooms', async () => {
    const { container } = await renderWithRealI18n(
      <ImportBadge tripName="Summer" roomCount={3} onRemove={vi.fn()} />,
      { withProviders: false },
    );

    expect(container.firstElementChild).toHaveTextContent('Importing from Summer (3 rooms)');
    expect(container.firstElementChild).toHaveClass('rounded-md', 'bg-primary/5');
    expect(container.firstElementChild).not.toHaveClass('opacity-50');
    expect(screen.getByRole('button', { name: 'Remove import' })).toBeEnabled();
  });

  it('leaves the count out when no room comes along, and dims when disabled', async () => {
    const { container } = await renderWithRealI18n(
      <ImportBadge tripName="Summer" roomCount={0} onRemove={vi.fn()} disabled />,
      { withProviders: false },
    );

    expect(container.firstElementChild).toHaveTextContent(/^Importing from Summer$/);
    expect(container.firstElementChild).toHaveClass('opacity-50');
  });
});
