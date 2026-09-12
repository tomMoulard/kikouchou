/**
 * @fileoverview Directions Button component for getting directions to a location.
 * Opens native maps app or web-based map with directions to the specified coordinates.
 *
 * @module features/transports/components/DirectionsButton
 */

import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigation } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

/**
 * Coordinates for the destination.
 */
export interface DirectionsCoordinates {
  readonly lat: number;
  readonly lon: number;
}

/**
 * Props for the DirectionsButton component.
 */
export interface DirectionsButtonProps {
  /** Destination coordinates */
  readonly coordinates: DirectionsCoordinates;
  /** Location name for display in maps app */
  readonly locationName?: string;
  /** Button variant */
  readonly variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  /** Button size */
  readonly size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Additional CSS classes */
  readonly className?: string;
  /** Whether to show text label (default: true) */
  readonly showLabel?: boolean;
  /** Whether the button is disabled */
  readonly disabled?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maps app URL templates.
 * Google Maps is used as primary, with OpenStreetMap as fallback.
 */
const MAPS_URLS = {
  /**
   * Google Maps directions URL.
   * Uses the Maps URL API with destination coordinates.
   * Works on all platforms - opens app on mobile, web on desktop.
   */
  google: (lat: number, lon: number, name?: string) => {
    const params = new URLSearchParams({
      api: '1',
      destination: `${lat},${lon}`,
    });
    if (name) {
      params.set('destination_place_id', ''); // Clear place ID to use coordinates
    }
    return `https://www.google.com/maps/dir/?${params}`;
  },

  /**
   * OpenStreetMap directions URL.
   * Uses OSRM for routing via openstreetmap.org.
   */
  osm: (lat: number, lon: number) =>
    `https://www.openstreetmap.org/directions?to=${lat},${lon}`,

  /**
   * Apple Maps URL (iOS only).
   * Uses Maps URL scheme for native app integration.
   */
  apple: (lat: number, lon: number, name?: string) => {
    const params = new URLSearchParams({
      daddr: `${lat},${lon}`,
      dirflg: 'd', // Driving directions
    });
    if (name) {
      params.set('daddr', `${name}@${lat},${lon}`);
    }
    return `maps://?${params}`;
  },
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Detects if the user is on iOS.
 */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/**
 * Detects if the user is on a mobile device.
 */
function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

/**
 * Gets the best directions URL for the current platform.
 *
 * Priority:
 * 1. Apple Maps on iOS (native integration)
 * 2. Google Maps on mobile (native app integration)
 * 3. Google Maps on desktop (web)
 *
 * @param lat - Latitude
 * @param lon - Longitude
 * @param name - Optional location name
 * @returns The directions URL
 */
function getDirectionsUrl(lat: number, lon: number, name?: string): string {
  // iOS: Try Apple Maps first (better native integration)
  if (isIOS()) {
    return MAPS_URLS.apple(lat, lon, name);
  }

  // All other platforms: Use Google Maps
  // On Android, this will open the Google Maps app if installed
  // On desktop, this opens Google Maps in the browser
  return MAPS_URLS.google(lat, lon, name);
}

/**
 * Gets an alternative directions URL (OpenStreetMap).
 * Useful as a fallback or for users who prefer OSM.
 */
function getAlternativeDirectionsUrl(lat: number, lon: number): string {
  return MAPS_URLS.osm(lat, lon);
}

// ============================================================================
// Component
// ============================================================================

/**
 * Button that opens directions to a location in the device's maps app.
 *
 * Features:
 * - Platform-aware: Uses Apple Maps on iOS, Google Maps elsewhere
 * - Opens native maps app on mobile for better navigation experience
 * - Accessible with proper ARIA attributes
 * - Configurable appearance (size, variant, icon-only mode)
 *
 * @example
 * ```tsx
 * // Standard usage
 * <DirectionsButton
 *   coordinates={{ lat: 48.8566, lon: 2.3522 }}
 *   locationName="Paris Charles de Gaulle Airport"
 * />
 *
 * // Icon-only button
 * <DirectionsButton
 *   coordinates={{ lat: 48.8566, lon: 2.3522 }}
 *   showLabel={false}
 *   size="icon"
 * />
 *
 * // Custom styling
 * <DirectionsButton
 *   coordinates={{ lat: 48.8566, lon: 2.3522 }}
 *   variant="outline"
 *   size="sm"
 *   className="w-full"
 * />
 * ```
 */
export const DirectionsButton = memo(function DirectionsButton({
  coordinates,
  locationName,
  variant = 'outline',
  size = 'default',
  className,
  showLabel = true,
  disabled = false,
}: DirectionsButtonProps) {
  const { t } = useTranslation();

  // Generate directions URL
  const directionsUrl = useMemo(
    () => getDirectionsUrl(coordinates.lat, coordinates.lon, locationName),
    [coordinates.lat, coordinates.lon, locationName]
  );

  // Handle button click
  const handleClick = useCallback(() => {
    // Open in new tab (on mobile, this will trigger native app)
    window.open(directionsUrl, '_blank', 'noopener,noreferrer');
  }, [directionsUrl]);

  // Button label
  const label = t('map.getDirections', 'Get Directions');

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={disabled}
      className={cn(
        // Add map-related styling
        'gap-2',
        className
      )}
      aria-label={showLabel ? undefined : label}
      title={showLabel ? undefined : label}
    >
      <Navigation className="size-4" aria-hidden="true" />
      {showLabel && <span>{label}</span>}
    </Button>
  );
});

// ============================================================================
// Exports
// ============================================================================

export {
  getDirectionsUrl,
  getAlternativeDirectionsUrl,
  isIOS,
  isMobile,
};
