/**
 * Unit tests for the Nominatim geocoding client.
 *
 * @module lib/__tests__/geocoding.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GEOCODING_MIN_QUERY_LENGTH,
  GeocodingError,
  formatCoordinates,
  hasValidCoordinates,
  searchPlaces,
} from '@/lib/geocoding';

// ============================================================================
// Fixtures
// ============================================================================

const parisResult = {
  place_id: 1,
  display_name: 'Paris, Île-de-France, Metropolitan France, France',
  lat: '48.8566',
  lon: '2.3522',
  type: 'city',
  class: 'place',
};

const stationResult = {
  place_id: 2,
  display_name: 'Gare de Paris-Montparnasse, Paris, France',
  lat: '48.8414',
  lon: '2.3209',
  type: 'railway',
  class: 'railway',
};

/**
 * Builds a fetch mock resolving to the given Nominatim payload.
 */
function mockFetchResolving(payload: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(payload),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================================
// hasValidCoordinates
// ============================================================================

describe('hasValidCoordinates', () => {
  it('accepts an in-range pair', () => {
    expect(hasValidCoordinates({ lat: 48.8566, lon: 2.3522 })).toBe(true);
  });

  it('accepts the extremes of both ranges', () => {
    expect(hasValidCoordinates({ lat: -90, lon: -180 })).toBe(true);
    expect(hasValidCoordinates({ lat: 90, lon: 180 })).toBe(true);
  });

  it('rejects undefined', () => {
    expect(hasValidCoordinates(undefined)).toBe(false);
  });

  it('rejects NaN, which would blank a Leaflet map rather than fail loudly', () => {
    expect(hasValidCoordinates({ lat: Number.NaN, lon: 2.35 })).toBe(false);
    expect(hasValidCoordinates({ lat: 48.85, lon: Number.NaN })).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(hasValidCoordinates({ lat: 91, lon: 2.35 })).toBe(false);
    expect(hasValidCoordinates({ lat: 48.85, lon: -181 })).toBe(false);
  });

  it('rejects non-numeric components', () => {
    expect(hasValidCoordinates({ lat: '48.85', lon: 2.35 })).toBe(false);
  });
});

// ============================================================================
// formatCoordinates
// ============================================================================

describe('formatCoordinates', () => {
  it('prints six decimals for both components', () => {
    expect(formatCoordinates({ lat: 48.8566, lon: 2.3522 })).toBe('48.856600, 2.352200');
  });

  it('keeps negative values signed', () => {
    expect(formatCoordinates({ lat: -33.8688, lon: -151.2093 })).toBe(
      '-33.868800, -151.209300',
    );
  });
});

// ============================================================================
// searchPlaces
// ============================================================================

describe('searchPlaces', () => {
  it('does not hit the network for a query below the minimum length', async () => {
    const fetchMock = mockFetchResolving([]);

    const places = await searchPlaces('Pa');

    expect(places).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect('Pa'.length).toBeLessThan(GEOCODING_MIN_QUERY_LENGTH);
  });

  it('maps results to validated places', async () => {
    mockFetchResolving([parisResult, stationResult]);

    const places = await searchPlaces('Paris');

    expect(places).toHaveLength(2);
    expect(places[0]).toEqual({
      id: '1',
      label: 'Paris, Île-de-France, Metropolitan France',
      fullName: 'Paris, Île-de-France, Metropolitan France, France',
      typeLabel: 'City',
      coordinates: { lat: 48.8566, lon: 2.3522 },
    });
    expect(places[1]?.typeLabel).toBe('Station');
  });

  it('falls back to the Nominatim class for an unmapped type', async () => {
    mockFetchResolving([{ ...parisResult, type: 'peak', class: 'natural' }]);

    const places = await searchPlaces('Paris');

    expect(places[0]?.typeLabel).toBe('natural');
  });

  it('sends the query, limit and format as search params', async () => {
    const fetchMock = mockFetchResolving([]);

    await searchPlaces('Brest', { limit: 3 });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('q=Brest');
    expect(url).toContain('limit=3');
    expect(url).toContain('format=json');
  });

  it('drops individual results whose coordinates are unusable', async () => {
    mockFetchResolving([
      { ...parisResult, lat: 'not-a-number' },
      { ...stationResult, lon: '999' },
      { ...parisResult, place_id: 3 },
    ]);

    const places = await searchPlaces('Paris');

    expect(places).toHaveLength(1);
    expect(places[0]?.id).toBe('3');
  });

  it('honours the limit even when the server over-delivers', async () => {
    mockFetchResolving([parisResult, stationResult, { ...parisResult, place_id: 3 }]);

    const places = await searchPlaces('Paris', { limit: 2 });

    expect(places).toHaveLength(2);
  });

  it('returns an empty list when the payload is not an array', async () => {
    mockFetchResolving({ error: 'Unable to geocode' });

    await expect(searchPlaces('Paris')).resolves.toEqual([]);
  });

  it('reports a non-2xx response as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(searchPlaces('Paris')).rejects.toMatchObject({
      name: 'GeocodingError',
      kind: 'network',
    });
  });

  it('reports a transport failure as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(searchPlaces('Paris')).rejects.toMatchObject({ kind: 'network' });
  });

  it('reports the caller aborting as "aborted", not as a timeout', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
      ),
    );

    const pending = searchPlaces('Paris', { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    await expect(pending).rejects.toBeInstanceOf(GeocodingError);
  });
});
