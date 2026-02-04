/**
 * @fileoverview Trip location map preview component.
 * Displays a small static map thumbnail that expands to a full interactive map on click.
 *
 * @module features/trips/components/TripLocationMap
 */

import { type KeyboardEvent, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Expand, MapPin, X } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MapView, type MapMarkerData } from '@/components/shared';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the TripLocationMap component.
 */
export interface TripLocationMapProps {
  /** Location name for display */
  readonly location: string;
  /** GPS coordinates for the map */
  readonly coordinates: {
    readonly lat: number;
    readonly lon: number;
  };
  /** Additional CSS classes for the container */
  readonly className?: string;
  /** Height of the preview thumbnail in pixels (default: 80) */
  readonly previewHeight?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PREVIEW_HEIGHT = 80;
const PREVIEW_ZOOM = 12;
const EXPANDED_ZOOM = 14;

// ============================================================================
// Component
// ============================================================================

/**
 * A map preview component for trip locations.
 *
 * Features:
 * - Small static thumbnail (~120x80px) showing trip location
 * - Click to expand to full interactive map in a dialog
 * - Keyboard accessible (Enter/Space to expand)
 * - Shows marker at trip coordinates
 *
 * @example
 * ```tsx
 * <TripLocationMap
 *   location="Beach House, Brittany"
 *   coordinates={{ lat: 48.8566, lon: 2.3522 }}
 * />
 * ```
 */
export const TripLocationMap = memo(function TripLocationMap({
  location,
  coordinates,
  className,
  previewHeight = DEFAULT_PREVIEW_HEIGHT,
}: TripLocationMapProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  // Create marker data for the trip location
  const marker: MapMarkerData = {
    id: 'trip-location',
    position: [coordinates.lat, coordinates.lon],
    label: location,
    type: 'trip',
  };

  const markers: readonly MapMarkerData[] = [marker];

  /**
   * Opens the expanded map dialog.
   */
  const handleExpand = useCallback(() => {
    setIsExpanded(true);
  }, []);

  /**
   * Closes the expanded map dialog.
   */
  const handleClose = useCallback(() => {
    setIsExpanded(false);
  }, []);

  /**
   * Handles keyboard activation on the preview.
   */
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleExpand();
      }
    },
    [handleExpand]
  );

  return (
    <>
      {/* Preview Thumbnail */}
      <button
        type="button"
        onClick={handleExpand}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative w-full overflow-hidden rounded-md',
          'border border-border',
          'cursor-pointer transition-all duration-200',
          'hover:border-primary/50 hover:shadow-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          className
        )}
        style={{ height: `${previewHeight}px` }}
        aria-label={t('map.expandMap', 'View location on map: {{location}}', {
          location,
        })}
        aria-haspopup="dialog"
        aria-expanded={isExpanded}
      >
        {/* Static Map Preview */}
        <MapView
          center={[coordinates.lat, coordinates.lon]}
          zoom={PREVIEW_ZOOM}
          markers={markers}
          interactive={false}
          showZoomControl={false}
          showAttribution={false}
          height={previewHeight}
          aria-label={t('map.tripPreview', 'Trip location preview')}
        />

        {/* Expand Icon Overlay */}
        <div
          className={cn(
            'absolute bottom-1 right-1 p-1',
            'rounded bg-background/80 backdrop-blur-sm',
            'text-muted-foreground',
            'pointer-events-none'
          )}
          aria-hidden="true"
        >
          <Expand className="size-3" />
        </div>
      </button>

      {/* Expanded Map Dialog */}
      <Dialog open={isExpanded} onOpenChange={setIsExpanded}>
        <DialogContent
          className="max-w-3xl p-0 overflow-hidden"
          aria-describedby={undefined}
        >
          <DialogHeader className="p-4 pb-2">
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="size-5 text-primary" aria-hidden="true" />
              {location}
            </DialogTitle>
          </DialogHeader>

          {/* Full Interactive Map */}
          <div className="relative h-[400px] sm:h-[500px]">
            <MapView
              center={[coordinates.lat, coordinates.lon]}
              zoom={EXPANDED_ZOOM}
              markers={markers}
              interactive={true}
              showZoomControl={true}
              showAttribution={true}
              height="100%"
              aria-label={t('map.tripLocation', 'Trip location: {{location}}', {
                location,
              })}
            />
          </div>

          {/* Close Button in Footer */}
          <div className="p-4 pt-2 flex justify-end border-t">
            <Button variant="outline" onClick={handleClose}>
              <X className="mr-2 size-4" aria-hidden="true" />
              {t('common.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});

TripLocationMap.displayName = 'TripLocationMap';
