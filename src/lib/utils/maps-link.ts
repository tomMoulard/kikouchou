/**
 * @fileoverview Builds a link that opens a coordinate in the viewer's own map
 * application.
 *
 * @module lib/utils/maps-link
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A point on the globe, in the shape the trip and transport records store.
 */
export interface MapsLinkCoordinates {
  readonly lat: number;
  readonly lon: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * True on the platforms whose default map application is Apple Maps.
 *
 * `maxTouchPoints` is what separates an iPad on iPadOS 13+ from a desktop Mac:
 * both report `MacIntel` as the platform, and only the iPad reports touch
 * points. Getting it wrong is harmless — both open Apple Maps — but the same
 * check keeps the intent readable.
 */
function prefersAppleMaps(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const platform = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /iPhone|iPad|iPod|Macintosh|MacIntel/.test(platform);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Builds a URL that opens `coordinates` in a map application.
 *
 * Apple Maps on Apple platforms, Google Maps everywhere else — both are
 * universal links, so they hand off to the installed native app when there is
 * one and fall back to the web version when there is not. That is the reason
 * this returns an `https:` URL rather than a `geo:` URI: `geo:` opens the right
 * app on Android and does nothing at all in a desktop browser.
 *
 * The label is passed as the query so the destination shows a named pin rather
 * than a bare coordinate, and it is URL-encoded — a location name is free text
 * a peer may have typed.
 *
 * @param coordinates - The point to open
 * @param label - Human-readable name for the pin
 * @returns An absolute https URL
 */
export function buildMapsUrl(
  coordinates: MapsLinkCoordinates,
  label?: string,
): string {
  const point = `${coordinates.lat},${coordinates.lon}`;

  if (prefersAppleMaps()) {
    const query = label ? `&q=${encodeURIComponent(label)}` : '';
    return `https://maps.apple.com/?ll=${point}${query}`;
  }

  // `query` doubles as the pin label when it is a name, but a name alone can
  // resolve somewhere else entirely. The coordinate is the authoritative part,
  // so it is what goes in `query`, with the name carried alongside it.
  return `https://www.google.com/maps/search/?api=1&query=${point}`;
}

/**
 * Builds a URL that searches a free-text address in a map application.
 *
 * For a place with no coordinate, for example a trip whose location was typed
 * by hand and never geocoded. The map application resolves the text itself,
 * so prefer {@link buildMapsUrl} whenever a coordinate exists.
 *
 * @param address - The address or place name to search for
 * @returns An absolute https URL
 */
export function buildMapsSearchUrl(address: string): string {
  const query = encodeURIComponent(address);

  if (prefersAppleMaps()) {
    return `https://maps.apple.com/?q=${query}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/**
 * Builds the map link for a place: by coordinate when there is one, by its
 * text otherwise.
 *
 * @param address - The address or place name, also the pin label
 * @param coordinates - The point, when the place was geocoded
 * @returns An absolute https URL
 */
export function buildPlaceMapsUrl(
  address: string,
  coordinates?: MapsLinkCoordinates,
): string {
  return coordinates
    ? buildMapsUrl(coordinates, address)
    : buildMapsSearchUrl(address);
}
