/**
 * @fileoverview Transport Map Page - Shows all transport locations on an interactive map.
 * Displays arrivals and departures with different marker colors.
 *
 * Route: /trips/:tripId/transports/map
 *
 * Features:
 * - Interactive map with all transport locations
 * - Green markers for arrivals, orange for departures
 * - Person-colored markers option
 * - Click marker to see transport details in popup
 * - Fit bounds to show all markers
 * - Empty state when no transports have coordinates
 *
 * @module features/transports/pages/TransportMapPage
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Locale } from 'date-fns';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  Bus,
  Car,
  CircleDot,
  Clock,
  List,
  MapPin,
  Plane,
  Train,
} from 'lucide-react';

import { useTripContext } from '@/contexts/TripContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import {
  MapView,
  type MapMarkerData,
  type MapPolylineData,
  type MapViewRef,
} from '@/components/shared/MapView';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { Button } from '@/components/ui/button';
import { statusVariants } from '@/components/ui/status.variants';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';
import { DirectionsButton } from '@/features/transports/components/DirectionsButton';
import {
  collectDrivenRideIds,
  isLegCovered,
} from '@/features/transports/utils/pickup-utils';
import { getDateLocale } from '@/lib/i18n/date-locale';
import type { Person, PersonId, Transport, TransportMode } from '@/types';
import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Transport with coordinates (filtered).
 */
