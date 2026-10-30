/**
 * @fileoverview Map of every trip that has a location pinned on the map.
 *
 * Answers "where have we been?" at a glance: one marker per located trip,
 * each opening a popup with its dates and a link to that trip's analytics.
 * Trips saved with a free-text location and no pin are counted separately so
 * the map never silently under-reports.
 *
 * @module features/trips/components/TripsLocationMap
 */

import { type ReactElement, memo, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  MapView,
  type MapMarkerData,
  type MapViewRef,
} from '@/components/shared/MapView';
import { hasValidCoordinates, type Coordinates } from '@/lib/geocoding';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { formatDateRange } from '@/lib/utils/date-format';
import type { Trip } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the TripsLocationMap component.
 */
export interface TripsLocationMapProps {
  /** Every trip on this device; the unpinned ones are filtered out here. */
  readonly trips: readonly Trip[];
  /** Map height in pixels (default: 400) */
  readonly height?: number;
  /**
   * Wrap the map in a titled Card (default: true).
   *
   * Pass `false` where the surrounding view already says this is the map —
   * a "Map" tab, say — so the heading is not repeated.
   */
  readonly asCard?: boolean;
}

/**
 * A trip narrowed to one that carries usable coordinates.
 */
interface LocatedTrip {
  readonly trip: Trip;
  readonly coordinates: Coordinates;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_HEIGHT = 400;

/** Zoom used for a single marker; wider when several must fit. */
const SINGLE_MARKER_ZOOM = 11;
const MULTI_MARKER_ZOOM = 4;

/** Fallback centre (Paris) when no trip is pinned. */
const FALLBACK_CENTER: readonly [number, number] = [48.8566, 2.3522];

/** Let Leaflet finish sizing the container before fitting bounds to it. */
const FIT_BOUNDS_DELAY_MS = 100;

// ============================================================================
// Component
// ============================================================================

/**
 * Renders every located trip on one map.
 *
 * @param props - Component props
 * @returns The map card, or a hint when no trip carries coordinates
 *
 * @example
 * ```tsx
 * <TripsLocationMap trips={trips} />
 * ```
 */
export const TripsLocationMap = memo(function TripsLocationMap({
  trips,
  height = DEFAULT_HEIGHT,
  asCard = true,
}: TripsLocationMapProps): ReactElement {
  const { t, i18n } = useTranslation();
  const mapRef = useRef<MapViewRef>(null);
  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // Only trips whose coordinates survive validation reach the map: a NaN pair
  // would put Leaflet at an undefined centre and blank the whole card.
  const locatedTrips = useMemo((): readonly LocatedTrip[] => {
    const result: LocatedTrip[] = [];
    for (const trip of trips) {
      if (hasValidCoordinates(trip.coordinates)) {
        result.push({ trip, coordinates: trip.coordinates });
      }
    }
    return result;
  }, [trips]);

  const markers = useMemo(
    (): readonly MapMarkerData[] =>
      locatedTrips.map(({ trip, coordinates }) => ({
        id: trip.id,
        position: [coordinates.lat, coordinates.lon] as readonly [number, number],
        label: trip.name,
        type: 'trip' as const,
        tooltipContent: (
          <div className="space-y-0.5">
            <div className="font-medium">{trip.name}</div>
            {trip.location && (
              <div className="max-w-[220px] truncate text-muted-foreground">
                {trip.location}
              </div>
            )}
            <div className="text-muted-foreground">
              {formatDateRange(trip.startDate, trip.endDate, dateLocale)}
            </div>
          </div>
        ),
        popupContent: (
          <div className="min-w-[180px] space-y-1.5 p-1">
            <p className="font-medium">{trip.name}</p>
            {trip.location && (
              <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{trip.location}</span>
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {formatDateRange(trip.startDate, trip.endDate, dateLocale)}
            </p>
            <Link
              to={`/trips/${trip.id}/analytics`}
              className="inline-block text-sm font-medium text-primary underline underline-offset-2"
            >
              {t('analytics.openTrip')}
            </Link>
          </div>
        ),
      })),
    [locatedTrips, dateLocale, t],
  );

  // Frame every marker once the map exists; a single marker keeps its zoom.
  useEffect(() => {
    if (markers.length < 2) {
      return undefined;
    }
    const timer = setTimeout(() => {
      mapRef.current?.fitBounds();
    }, FIT_BOUNDS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [markers.length]);

  const center = useMemo((): readonly [number, number] => {
    const first = locatedTrips[0];
    if (!first) {
      return FALLBACK_CENTER;
    }
    const sumLat = locatedTrips.reduce((sum, item) => sum + item.coordinates.lat, 0);
    const sumLon = locatedTrips.reduce((sum, item) => sum + item.coordinates.lon, 0);
    return [sumLat / locatedTrips.length, sumLon / locatedTrips.length];
  }, [locatedTrips]);

  const unpinnedCount = trips.length - locatedTrips.length;

  const body =
    locatedTrips.length === 0 ? (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t('analytics.tripsMapEmpty')}
      </p>
    ) : (
      <>
        <div className="overflow-hidden rounded-md border border-border">
          <MapView
            ref={mapRef}
            center={center}
            zoom={markers.length === 1 ? SINGLE_MARKER_ZOOM : MULTI_MARKER_ZOOM}
            markers={markers}
            interactive={true}
            showZoomControl={true}
            showAttribution={true}
            height={height}
            aria-label={t('analytics.tripsMapAriaLabel')}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t('analytics.tripsMapSummary', { count: locatedTrips.length })}
          {unpinnedCount > 0 && (
            <>
              {' · '}
              {t('analytics.tripsMapUnpinned', { count: unpinnedCount })}
            </>
          )}
        </p>
      </>
    );

  if (!asCard) {
    return <div>{body}</div>;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="size-4 text-primary" aria-hidden="true" />
          {t('analytics.tripsMapTitle')}
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
});
