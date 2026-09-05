/**
 * @fileoverview Place search against the OpenStreetMap Nominatim API.
 *
 * Every location field in the app (trip, transport, activity) resolves a typed
 * place name to the same coordinates through this module, so a "Beach House,
 * Brittany" pinned on a trip and one pinned on a transport land on the same
 * spot.
 *
 * Nominatim is remote, untrusted input: results whose latitude/longitude are
 * missing, non-numeric or out of range are dropped rather than handed to
 * Leaflet, which would otherwise render a marker at NaN and blank the map.
 *
 * @module lib/geocoding
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * GPS coordinates for a place.
 */
export interface Coordinates {
  readonly lat: number;
  readonly lon: number;
}

/**
 * A place returned by the geocoder, already validated and formatted.
 */
export interface GeocodingPlace {
  /** Stable key for list rendering (Nominatim `place_id`). */
  readonly id: string;
  /** Short human-readable label — the first few address parts. */
  readonly label: string;
  /** Full Nominatim display name, shown as the secondary line. */
  readonly fullName: string;
  /** Short type label ("City", "Station", …). */
  readonly typeLabel: string;
  /** Validated coordinates. */
  readonly coordinates: Coordinates;
}

/**
 * Why a search failed.
 *
 * - `aborted` — the caller's signal fired (superseded query, unmount). The
 *   caller started this, so it should stay silent.
 * - `timeout` — Nominatim did not answer in time.
 * - `network` — transport error or a non-2xx response.
 */
export type GeocodingErrorKind = 'aborted' | 'timeout' | 'network';

/**
 * Error thrown by {@link searchPlaces}, carrying the reason so callers can
 * tell an abort they caused from a failure worth showing the user.
 */
export class GeocodingError extends Error {
  readonly kind: GeocodingErrorKind;

  constructor(kind: GeocodingErrorKind, message?: string, options?: ErrorOptions) {
    super(message ?? `Geocoding request failed: ${kind}`, options);
    this.name = 'GeocodingError';
    this.kind = kind;
  }
}

/**
 * Raw result shape from the Nominatim search endpoint.
 */
interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
  class: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country?: string;
  };
}

// ============================================================================
// Constants
// ============================================================================

/** Debounce applied to keystrokes before a search is issued. */
export const GEOCODING_DEBOUNCE_MS = 300;

/** Shortest query worth sending to Nominatim. */
export const GEOCODING_MIN_QUERY_LENGTH = 3;

/** Default number of suggestions requested. */
export const GEOCODING_MAX_RESULTS = 5;

/** Give up on a request that has not answered within this window. */
const REQUEST_TIMEOUT_MS = 10_000;

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org/search';

/** How many comma-separated parts of a display name make the short label. */
const LABEL_PART_COUNT = 3;

/**
 * Human-readable names for the Nominatim `type` values we care about.
 */
const TYPE_LABELS: Record<string, string> = {
  city: 'City',
  town: 'Town',
  village: 'Village',
  house: 'Address',
  building: 'Building',
  railway: 'Station',
  aerodrome: 'Airport',
  bus_station: 'Bus Station',
};

// ============================================================================
// Coordinate Helpers
// ============================================================================

/**
 * Type guard for a usable coordinate pair.
 *
 * Accepts the structural `{ lat, lon }` shape stored on trips, transports and
 * activities, so callers can filter records before handing them to a map.
 *
 * @param value - Candidate coordinates, possibly undefined
 * @returns True when both components are finite and in range
 *
 * @example
 * ```typescript
 * const pinned = trips.filter((trip) => hasValidCoordinates(trip.coordinates));
 * ```
 */
