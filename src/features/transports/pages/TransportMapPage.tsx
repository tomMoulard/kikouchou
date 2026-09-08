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
 * - "Only mine" / "Everyone" scope filter, persisted in `?scope=`
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
import { createHeadcountResolver } from '@/features/rooms/utils/capacity-utils';
import { DirectionsButton } from '@/features/transports/components/DirectionsButton';
import { RideSummary } from '@/features/transports/components/RideSummary';
import { TransportScopeFilter } from '@/features/transports/components/TransportScopeFilter';
import { useTransportScope } from '@/features/transports/hooks/useTransportScope';
import {
  collectDrivenRideIds,
  isLegCovered,
} from '@/features/transports/utils/pickup-utils';
import { countRidePassengers } from '@/features/transports/utils/ride-capacity';
import {
  resolveRides,
  rideConcernsPerson,
  selectRideByLeg,
  type ResolvedRide,
} from '@/features/transports/utils/ride-model';
import { hasValidCoordinates } from '@/lib/geocoding';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';
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

/**
 * A resolved journey whose meeting point can actually be put on the map.
 */
interface ResolvedRideWithCoordinates extends ResolvedRide {
  readonly coordinates: {
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
 * Type guard for a journey whose meeting point can be drawn.
 *
 * The range check is `hasValidCoordinates` from `@/lib/geocoding` rather than a
 * third hand-rolled `!isNaN` pair: a ride whose meeting point was never
 * geocoded has `coordinates: undefined`, and reading that as zeroes would drop
 * a pin in the Gulf of Guinea — which then drags `fitBounds` and the centroid
 * halfway across the Atlantic with it, taking every real marker off screen.
 * `Infinity` and a latitude of 500 do worse, and only a bounded guard says no
 * to those.
 */
function hasRideCoordinates(
  journey: ResolvedRide,
): journey is ResolvedRideWithCoordinates {
  return hasValidCoordinates(journey.coordinates);
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
  /**
   * The car serving this leg, when one has been arranged.
   *
   * Always a real {@link ResolvedRide} — the page filters legacy `driverId`-only
   * journeys out, because those are already drawn by this popup's own driver
   * handling and a second rendering of the same fact would contradict it.
   */
  readonly ride?: ResolvedRide;
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
  ride,
}: TransportPopupContentProps): ReactElement {
  const { t } = useTranslation();
  const { date, time } = formatTransportDatetimeParts(transport.datetime, dateLocale, 'dayAndTime');
  const rideMeetTime =
    ride === undefined
      ? ''
      : formatTransportDatetimeParts(ride.meetDatetime, dateLocale, 'timeOnly').time;

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

      {/* The car serving this leg, and where it meets the guest */}
      {ride ? (
        <div
          className="flex items-start gap-2 text-sm text-muted-foreground"
          data-testid="transport-popup-ride"
        >
          <Car className="size-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <span className="font-medium text-foreground">
              {t('rides.ride', 'Ride')}
              {': '}
            </span>
            <span>{ride.driver?.name ?? t('rides.noDriver')}</span>
            {rideMeetTime ? (
              <span>{` · ${t('rides.meetAt', { time: rideMeetTime })}`}</span>
            ) : null}
          </span>
        </div>
      ) : null}

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
// Ride Popup Content Component
// ============================================================================

/**
 * Props for the RidePopupContent component.
 */
interface RidePopupContentProps {
  readonly journey: ResolvedRideWithCoordinates;
  /** The trip's guests, so passengers are counted as people rather than rows */
  readonly persons: readonly Person[];
  readonly dateLocale: Locale;
}

/**
 * Popup content for a ride's meeting point.
 *
 * This is the marker a driver opens the map for: one pin for the one place they
 * are going, carrying the whole car — when to be there, when to set off, which
 * vehicle, and everybody it is collecting — instead of three pins stacked on
 * the same station each telling a third of the story.
 *
 * The body is `RideSummary`, shared with the calendar's detail dialog, so the
 * two cannot show different subsets of the same journey.
 */
const RidePopupContent = memo(function RidePopupContent({
  journey,
  persons,
  dateLocale,
}: RidePopupContentProps): ReactElement {
  return (
    <div className="min-w-[200px] p-1" data-testid="ride-popup">
      <RideSummary
        ride={journey}
        persons={persons}
        dateLocale={dateLocale}
        density="popup"
        footer={
          <DirectionsButton
            coordinates={journey.coordinates}
            locationName={journey.location}
            variant="outline"
            size="sm"
            className="w-full mt-2"
          />
        }
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
  const {
    arrivals,
    departures,
    isLoading: isTransportsLoading,
    error: transportsError,
  } = useTransportContext();
  // Two things need this context. The popup's "needs pickup" chip must agree
  // with the transport list's, which depends on whether the leg's ride has a
  // driver; and the meeting-point markers are resolved from the rides and the
  // cars together.
  const { rides, vehicles, isLoading: isRidesLoading } = useRideContext();

  // Map ref for programmatic control
  const mapRef = useRef<MapViewRef>(null);

  // Combined loading state
  // The rides count towards loading: `drivenRideIds` is empty until they land,
  // so a paint taken before that shows the amber "needs pickup" chip on a leg
  // whose car already has a volunteer — the contradiction `drivenRideIds` was
  // added to remove, and the scope filter would meanwhile resolve no cars at
  // all and hide the legs sharing mine.
  const isLoading =
    isTripLoading || isPersonsLoading || isTransportsLoading || isRidesLoading;

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

  /**
   * The trip's car journeys, read the one way every surface reads them.
   *
   * Legacy `driverId`-only journeys are dropped here rather than filtered
   * further down: their meeting point *is* the leg's own coordinates, so a
   * marker for one would land exactly on top of the transport pin it was
   * derived from and say the same thing twice.
   */
  const journeys = useMemo(
    () =>
      resolveRides({
        transports: [...arrivals, ...departures],
        rides,
        vehicles,
        persons,
      }).filter((journey) => !journey.isLegacy),
    [arrivals, departures, persons, rides, vehicles],
  );

  /** The car serving each leg, so a transport popup can name it. */
  const rideByTransportId = useMemo(() => selectRideByLeg(journeys), [journeys]);

  /** How many people a guest row stands for — never assume one. */
  const headcountOf = useMemo(() => createHeadcountResolver(persons), [persons]);

  // "Only mine" versus the whole trip, from `?scope=`. The hook resolves the
  // cars from *every* transport on the trip, not from the pinned subset here —
  // a leg without coordinates still puts its passenger in a car, and losing it
  // would take the rest of that car off the map with it.
  const {
    scope,
    canFilter: canFilterScope,
    myPersonId,
    visibleTransports,
    hiddenCount,
    setScope,
  } = useTransportScope(transportsWithCoordinates);

  /**
   * Journeys whose meeting point can be drawn, under the scope in force.
   *
   * Filtered on the *journey*, not on the legs left visible: a car I am in is
   * mine even on the day every one of my car-mates' legs is somebody else's
   * row, and dropping its rendez-vous marker would leave the passenger lines
   * pointing at nothing.
   */
  const mappableJourneys = useMemo(() => {
    const drawable = journeys.filter(hasRideCoordinates);
    if (scope === 'all' || myPersonId === undefined) {
      return drawable;
    }
    return drawable.filter((journey) => rideConcernsPerson(journey, myPersonId));
  }, [journeys, myPersonId, scope]);

  /** Line from start to end when both GPS points exist */
  const routePolylines = useMemo((): readonly MapPolylineData[] => {
    const lines: MapPolylineData[] = [];
    for (const transport of visibleTransports) {
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

    // Each leg tied to the meeting point that serves it. A leg standing exactly
    // on the rendez-vous — the usual case, since the car meets the train at the
    // station — gets no line: a zero-length polyline draws nothing and would
    // only add a Leaflet layer per passenger.
    for (const journey of mappableJourneys) {
      for (const leg of journey.legs) {
        const legCoordinates = leg.transport.coordinates;
        if (
          !hasCoordinates(leg.transport) ||
          legCoordinates === undefined ||
          (legCoordinates.lat === journey.coordinates.lat &&
            legCoordinates.lon === journey.coordinates.lon)
        ) {
          continue;
        }
        lines.push({
          id: `ride-${journey.id}-leg-${leg.transport.id}`,
          positions: [
            [legCoordinates.lat, legCoordinates.lon],
            [journey.coordinates.lat, journey.coordinates.lon],
          ],
        });
      }
    }

    return lines;
  }, [mappableJourneys, visibleTransports]);

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

    for (const transport of visibleTransports) {
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
            ride={rideByTransportId.get(transport.id)}
          />
        ),
      });
    }
    // One pin per rendez-vous, pushed LAST.
    //
    // Two reasons, and the second is the load-bearing one. It is deliberately
    // neutral rather than arrival-green or departure-orange: those two colours
    // mean "a guest's own leg" everywhere else on this map, and a meeting point
    // is a third kind of thing — the legend names it and the popup carries the
    // direction in words and an arrow, so the colour is never alone.
    //
    // And it goes after the transport pins because in the case this feature
    // exists for — the car meets the train at the station, which is the same
    // case the polylines above skip as degenerate — the rendez-vous sits on
    // exactly the coordinates of the legs it serves. Leaflet ranks coincident
    // markers by insertion order, so pushed first the headline pin renders
    // underneath the leg pins and cannot be clicked at all.
    for (const journey of mappableJourneys) {
      const meetTime = formatTransportDatetimeParts(
        journey.meetDatetime,
        dateLocale,
        'dayAndTime',
      );

      result.push({
        id: `ride-${journey.id}`,
        position: [journey.coordinates.lat, journey.coordinates.lon] as readonly [
          number,
          number,
        ],
        label: `${t('rides.meetingPoint', 'Meeting point')} — ${journey.location}`,
        type: 'default',
        tooltipContent: (
          <div className="space-y-0.5">
            <div className="font-medium">
              {t(`rides.directions.${journey.direction}`)} •{' '}
              {t('rides.passengers', {
                count: countRidePassengers(journey, headcountOf),
              })}
            </div>
            <div className="text-muted-foreground">
              {meetTime.date} {meetTime.time}
            </div>
            <div className="text-muted-foreground truncate max-w-[220px]">
              {journey.location}
            </div>
          </div>
        ),
        popupContent: (
          <RidePopupContent
            journey={journey}
            persons={persons}
            dateLocale={dateLocale}
          />
        ),
      });
    }

    return result;
  }, [
    visibleTransports,
    mappableJourneys,
    rideByTransportId,
    personsMap,
    persons,
    headcountOf,
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

  // A rendez-vous is a location too. A trip whose guests never geocoded their
  // stations but whose driver pinned the one place the car meets them has
  // something to show, and the empty state used to hide the whole map from it.
  if (transportsWithCoordinates.length === 0 && mappableJourneys.length === 0) {
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

      {/* Whose travel this map is showing, and what that is hiding */}
      <TransportScopeFilter
        scope={scope}
        canFilter={canFilterScope}
        hiddenCount={hiddenCount}
        onScopeChange={setScope}
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
          The swatch mirrors `MARKER_TYPE_CLASSES.default` — the neutral pin a
          ride's meeting point is drawn with — rather than restating a shade.
        */}
        {mappableJourneys.length > 0 && (
          <div className="flex items-center gap-1.5">
            <div
              className="size-3 rounded-full bg-muted-foreground"
              data-testid="map-legend-swatch-ride"
              aria-hidden="true"
            />
            <span>{t('rides.meetingPoint', 'Meeting point')}</span>
          </div>
        )}
        {/*
          Counts transports, not map pins: this sits beside the arrival and
          departure swatches, and a transport with a start location contributes
          two pins, so `markers.length` overstated what the legend describes.
        */}
        <div className="ml-auto text-xs">
          {t('transports.mappedCount', {
            count: visibleTransports.length,
          })}
        </div>
      </div>

      {/*
        A scope that pins nothing gets a sentence rather than an empty map: a
        blank map reads as "the app lost your travel". The filter above already
        carries the count and the way back, so this states the situation and
        does not repeat the button.
      */}
      {visibleTransports.length === 0 && mappableJourneys.length === 0 ? (
        <div className="flex min-h-[400px] items-center justify-center rounded-lg border">
          <EmptyState
            icon={MapPin}
            title={t('transports.scope.empty', 'Nothing here concerns you')}
            description={t(
              'transports.scope.emptyDescription',
              'None of this trip’s travel involves you. Switch to Everyone to see the whole trip.',
            )}
          />
        </div>
      ) : (
        /* Interactive Map */
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
      )}

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
