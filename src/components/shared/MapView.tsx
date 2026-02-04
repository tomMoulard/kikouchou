/**
 * @fileoverview Reusable map view component using Leaflet and OpenStreetMap.
 * Provides an interactive map with marker support, touch-friendly controls,
 * and accessibility features.
 *
 * @module components/shared/MapView
 */

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { cn } from '@/lib/utils';
import { MapMarker, type MapMarkerData, type MapMarkerType } from './MapMarker';
import { MapOfflineIndicator } from './MapOfflineIndicator';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the MapView component.
 */
export interface MapViewProps {
  /** Initial center position as [latitude, longitude] */
  readonly center: readonly [number, number];
  /** Initial zoom level (default: 13) */
  readonly zoom?: number;
  /** Markers to display on the map */
  readonly markers?: readonly MapMarkerData[];
  /** Additional CSS classes */
  readonly className?: string;
  /** Callback when a marker is clicked */
  readonly onMarkerClick?: (marker: MapMarkerData) => void;
  /** Callback when the map is clicked (not on a marker) */
  readonly onMapClick?: (position: [number, number]) => void;
  /** Whether to show zoom controls */
  readonly showZoomControl?: boolean;
  /** Whether to show attribution */
  readonly showAttribution?: boolean;
  /** Minimum zoom level */
  readonly minZoom?: number;
  /** Maximum zoom level */
  readonly maxZoom?: number;
  /** Whether the map is interactive (default: true) */
  readonly interactive?: boolean;
  /** Fixed height for the map container */
  readonly height?: string | number;
  /** ARIA label for the map */
  readonly 'aria-label'?: string;
  /** Callback when map is ready */
  readonly onMapReady?: (map: LeafletMap) => void;
}

/**
 * Ref handle for MapView component.
 */
export interface MapViewRef {
  /** Get the underlying Leaflet map instance */
  getMap: () => LeafletMap | null;
  /** Pan to a specific position */
  panTo: (position: [number, number]) => void;
  /** Set the zoom level */
  setZoom: (zoom: number) => void;
  /** Fit the map bounds to show all markers */
  fitBounds: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ZOOM = 13;
const DEFAULT_MIN_ZOOM = 3;
const DEFAULT_MAX_ZOOM = 19;

/**
 * OpenStreetMap tile layer URLs.
 * Standard OSM tiles for light mode, CartoDB dark tiles for dark mode.
 */
const TILE_LAYERS = {
  light: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

const TILE_ATTRIBUTION = {
  light:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  dark:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
};

// ============================================================================
// Internal Components
// ============================================================================

/**
 * Internal component to handle map events and expose map instance.
 */
interface MapEventsProps {
  onMapClick?: (position: [number, number]) => void;
  onMapReady?: (map: LeafletMap) => void;
  mapRef: React.MutableRefObject<LeafletMap | null>;
}

function MapEvents({ onMapClick, onMapReady, mapRef }: MapEventsProps) {
  const map = useMap();

  // Store map reference
  useEffect(() => {
    mapRef.current = map;
    onMapReady?.(map);

    return () => {
      mapRef.current = null;
    };
  }, [map, mapRef, onMapReady]);

  // Handle map click events
  useMapEvents({
    click: (e) => {
      onMapClick?.([e.latlng.lat, e.latlng.lng]);
    },
  });

  return null;
}

/**
 * Internal component to handle keyboard navigation between markers.
 */
interface KeyboardNavigationProps {
  markers: readonly MapMarkerData[];
  onMarkerClick?: (marker: MapMarkerData) => void;
}

function KeyboardNavigation({
  markers,
  onMarkerClick,
}: KeyboardNavigationProps) {
  const map = useMap();
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (markers.length === 0) return;

      switch (e.key) {
        // Use Arrow keys for marker navigation (preserves natural Tab behavior)
        case 'ArrowDown':
        case 'ArrowRight':
          setFocusedIndex((prev) =>
            prev >= markers.length - 1 ? 0 : prev + 1
          );
          e.preventDefault();
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          setFocusedIndex((prev) =>
            prev <= 0 ? markers.length - 1 : prev - 1
          );
          e.preventDefault();
          break;
        case 'Enter':
        case ' ':
          if (focusedIndex >= 0 && focusedIndex < markers.length) {
            const marker = markers[focusedIndex];
            if (marker) {
              onMarkerClick?.(marker);
            }
          }
          e.preventDefault();
          break;
        case 'Escape':
          setFocusedIndex(-1);
          break;
        // Note: Tab key is NOT prevented to allow natural focus navigation out of map
      }
    },
    [markers, focusedIndex, onMarkerClick]
  );

  // Pan to focused marker (only if marker is outside current viewport)
  useEffect(() => {
    if (focusedIndex >= 0 && focusedIndex < markers.length) {
      const marker = markers[focusedIndex];
      if (marker) {
        const position = marker.position as [number, number];
        const bounds = map.getBounds();
        // Only pan if marker is outside visible bounds
        if (!bounds.contains(position)) {
          map.panTo(position, { animate: true, duration: 0.25 });
        }
      }
    }
  }, [focusedIndex, markers, map]);