interface TransportWithCoordinates extends Transport {
  coordinates: {
    readonly lat: number;
    readonly lon: number;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Type guard to filter transports with coordinates.
 */
function hasCoordinates(transport: Transport): transport is TransportWithCoordinates {
  return (
    transport.coordinates !== undefined &&
    typeof transport.coordinates.lat === 'number' &&
    typeof transport.coordinates.lon === 'number' &&
    !isNaN(transport.coordinates.lat) &&
    !isNaN(transport.coordinates.lon)
  );
}

/**
 * True when optional start coordinates are present and numeric.
 */
function hasStartCoordinates(transport: Transport): boolean {
  const c = transport.startCoordinates;
  return (
    c !== undefined &&
    typeof c.lat === 'number' &&
    typeof c.lon === 'number' &&
    !isNaN(c.lat) &&
    !isNaN(c.lon)
  );
}

// ============================================================================
// Popup Content Component
// ============================================================================

/**
 * Props for the TransportPopupContent component.
 */
interface TransportPopupContentProps {
  readonly transport: TransportWithCoordinates;
  readonly person: Person | undefined;
  readonly dateLocale: Locale;
  /**
   * The rides somebody is driving, from `collectDrivenRideIds`.
   *
   * The popup asks the same "is anybody driving this leg" question the
   * transport list and its alert gate ask, and must answer it the same way —
   * this pin once showed an amber "needs pickup" chip for a leg whose ride had
   * a volunteer, on the same trip where the list said nothing was outstanding.
   */
  readonly drivenRideIds: ReadonlySet<string>;
}

/**
 * Renders the appropriate transport mode icon.
 */
function TransportModeIcon({
  mode,
  className,
}: {
  readonly mode: TransportMode | undefined;
  readonly className?: string;
}): ReactElement {
  const iconClassName = className ?? 'size-3.5 shrink-0';
  switch (mode) {
    case 'train':
      return <Train className={iconClassName} aria-hidden="true" />;
    case 'plane':
      return <Plane className={iconClassName} aria-hidden="true" />;
    case 'car':
      return <Car className={iconClassName} aria-hidden="true" />;
    case 'bus':
      return <Bus className={iconClassName} aria-hidden="true" />;
    case 'other':
    default:
      return <CircleDot className={iconClassName} aria-hidden="true" />;
  }
}

/**
 * Popup content for a transport marker.
 */
const TransportPopupContent = memo(function TransportPopupContent({
  transport,
  person,
  dateLocale,
  drivenRideIds,
}: TransportPopupContentProps): ReactElement {
  const { t } = useTranslation();
  const { date, time } = formatTransportDatetimeParts(transport.datetime, dateLocale, 'dayAndTime');

  return (
    <div className="min-w-[200px] space-y-2 p-1">
      {/* Header with type and person */}
      <div className="flex items-center gap-2">
        {transport.type === 'arrival' ? (
          <ArrowDownToLine
            className={cn('size-4 shrink-0', statusVariants({ tone: 'arrival', emphasis: 'text' }))}
            aria-hidden="true"
          />
        ) : (
          <ArrowUpFromLine
            className={cn('size-4 shrink-0', statusVariants({ tone: 'departure', emphasis: 'text' }))}
            aria-hidden="true"
          />
        )}
        <span className="font-medium">
          {transport.type === 'arrival' ? t('transports.arrival') : t('transports.departure')}
        </span>
      </div>

      {/* Person */}
      {person && (
        <div className="flex items-center gap-2">
          <PersonBadge person={person} size="sm" />
        </div>
      )}

      {/* Date and time */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{date}</span>
        <span>{time}</span>
      </div>

      {/* Starting place (optional) */}
      {transport.startLocation ? (
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <MapPin className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">
              {t('transports.legStart', 'Start')}
              {': '}
            </span>
            <span className="truncate">{transport.startLocation}</span>
          </span>
        </div>
      ) : null}

      {/* End location */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-medium text-foreground">
            {t('transports.endLocation', 'Destination')}
            {': '}
            </span>
          <span className="truncate">{transport.location}</span>
        </span>
      </div>

      {/* Transport mode and number */}
      {(transport.transportMode ?? transport.transportNumber) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <TransportModeIcon mode={transport.transportMode} />
          {transport.transportMode && (
            <span>{t(`transports.modes.${transport.transportMode}`)}</span>
          )}
          {transport.transportNumber && (
            <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              {transport.transportNumber}
            </span>
          )}
        </div>
      )}

      {/* Needs pickup indicator — only while nobody is driving the leg */}
      {transport.needsPickup && !isLegCovered(transport, drivenRideIds) && (
        <div className={cn('text-xs font-medium', statusVariants({ tone: 'warning', emphasis: 'text' }))}>
          {t('transports.needsPickup')}
        </div>
      )}

      {/* Get directions button */}
      <DirectionsButton
        coordinates={transport.coordinates}
        locationName={transport.location}
        variant="outline"
        size="sm"
        className="w-full mt-2"
      />
    </div>
  );
});

// ============================================================================
// TransportMapPage Component
// ============================================================================

/**
 * Main transport map page component.
 * Displays all transports with coordinates on an interactive map.
 */
const TransportMapPage = memo(function TransportMapPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { tripId: tripIdFromUrl } = useParams<'tripId'>();

  // Context hooks
  const { currentTrip, isLoading: isTripLoading, setCurrentTrip } = useTripContext();
  const { persons, isLoading: isPersonsLoading } = usePersonContext();
  // The popup's "needs pickup" chip must agree with the transport list's, and
  // both now depend on whether the leg's ride has a driver.
  const { rides } = useRideContext();
  const {
    arrivals,
    departures,
    isLoading: isTransportsLoading,
    error: transportsError,
  } = useTransportContext();

  // Map ref for programmatic control
  const mapRef = useRef<MapViewRef>(null);

  // Combined loading state
  const isLoading = isTripLoading || isPersonsLoading || isTransportsLoading;

  // Get date locale based on current language
  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // Build persons map for O(1) lookups
  const personsMap = useMemo(() => {
    const map = new Map<PersonId, Person>();
    for (const person of persons) {
      map.set(person.id, person);
    }
    return map;
  }, [persons]);

  // Filter transports that have coordinates
  const transportsWithCoordinates = useMemo(() => {
    const allTransports = [...arrivals, ...departures];
    return allTransports.filter(hasCoordinates);
  }, [arrivals, departures]);

  /** Line from start to end when both GPS points exist */
  const routePolylines = useMemo((): readonly MapPolylineData[] => {
    const lines: MapPolylineData[] = [];
    for (const transport of transportsWithCoordinates) {
      if (!hasStartCoordinates(transport)) continue;
      const start = transport.startCoordinates;
      if (!start) continue;
      lines.push({
        id: `route-${transport.id}`,
        positions: [
          [start.lat, start.lon],
          [transport.coordinates.lat, transport.coordinates.lon],
        ],
      });
    }
    return lines;
  }, [transportsWithCoordinates]);

  // Create markers (optional start marker + end marker per transport)
  const drivenRideIds = useMemo(() => collectDrivenRideIds(rides), [rides]);

  const markers = useMemo((): readonly MapMarkerData[] => {
    const result: MapMarkerData[] = [];

    // Where everyone is heading. Without it the map is a scatter of stations
    // with no indication of which way is "home", which is the one thing you
    // want when you are working out who to collect and in what order.
    const tripCoordinates = currentTrip?.coordinates;
    if (tripCoordinates) {
      result.push({
        id: 'trip-location',
        position: [tripCoordinates.lat, tripCoordinates.lon] as readonly [number, number],
        label: currentTrip?.location ?? currentTrip?.name ?? t('trips.title'),
        type: 'trip',
        tooltipContent: (
          <div className="space-y-0.5">
            <div className="font-medium">{currentTrip?.name}</div>
            {currentTrip?.location && (
              <div className="text-muted-foreground truncate max-w-[220px]">
                {currentTrip.location}
              </div>
            )}
          </div>
        ),
      });
    }

    for (const transport of transportsWithCoordinates) {
      const person = personsMap.get(transport.personId);
      const { date, time } = formatTransportDatetimeParts(transport.datetime, dateLocale, 'dayAndTime');

      const startCoords = transport.startCoordinates;
      if (hasStartCoordinates(transport) && startCoords) {
        result.push({
          id: `${transport.id}-start`,
          position: [startCoords.lat, startCoords.lon] as readonly [number, number],
          label: `${person?.name ?? t('common.unknown')} — ${t('transports.legStart', 'Start')}`,
          type: 'default',
          color: person?.color,
          tooltipContent: (
            <div className="space-y-0.5">
              <div className="font-medium">
                {t('transports.legStart', 'Start')}
              </div>
              <div className="text-muted-foreground truncate max-w-[220px]">
                {transport.startLocation ?? '—'}
              </div>
            </div>
          ),
        });
      }

      result.push({
        id: transport.id,
        position: [transport.coordinates.lat, transport.coordinates.lon] as readonly [number, number],
        label: `${person?.name ?? t('common.unknown')} - ${transport.location}`,
        type: transport.type === 'arrival' ? 'transport' : 'pickup',
        color: person?.color,
        tooltipContent: (
          <div className="space-y-0.5">
            <div className="font-medium">
              {person?.name ?? t('common.unknown')} •{' '}
              {transport.type === 'arrival' ? t('transports.arrival') : t('transports.departure')}
            </div>
            <div className="text-muted-foreground">
              {date} {time}
            </div>
            <div className="text-muted-foreground truncate max-w-[220px]">
              {transport.location}
            </div>
          </div>
        ),
        popupContent: (
          <TransportPopupContent
            transport={transport}
            person={person}
            dateLocale={dateLocale}
            drivenRideIds={drivenRideIds}
          />
        ),
      });
    }
    return result;
  }, [
    transportsWithCoordinates,
    personsMap,
    dateLocale,
    t,
    currentTrip,
    drivenRideIds,
  ]);

  // Calculate map center based on markers
  const mapCenter = useMemo((): [number, number] => {
    if (markers.length === 0) {
      // Default to Paris if no markers
      return [48.8566, 2.3522];
    }

    // Calculate centroid of all markers
    const sumLat = markers.reduce((sum, m) => sum + m.position[0], 0);
    const sumLon = markers.reduce((sum, m) => sum + m.position[1], 0);

    return [sumLat / markers.length, sumLon / markers.length];
  }, [markers]);

  // Sync URL tripId with context
  useEffect(() => {
    if (tripIdFromUrl && !isTripLoading && currentTrip?.id !== tripIdFromUrl) {
      setCurrentTrip(tripIdFromUrl).catch((err) => {
        console.error('Failed to set current trip from URL:', err);
      });
    }
  }, [tripIdFromUrl, currentTrip?.id, isTripLoading, setCurrentTrip]);

  // Fit bounds to show all markers when data loads
  useEffect(() => {
    if (!isLoading && (markers.length > 1 || routePolylines.length > 0)) {
      // Small delay to ensure map is ready
      const timer = setTimeout(() => {
        mapRef.current?.fitBounds();
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isLoading, markers.length, routePolylines.length]);

  // Validate tripId matches current trip
  const tripMismatch = useMemo(() => {
    if (!tripIdFromUrl || !currentTrip) return false;
    return tripIdFromUrl !== currentTrip.id;
  }, [tripIdFromUrl, currentTrip]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles back navigation to transport list.
   */
  const handleBackToList = useCallback(() => {
    navigate(`/trips/${tripIdFromUrl}/transports`);
  }, [navigate, tripIdFromUrl]);

  /**
   * Handles generic back navigation.
   */
  const handleBack = useCallback(() => {
    navigate(`/trips/${tripIdFromUrl}/calendar`);
  }, [navigate, tripIdFromUrl]);

  // ============================================================================
  // Header Action (switch to list view)
  // ============================================================================

  const headerAction = useMemo(
    () => (
      <Button variant="outline" onClick={handleBackToList}>
        <List className="size-4 mr-2" aria-hidden="true" />
        {t('transports.listView', 'List view')}
      </Button>
    ),
    [handleBackToList, t]
  );

  // ============================================================================
  // Render: Loading State
  // ============================================================================

  if (isLoading) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('transports.mapView', 'Transport Map')}
          backLink={tripIdFromUrl ? `/trips/${tripIdFromUrl}/transports` : '/trips'}
        />
        <div className="flex-1 flex items-center justify-center min-h-[400px]">
          <LoadingState variant="inline" size="lg" />
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Trip Mismatch or Not Found
  // ============================================================================

  if (!tripIdFromUrl || !currentTrip || tripMismatch) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader title={t('transports.mapView', 'Transport Map')} backLink="/trips" />
        <div className="flex-1 flex items-center justify-center min-h-[400px]">
          <EmptyState
            icon={MapPin}
            title={t('errors.tripNotFound', 'Trip not found')}
            description={t(
              'errors.tripNotFoundDescription',
              'The trip you are looking for does not exist or you do not have access to it.'
            )}
            action={{
              label: t('common.back'),
              onClick: () => navigate('/trips'),
            }}
          />
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Error State
  // ============================================================================

  if (transportsError) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('transports.mapView', 'Transport Map')}
          backLink={`/trips/${tripIdFromUrl}/transports`}
        />
        <ErrorDisplay
          error={transportsError}
          onRetry={() => window.location.reload()}
          onBack={handleBack}
        />
      </div>
    );
  }

  // ============================================================================
  // Render: Empty State (no transports with coordinates)
  // ============================================================================

  if (transportsWithCoordinates.length === 0) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('transports.mapView', 'Transport Map')}
          backLink={`/trips/${tripIdFromUrl}/transports`}
          action={headerAction}
        />
        <div className="flex-1 flex items-center justify-center min-h-[400px]">
          <EmptyState
            icon={MapPin}
            title={t('transports.noLocations', 'No locations to display')}
            description={t(
              'transports.noLocationsDescription',
              'Add transport locations with coordinates to see them on the map.'
            )}
            action={{
              label: t('transports.backToList', 'Back to list'),
              onClick: handleBackToList,
            }}
          />
        </div>
      </div>
    );
  }

