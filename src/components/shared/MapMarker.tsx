/**
 * @fileoverview Reusable map marker component for Leaflet maps.
 * Creates custom styled markers with popup support.
 *
 * @module components/shared/MapMarker
 */

import { memo, useCallback, useEffect, useMemo } from 'react';
import { Marker, Popup, Tooltip } from 'react-leaflet';
import { divIcon, type LatLngExpression } from 'leaflet';

import { statusVariants } from '@/components/ui/status.variants';

// ============================================================================
// Types
// ============================================================================

/**
 * Marker type determines the icon style.
 */
export type MapMarkerType = 'trip' | 'transport' | 'pickup' | 'default';

/**
 * Data structure for a map marker.
 */
export interface MapMarkerData {
  /** Unique identifier for the marker */
  readonly id: string;
  /** Position as [latitude, longitude] tuple */
  readonly position: readonly [number, number];
  /** Display label for the marker */
  readonly label: string;
  /** Marker type for styling */
  readonly type?: MapMarkerType;
  /** Custom color (hex) for person-colored markers */
  readonly color?: string;
  /** Optional popup content */
  readonly popupContent?: React.ReactNode;
  /** Optional hover tooltip content (short info) */
  readonly tooltipContent?: React.ReactNode;
}

/**
 * Props for the MapMarker component.
 */
