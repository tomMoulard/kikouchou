/**
 * @fileoverview Reusable map marker component for Leaflet maps.
 * Creates custom styled markers with popup support.
 *
 * @module components/shared/MapMarker
 */

import { memo, useCallback, useEffect, useMemo } from 'react';
import { Marker, Popup } from 'react-leaflet';
import { divIcon, type LatLngExpression } from 'leaflet';

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
 * Default colors for each marker type.
 */
const MARKER_TYPE_COLORS: Record<MapMarkerType, string> = {
  trip: '#3b82f6', // Blue
  transport: '#22c55e', // Green
  pickup: '#f97316', // Orange
  default: '#6b7280', // Gray
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
 * Validates and sanitizes a color value.
 * Only allows valid hex colors to prevent XSS injection.
 */
function sanitizeColor(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  return HEX_COLOR_REGEX.test(color) ? color : fallback;
}

/**
 * Creates a Leaflet DivIcon with custom styling.
 */
function createMarkerIcon(
  type: MapMarkerType = 'default',
  color?: string
): ReturnType<typeof divIcon> {
  const typeColor = MARKER_TYPE_COLORS[type];
  const bgColor = sanitizeColor(color, typeColor);
  const svgIcon = MARKER_TYPE_ICONS[type];

  const html = `
    <div class="map-marker-container" style="
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background-color: ${bgColor};
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      cursor: pointer;
      transition: transform 0.1s ease;
    " tabindex="0" role="button">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
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
}: MapMarkerProps) {
  const { id, position, label, type = 'default', color, popupContent } = marker;
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

MapMarker.displayName = 'MapMarker';