  // ============================================================================
  // Render: Main Content - Map View
  // ============================================================================

  return (
    <div className="container max-w-4xl py-6 md:py-8">
      <PageHeader
        title={t('transports.mapView', 'Transport Map')}
        backLink={`/trips/${tripIdFromUrl}/transports`}
        action={headerAction}
      />

      {/*
        Map legend.

        The swatches and the pins they describe are the same two
        `statusVariants` calls — `MapMarker`'s `MARKER_TYPE_CLASSES` maps its
        `transport`/`pickup` types onto `arrival`/`departure` by calling this
        exact API rather than restating the tokens. The `data-testid`s let the
        e2e suite read both back through `getComputedStyle` and assert they
        resolve to one colour per theme, which is the only thing that catches
        the pair drifting apart again.
      */}
      <div
        className="flex items-center gap-4 mb-4 text-sm text-muted-foreground"
        data-testid="map-legend"
      >
        <div className="flex items-center gap-1.5">
          <div
            className={cn('size-3 rounded-full', statusVariants({ tone: 'arrival', emphasis: 'solid' }))}
            data-testid="map-legend-swatch-arrival"
            aria-hidden="true"
          />
          <span>{t('transports.arrivals')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className={cn('size-3 rounded-full', statusVariants({ tone: 'departure', emphasis: 'solid' }))}
            data-testid="map-legend-swatch-departure"
            aria-hidden="true"
          />
          <span>{t('transports.departures')}</span>
        </div>
        {currentTrip?.coordinates && (
          <div className="flex items-center gap-1.5">
            <div
              className="size-3 rounded-full bg-primary"
              data-testid="map-legend-swatch-trip"
              aria-hidden="true"
            />
            <span>{t('transports.tripLocation', 'Accommodation')}</span>
          </div>
        )}
        {/*
          Counts transports, not map pins: this sits beside the arrival and
          departure swatches, and a transport with a start location contributes
          two pins, so `markers.length` overstated what the legend describes.
        */}
        <div className="ml-auto text-xs">
          {t('transports.mappedCount', {
            count: transportsWithCoordinates.length,
          })}
        </div>
      </div>

      {/* Interactive Map */}
      <div className="relative rounded-lg border border-border overflow-hidden">
        <MapView
          ref={mapRef}
          center={mapCenter}
          zoom={markers.length === 1 ? 14 : 10}
          markers={markers}
          polylines={routePolylines}
          interactive={true}
          showZoomControl={true}
          showAttribution={true}
          height={500}
          aria-label={t('transports.mapAriaLabel', 'Map showing transport locations')}
        />
      </div>

      {/* Mobile back to list button */}
      <div className="mt-4 sm:hidden">
        <Button variant="outline" onClick={handleBackToList} className="w-full">
          <ArrowLeft className="size-4 mr-2" aria-hidden="true" />
          {t('transports.backToList', 'Back to list')}
        </Button>
      </div>
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TransportMapPage };
export default TransportMapPage;