export interface MapMarkerProps {
  /** Marker data */
  readonly marker: MapMarkerData;
  /** Callback when marker is clicked */
  readonly onClick?: (marker: MapMarkerData) => void;
  /** Keyboard event handler for accessibility */
  readonly onKeyDown?: (
    e: React.KeyboardEvent,
    marker: MapMarkerData
  ) => void;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default fill and glyph colour for each marker type, as utility classes.
 *
 * These used to be four hex literals injected into the `divIcon` HTML as an
 * inline `background-color`. An inline style is the one thing a stylesheet
 * cannot reach, so the markers were the only surface in the app that could not
 * respond to `.dark` at all — and `transport`'s `#22c55e` agreed with the
 * transport map's legend swatch only because Tailwind's `green-500` happens to
 * be that hex. Once the legend moved to `statusVariants`, the two were one
 * token edit away from silently disagreeing.
 *
 * So the two types the legend labels take their classes *from that same
 * `statusVariants` call*, rather than restating the tokens here. They cannot
 * drift: both sides resolve `--success` / `--departure`, and both follow the
 * theme without any JS re-reading a computed value, because a class is live in
 * the DOM where an inline style is frozen at icon-creation time.
 *
 * `trip` and `default` appear on maps that carry no legend (the trip location
 * maps), so they name theme tokens directly — `--primary` for a trip pin, and
 * `--muted-foreground` for the neutral one, which is the token nearest the
 * `#6b7280` it replaces.
 */
const MARKER_TYPE_CLASSES: Record<MapMarkerType, string> = {
  trip: 'bg-primary text-primary-foreground',
  transport: statusVariants({ tone: 'arrival', emphasis: 'solid' }),
  pickup: statusVariants({ tone: 'departure', emphasis: 'solid' }),
  default: 'bg-muted-foreground text-background',
};

/**
 * SVG icons for each marker type.
 */
const MARKER_TYPE_ICONS: Record<MapMarkerType, string> = {
  trip: '<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>',
  transport: '<path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>',
  pickup: '<path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>',
  default: '<path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>',
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Regex for validating hex colors (prevents XSS via color prop).
 * Accepts: #RGB, #RRGGBB, #RRGGBBAA formats
 */
const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Validates a caller-supplied colour.
 * Only a valid hex colour survives, which is what keeps an attacker-controlled
 * string out of the `divIcon` HTML below. Anything else returns `undefined`,
 * and the marker falls back to its type's theme classes.
 */
function sanitizeColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  return HEX_COLOR_REGEX.test(color) ? color : undefined;
}

/**
 * Shape, ring and shadow shared by every marker, whatever colours it wears.
 *
 * `border-background` rather than the literal white it replaces: a white ring
 * around a pin is invisible against the CartoDB dark tiles the map switches to
 * in dark mode.
 */
const MARKER_BASE_CLASSES =
  'map-marker-container flex size-8 cursor-pointer items-center justify-center ' +
  'rounded-full border-2 border-background shadow-md transition-colors';

/**
 * Narrows a marker type to one this module knows, at *runtime*.
 *
 * TypeScript already says `type` is a `MapMarkerType`, so this looks redundant
 * — and it would be, if the value did not end up inside an HTML string. A
 * `MapMarkerData` is routinely assembled from a persisted row, and a row is
 * only as trustworthy as whatever wrote it; a synced or imported trip is not
 * this module's own data. An unknown value would otherwise interpolate straight
 * into the `data-marker-type` attribute, and index the class and icon tables to
 * `undefined` besides, giving an unpainted pin with no glyph.
 *
 * The same reasoning as `sanitizeColor` above, applied to the other value that
 * reaches the markup.
 */
function resolveMarkerType(type: MapMarkerType): MapMarkerType {
  return Object.hasOwn(MARKER_TYPE_CLASSES, type) ? type : 'default';
}

/**
 * Creates a Leaflet DivIcon with custom styling.
 *
 * `divIcon` takes an HTML *string*, so this is the one place in the app that
 * writes markup by hand rather than as JSX. Everything that can be a class is
 * one; the single inline style is a person's colour, which lives in the
 * database rather than in the theme and so cannot be a utility class
 * (AGENTS.md, "the inline-style carve-out", exception 1).
 */
function createMarkerIcon(
  requestedType: MapMarkerType = 'default',
  color?: string
): ReturnType<typeof divIcon> {
  const type = resolveMarkerType(requestedType);
  const customColor = sanitizeColor(color);
  const svgIcon = MARKER_TYPE_ICONS[type];

  // A person's colour is an arbitrary hex from the database, so the glyph over
  // it must not follow the theme either — `--foreground` would turn white on a
  // pale pin in light mode. This is the "text laid over a user-chosen colour"
  // case AGENTS.md carves out for `text-white`.
  // eslint-disable-next-line kikouchou/no-raw-palette-class -- The glyph sits on an arbitrary user hex, so the literal colour is the requirement: no theme token can know whether it would be readable on that background.
  const colorClasses = customColor ? 'text-white' : MARKER_TYPE_CLASSES[type];
  const colorStyle = customColor
    ? ` style="background-color:${customColor}"`
    : '';

  const html = `
    <div class="${MARKER_BASE_CLASSES} ${colorClasses}"${colorStyle} data-marker-type="${type}" tabindex="0" role="button">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        ${svgIcon}
      </svg>
    </div>
  `;

  return divIcon({
    html,
    className: 'map-marker-icon',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });
}

/**
 * Validates latitude value.
 */
function isValidLatitude(lat: number): boolean {
  return typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90;
}

/**
 * Validates longitude value.
 */
function isValidLongitude(lon: number): boolean {
  return typeof lon === 'number' && !isNaN(lon) && lon >= -180 && lon <= 180;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A reusable map marker component with custom styling and popup support.
 *
 * @example
 * ```tsx
 * <MapMarker
 *   marker={{
 *     id: '1',
 *     position: [48.8566, 2.3522],
 *     label: 'Paris',
 *     type: 'trip',
 *   }}
 *   onClick={(m) => console.log('Clicked:', m.label)}
 * />
 * ```
 *
 * @example
 * ```tsx
 * // With custom popup content
 * <MapMarker
 *   marker={{
 *     id: '2',
 *     position: [51.5074, -0.1278],
 *     label: 'London',
 *     type: 'transport',
 *     popupContent: (
 *       <div>
 *         <h3>London Station</h3>
 *         <p>Arrival: 14:30</p>
 *       </div>
 *     ),
 *   }}
 * />
 * ```
 */
export const MapMarker = memo(function MapMarker({
  marker,
  onClick,
  onKeyDown,
}: MapMarkerProps): React.ReactElement | null {
  const { id, position, label, type = 'default', color, popupContent, tooltipContent } = marker;
  const [lat, lon] = position;

  // Memoize icon creation to prevent unnecessary recreations
  const icon = useMemo(
    () => createMarkerIcon(type, color),
    [type, color]
  );

  // Memoize validation result (pure computation, no side effects)
  const isValidPosition = useMemo(
    () => isValidLatitude(lat) && isValidLongitude(lon),
    [lat, lon]
  );

  // Log warning for invalid positions in development (side effect in useEffect)
  useEffect(() => {
    if (!isValidPosition && import.meta.env.DEV) {
      console.warn(
        `MapMarker: Invalid coordinates for marker "${id}": [${lat}, ${lon}]`
      );
    }
  }, [isValidPosition, id, lat, lon]);

  const handleClick = useCallback(() => {
    onClick?.(marker);
  }, [onClick, marker]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.(marker);
      }
      onKeyDown?.(e, marker);
    },
    [onClick, onKeyDown, marker]
  );

  // Early return after all hooks are called
  if (!isValidPosition) {
    return null;
  }

  const leafletPosition: LatLngExpression = [lat, lon];

  return (
    <Marker
      position={leafletPosition}
      icon={icon}
      eventHandlers={{
        click: handleClick,
        keydown: handleKeyDown as unknown as () => void,
      }}
      aria-label={label}
      title={label}
    >
      {tooltipContent && (
        <Tooltip direction="top" offset={[0, -16]} opacity={1}>
          <div className="text-xs">
            {tooltipContent}
          </div>
        </Tooltip>
      )}
      {popupContent && (
        <Popup>
          <div
            className="map-marker-popup"
            role="dialog"
            aria-label={`Details for ${label}`}
          >
            {popupContent}
          </div>
        </Popup>
      )}
    </Marker>
  );
});