export function hasValidCoordinates(
  value: { readonly lat?: unknown; readonly lon?: unknown } | undefined,
): value is Coordinates {
  if (!value) {
    return false;
  }
  const { lat, lon } = value;
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lon === 'number' &&
    Number.isFinite(lon) &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Formats coordinates for display next to a place name.
 *
 * @param coordinates - Coordinates to format
 * @returns A `lat, lon` string with six decimals (~11 cm precision)
 */
export function formatCoordinates(coordinates: Coordinates): string {
  return `${coordinates.lat.toFixed(6)}, ${coordinates.lon.toFixed(6)}`;
}

// ============================================================================
// Result Parsing
// ============================================================================

/**
 * Shortens a Nominatim display name to its leading address parts.
 */
function formatPlaceLabel(displayName: string): string {
  return displayName.split(', ').slice(0, LABEL_PART_COUNT).join(', ');
}

/**
 * Maps a Nominatim result to a short type label.
 */
function formatTypeLabel(result: NominatimResult): string {
  return TYPE_LABELS[result.type] ?? result.class ?? 'Place';
}

/**
 * Converts one raw result to a validated place, or null when the coordinates
 * are unusable.
 */
function toPlace(result: NominatimResult): GeocodingPlace | null {
  const coordinates = {
    lat: Number.parseFloat(result.lat),
    lon: Number.parseFloat(result.lon),
  };

  if (!hasValidCoordinates(coordinates)) {
    return null;
  }

  const displayName = typeof result.display_name === 'string' ? result.display_name : '';
  if (!displayName) {
    return null;
  }

  return {
    id: String(result.place_id),
    label: formatPlaceLabel(displayName),
    fullName: displayName,
    typeLabel: formatTypeLabel(result),
    coordinates,
  };
}

// ============================================================================
// Search
// ============================================================================

/**
 * Detects the abort shape thrown by `fetch` in both browsers and jsdom.
 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Searches Nominatim for places matching a free-text query.
 *
 * Queries shorter than {@link GEOCODING_MIN_QUERY_LENGTH} resolve to an empty
 * array without hitting the network. The request carries its own timeout on
 * top of the caller's signal.
 *
 * @param query - Free-text place query
 * @param options - Optional caller abort signal and result limit
 * @returns Validated places, at most `limit` of them
 * @throws {GeocodingError} With `kind` describing why the search failed
 *
 * @example
 * ```typescript
 * const controller = new AbortController();
 * try {
 *   const places = await searchPlaces('Brest', { signal: controller.signal });
 * } catch (error) {
 *   if (error instanceof GeocodingError && error.kind !== 'aborted') {
 *     // surface it
 *   }
 * }
 * ```
 */
export async function searchPlaces(
  query: string,
  options: { readonly signal?: AbortSignal; readonly limit?: number } = {},
): Promise<readonly GeocodingPlace[]> {
  const { signal, limit = GEOCODING_MAX_RESULTS } = options;

  if (query.trim().length < GEOCODING_MIN_QUERY_LENGTH) {
    return [];
  }

  // The request aborts on either the caller's signal or our own timeout; the
  // caller's takes priority when reporting, so an abort it triggered never
  // shows up as a timeout error.
  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort();
  signal?.addEventListener('abort', abortFromCaller);
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const params = new URLSearchParams({
      format: 'json',
      q: query,
      limit: String(limit),
      addressdetails: '1',
    });

    const response = await fetch(`${NOMINATIM_BASE_URL}?${params}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        // Nominatim's usage policy asks for an identifying User-Agent.
        'User-Agent': 'Kikouchou/1.0 (https://github.com/tomMoulard/kikouchou)',
      },
    });

    if (!response.ok) {
      throw new GeocodingError('network', `Search failed: ${response.status}`);
    }

    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }

    // Drop individually invalid entries rather than failing the whole search.
    return data
      .slice(0, limit)
      .map((item) => toPlace(item as NominatimResult))
      .filter((place): place is GeocodingPlace => place !== null);
  } catch (error) {
    if (error instanceof GeocodingError) {
      throw error;
    }
    if (isAbortError(error)) {
      throw new GeocodingError(signal?.aborted ? 'aborted' : 'timeout');
    }
    throw new GeocodingError('network', 'Search failed', { cause: error });
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