  // Add keyboard listener to map container
  useEffect(() => {
    const container = map.getContainer();
    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [map, handleKeyDown]);

  return null;
}

/**
 * Component to detect theme and switch tile layers.
 */
function ThemeAwareTileLayer({ showAttribution }: { showAttribution: boolean }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Check for dark mode class on document
    const checkDarkMode = () => {
      if (isMounted) {
        setIsDark(document.documentElement.classList.contains('dark'));
      }
    };

    checkDarkMode();

    // Watch for theme changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      isMounted = false;
      observer.disconnect();
    };
  }, []);

  const theme = isDark ? 'dark' : 'light';

  return (
    <TileLayer
      url={TILE_LAYERS[theme]}
      attribution={showAttribution ? TILE_ATTRIBUTION[theme] : undefined}
    />
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * An interactive map component using Leaflet and OpenStreetMap.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <MapView
 *   center={[48.8566, 2.3522]}
 *   zoom={12}
 *   markers={[
 *     { id: '1', position: [48.8566, 2.3522], label: 'Paris', type: 'trip' }
 *   ]}
 *   onMarkerClick={(marker) => console.log(marker.label)}
 * />
 * ```
 *
 * @example
 * ```tsx
 * // With ref for programmatic control
 * const mapRef = useRef<MapViewRef>(null);
 *
 * <MapView
 *   ref={mapRef}
 *   center={[51.5074, -0.1278]}
 *   markers={markers}
 * />
 *
 * // Later: fit bounds to show all markers
 * mapRef.current?.fitBounds();
 * ```
 *
 * @example
 * ```tsx
 * // Static preview (non-interactive)
 * <MapView
 *   center={[48.8566, 2.3522]}
 *   zoom={14}
 *   interactive={false}
 *   height={150}
 *   showZoomControl={false}
 * />
 * ```
 */
export const MapView = memo(
  forwardRef<MapViewRef, MapViewProps>(function MapView(
    {
      center,
      zoom = DEFAULT_ZOOM,
      markers = [],
      className,
      onMarkerClick,
      onMapClick,
      showZoomControl = true,
      showAttribution = true,
      minZoom = DEFAULT_MIN_ZOOM,
      maxZoom = DEFAULT_MAX_ZOOM,
      interactive = true,
      height,
      'aria-label': ariaLabel,
      onMapReady,
    },
    ref
  ) {
    const { t } = useTranslation();
    const mapRef = useRef<LeafletMap | null>(null);

    // Validate center coordinates
    const validCenter = useMemo((): [number, number] => {
      const [lat, lon] = center;
      const validLat =
        typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90;
      const validLon =
        typeof lon === 'number' && !isNaN(lon) && lon >= -180 && lon <= 180;

      if (!validLat || !validLon) {
        if (import.meta.env.DEV) {
          console.warn(
            `MapView: Invalid center coordinates [${lat}, ${lon}], using default [0, 0]`
          );
        }
        return [0, 0];
      }

      return [lat, lon];
    }, [center]);

    // Expose map methods via ref
    useImperativeHandle(
      ref,
      () => ({
        getMap: () => mapRef.current,
        panTo: (position: [number, number]) => {
          mapRef.current?.panTo(position);
        },
        setZoom: (newZoom: number) => {
          mapRef.current?.setZoom(newZoom);
        },
        fitBounds: () => {
          if (mapRef.current && markers.length > 0) {
            const bounds = markers.map((m) => m.position as [number, number]);
            mapRef.current.fitBounds(bounds, { padding: [50, 50] });
          }
        },
      }),
      [markers]
    );

    // Handle marker click with keyboard support
    const handleMarkerClick = useCallback(
      (marker: MapMarkerData) => {
        onMarkerClick?.(marker);
      },
      [onMarkerClick]
    );

    // Compute map container style
    const containerStyle = useMemo(
      () => ({
        height: typeof height === 'number' ? `${height}px` : height,
      }),
      [height]
    );

    const defaultAriaLabel = useMemo(
      () => t('map.ariaLabel', 'Interactive map'),
      [t]
    );

    return (
      <div
        className={cn('relative overflow-hidden rounded-md', className)}
        style={containerStyle}
        role="application"
        aria-label={ariaLabel ?? defaultAriaLabel}
      >
        <MapContainer
          center={validCenter}
          zoom={zoom}
          zoomControl={showZoomControl}
          minZoom={minZoom}
          maxZoom={maxZoom}
          dragging={interactive}
          touchZoom={interactive}
          doubleClickZoom={interactive}
          scrollWheelZoom={interactive}
          boxZoom={interactive}
          keyboard={interactive}
          className="h-full w-full"
          attributionControl={false}
        >
          <ThemeAwareTileLayer showAttribution={showAttribution} />

          <MapEvents
            onMapClick={onMapClick}
            onMapReady={onMapReady}
            mapRef={mapRef}
          />

          {interactive && markers.length > 0 && (
            <KeyboardNavigation
              markers={markers}
              onMarkerClick={onMarkerClick}
            />
          )}

          {markers.map((marker) => (
            <MapMarker
              key={marker.id}
              marker={marker}
              onClick={handleMarkerClick}
            />
          ))}
        </MapContainer>

        {/* Offline indicator */}
        <MapOfflineIndicator position="bottom-left" />

        {/* Screen reader marker count announcement */}
        <div className="sr-only" aria-live="polite">
          {t('map.markerCount', '{{count}} location(s) on map', {
            count: markers.length,
          })}
        </div>
      </div>
    );
  })
);

MapView.displayName = 'MapView';

// Re-export types for convenience
export type { MapMarkerData, MapMarkerType };
