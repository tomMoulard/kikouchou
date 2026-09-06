/**
 * @fileoverview Upcoming Pickups component displays unassigned pickups as
 * prominent alert cards. Pickups at the same station within a time window
 * are grouped for combined trip planning.
 *
 * The grouping is the app saying "these three could share a car", so this panel
 * is also where that suggestion becomes one: a group turns into a {@link Ride}
 * in a single tap, and volunteering to drive a lone pickup creates the car
 * around it. Nothing here writes `Transport.driverId` any more — that field is
 * the pre-ride shape, kept readable and never written.
 *
 * Membership always travels through `setTransportRide`, one scalar on the
 * passenger's own leg. Writing a passenger list on the ride instead would merge
 * badly: two guests joining the same car while both offline would come back
 * with only one of the joins.
 *
 * @module features/transports/components/UpcomingPickups
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { type Locale, format, formatDistanceToNow, isToday, isTomorrow, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { useOfflineAwareToast } from '@/hooks';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Car,
  Clock,
  Loader2,
  MapPin,
  Users,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { statusVariants } from '@/components/ui/status.variants';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { formatTransportDatetime } from '@/lib/utils/datetime-format';
import { RidePickerDialog } from '@/features/transports/components/RidePickerDialog';
import {
  DEFAULT_TIME_WINDOW_MINUTES,
  type PickupGroup,
  groupPickupsByProximity,
  selectPickupsNeedingDriver,
} from '@/features/transports/utils/pickup-utils';
import {
  type RideSuggestion,
  rideDirectionForLeg,
  selectJoinableRides,
  suggestRidesForGroup,
} from '@/features/transports/utils/ride-suggestion';
import {
  DEFAULT_LEAD_TIME_MINUTES,
  type Person,
  type PersonId,
  type Ride,
  type RideId,
  type Transport,
  type TransportId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the UpcomingPickups component.
 */
export interface UpcomingPickupsProps {
  /** Optional className for additional styling. */
  readonly className?: string;
}

/**
 * Props for the PickupAlertCard subcomponent.
 */
interface PickupAlertCardProps {
  /** The transport to display */
  readonly transport: Transport;
  /** The person associated with this transport (if found) */
  readonly person: Person | undefined;
  /** Date locale for formatting */
  readonly dateLocale: Locale;
  /** Callback to volunteer to drive */
  readonly onVolunteer: (transportId: TransportId) => void;
  /**
   * Whether any existing car goes the same way to the same place.
   *
   * The offer is hidden rather than disabled when there is none: a button that
   * opens an empty list is a dead end, and this card already carries the action
   * that creates the car instead.
   */
  readonly canJoinRide: boolean;
  /** Callback to open the picker of cars this leg could join */
  readonly onJoinRide: (transportId: TransportId) => void;
}

/**
 * Props for the DriverSelectDialog subcomponent.
 */
interface DriverSelectDialogProps {
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change open state */
  readonly onOpenChange: (open: boolean) => void;
  /** The transport being assigned a driver */
  readonly transport: Transport | null;
  /** The person needing pickup */
  readonly pickupPerson: Person | undefined;
  /** All persons available to drive */
  readonly persons: readonly Person[];
  /** Callback when driver is selected and confirmed */
  readonly onConfirm: (transportId: TransportId, driverId: PersonId) => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Formats a datetime string into a relative time display.
 * Shows "in X hours/minutes" for today, "tomorrow at HH:mm" for tomorrow,
 * and "Day at HH:mm" for other days.
 */
function formatRelativeTime(
  datetime: string,
  locale: Locale,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  try {
    const date = parseISO(datetime);
    if (isNaN(date.getTime())) {
      return t('common.unknown');
    }

    const now = new Date();

    if (date < now) {
      return t('pickups.overdue');
    }

    if (isToday(date)) {
      return formatDistanceToNow(date, { locale, addSuffix: true });
    }

    if (isTomorrow(date)) {
      const time = format(date, 'HH:mm', { locale });
      return t('upcomingPickups.tomorrowAt', { time });
    }

    // Beyond tomorrow a relative distance stops being useful, so fall back to
    // the same wall-clock rendering every other transport surface uses.
    return formatTransportDatetime(datetime, locale, 'dayAndTime');
  } catch {
    return t('common.unknown');
  }
}

/**
 * Urgency treatments, warning-toned except when the pickup is already overdue.
 *
 * The rungs have to be legible *as* rungs — "due today" and "due next week"
 * carry different actions — so they step through fill AND border rather than
 * through alpha alone. `--warning-surface` sits about a percent of lightness
 * off the page behind it, so 80%/60%/40% of it is not a ladder anybody can
 * see; a filled card with a strong border, a filled card with a hairline, and
 * an unfilled outline are three steps you can tell apart at a glance.
 *
 * Every value here is cva output, so the theme still owns the hue and its
 * dark-mode counterpart.
 */
const URGENCY = {
  overdue: {
    card: cn(statusVariants({ tone: 'danger', emphasis: 'surface' }), 'border-destructive'),
    badge: cn(statusVariants({ tone: 'danger', emphasis: 'soft' }), 'border-destructive'),
    isOverdue: true,
  },
  today: {
    card: cn(statusVariants({ tone: 'warning', emphasis: 'surface' }), 'border-warning'),
    badge: cn(statusVariants({ tone: 'warning', emphasis: 'soft' }), 'border-warning'),
    isOverdue: false,
  },
  tomorrow: {
    card: statusVariants({ tone: 'warning', emphasis: 'surface' }),
    badge: statusVariants({ tone: 'warning', emphasis: 'soft' }),
    isOverdue: false,
  },
  later: {
    card: statusVariants({ tone: 'warning', emphasis: 'outline' }),
    badge: statusVariants({ tone: 'warning', emphasis: 'outline' }),
    isOverdue: false,
  },
} as const;

/**
 * Returns urgency-based classes for a pickup based on its datetime.
 */
function getUrgencyClasses(
  datetime: string,
): (typeof URGENCY)[keyof typeof URGENCY] {
  try {
    const date = parseISO(datetime);
    if (isNaN(date.getTime())) {
      // A date we cannot read is a thing to look at, not a thing to soften.
      return URGENCY.today;
    }

    const now = new Date();

    if (date < now) {
      return URGENCY.overdue;
    }

    if (isToday(date)) {
      return URGENCY.today;
    }

    if (isTomorrow(date)) {
      return URGENCY.tomorrow;
    }

    return URGENCY.later;
  } catch {
    return URGENCY.today;
  }
}

/**
 * Identifies one "build a car from this group" action while it is in flight.
 *
 * A mixed group offers two of them, so the direction is part of the key: the
 * arrivals button has to keep working while the departures one spins.
 *
 * @param group - The proximity group
 * @param direction - The suggested car's direction
 * @returns A key unique to that button
 */
function groupActionKey(group: PickupGroup, direction: RideSuggestion['direction']): string {
  return `${group.station}|${group.startTime}|${direction}`;
}

// ============================================================================
// DriverSelectDialog Subcomponent
// ============================================================================

/**
 * Dialog to select a person as driver for a pickup.
 */
const DriverSelectDialog = memo(function DriverSelectDialog({
  open,
  onOpenChange,
  transport,
  pickupPerson,
  persons,
  onConfirm,
}: DriverSelectDialogProps): ReactElement | null {
  const { t } = useTranslation();
  const [selectedDriverId, setSelectedDriverId] = useState<PersonId | ''>('');

  // Reset selection when dialog opens
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSelectedDriverId('');
      }
      onOpenChange(newOpen);
    },
    [onOpenChange],
  );

  const handleConfirm = useCallback(() => {
    if (!transport || !selectedDriverId) return;
    onConfirm(transport.id, selectedDriverId as PersonId);
    setSelectedDriverId('');
  }, [transport, selectedDriverId, onConfirm]);

  if (!transport) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('pickups.selectDriver')}</DialogTitle>
          <DialogDescription>
            {t('pickups.selectDriverDescription', {
              name: pickupPerson?.name ?? t('common.unknown'),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="driver-select">{t('transports.driver')}</Label>
            <Select
              value={selectedDriverId}
              onValueChange={(value) => setSelectedDriverId(value as PersonId)}
            >
              <SelectTrigger
                id="driver-select"
                className="w-full h-11 md:h-9"
                aria-label={t('pickups.selectDriver')}
              >
                <SelectValue placeholder={t('pickups.selectDriver')} />
              </SelectTrigger>
              <SelectContent>
                {persons.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground text-center">
                    {t('transports.noOtherPersons')}
                  </div>
                ) : (
                  persons.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="size-3 rounded-full shrink-0"
                          style={{ backgroundColor: p.color }}
                          aria-hidden="true"
                        />
                        {p.name}
                      </div>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="h-11 md:h-9"
            onClick={() => handleOpenChange(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedDriverId}
            className="h-11 md:h-9"
          >
            {t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

// ============================================================================
// PickupAlertCard Subcomponent
// ============================================================================

/**
 * Individual pickup alert card with amber/warning styling and volunteer button.
 */
const PickupAlertCard = memo(function PickupAlertCard({
  transport,
  person,
  dateLocale,
  onVolunteer,
  canJoinRide,
  onJoinRide,
}: PickupAlertCardProps): ReactElement {
  const { t } = useTranslation();

  const relativeTime = useMemo(
    () => formatRelativeTime(transport.datetime, dateLocale, t),
    [transport.datetime, dateLocale, t],
  );

  const TypeIcon = transport.type === 'arrival' ? ArrowDownToLine : ArrowUpFromLine;
  const urgency = useMemo(() => getUrgencyClasses(transport.datetime), [transport.datetime]);

  const handleVolunteer = useCallback(() => {
    onVolunteer(transport.id);
  }, [transport.id, onVolunteer]);

  const handleJoinRide = useCallback(() => {
    onJoinRide(transport.id);
  }, [transport.id, onJoinRide]);

  return (
    <div
      className={cn(
        urgency.card,
        'rounded-lg border-2 p-4',
        'motion-safe:transition-all motion-safe:duration-300',
      )}
      role="article"
      aria-label={`${t('pickups.needsDriver')}: ${person?.name ?? t('common.unknown')}, ${transport.location}, ${relativeTime}`}
    >
      {/* Header: Person and urgency badge */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {person ? (
            <PersonBadge person={person} size="default" />
          ) : (
            <span className="text-sm text-muted-foreground">
              {t('common.unknown')}
            </span>
          )}
        </div>
        <Badge
          variant="outline"
          className={cn('shrink-0 text-xs', urgency.badge)}
        >
          {urgency.isOverdue ? t('pickups.overdue') : t('pickups.needsDriver')}
        </Badge>
      </div>

      {/* Details: Type, Time, Location, Transport number */}
      <div className="flex flex-col gap-1.5 mb-4">
        <div className="flex items-center gap-2 text-sm">
          <TypeIcon
            className={cn(
              'size-4 shrink-0',
              statusVariants({ tone: transport.type, emphasis: 'text' }),
            )}
            aria-hidden="true"
          />
          <span className="text-muted-foreground">
            {transport.type === 'arrival'
              ? t('transports.arrival')
              : t('transports.departure')}
          </span>
          {transport.transportNumber && (
            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
              {transport.transportNumber}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{relativeTime}</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate" title={transport.location}>
            {transport.location}
          </span>
        </div>
      </div>

      {/* Volunteer to drive button */}
      <Button
        onClick={handleVolunteer}
        size="default"
        className="w-full h-11 md:h-9"
        variant="default"
      >
        <Car className="size-4 mr-2" aria-hidden="true" />
        {t('pickups.volunteerDrive')}
      </Button>

      {/* Join a car that is already going there */}
      {canJoinRide && (
        <Button
          onClick={handleJoinRide}
          size="default"
          className="w-full h-11 md:h-9 mt-2"
          variant="outline"
        >
          <Users className="size-4 mr-2" aria-hidden="true" />
          {t('pickups.addToRide')}
        </Button>
      )}
    </div>
  );
});

// ============================================================================
// UpcomingPickups Component
// ============================================================================

/**
 * Displays unassigned pickups as prominent alert cards.
 * Groups nearby pickups (same station, similar time) for combined trip planning.
 *
 * Features:
 * - Filters to show ONLY the pickups nobody is driving yet
 * - Alert-style cards with amber/warning styling
 * - Station/time grouping with "Combined trip" badge, and a one-tap action that
 *   turns a group into a car with every one of its legs inside
 * - "Volunteer to drive", which arranges a car rather than writing a `driverId`
 * - "Add to an existing car" on a leg, over the cars already going that way
 * - Renders nothing when there are no unassigned upcoming pickups
 * - Animated removal when pickup is resolved
 * - Full i18n support
 *
 * @param props - Component props
 * @returns The upcoming pickups element
 */
const UpcomingPickups = memo(function UpcomingPickups({
  className,
}: UpcomingPickupsProps): ReactElement | null {
  const { t, i18n } = useTranslation();
  const { upcomingPickups, nowMs } = useTransportContext(),
    // A leg sitting in a ride somebody has volunteered for is not unassigned,
    // even though the leg itself carries no `driverId`.
    { rides, createRide, updateRide, setTransportRide } = useRideContext();
  const { persons } = usePersonContext();
  const { successToast } = useOfflineAwareToast();

  // Dialog state
  const [driverDialogOpen, setDriverDialogOpen] = useState(false);
  const [selectedTransport, setSelectedTransport] = useState<Transport | null>(null);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [joinTransport, setJoinTransport] = useState<Transport | null>(null);

  // Which "build a car for this group" button is in flight, or null.
  const [buildingRideKey, setBuildingRideKey] = useState<string | null>(null);

  // Track recently resolved pickups for animation (transport ID -> driver name)
  const [resolvingMap, setResolvingMap] = useState<Map<TransportId, string>>(new Map());

  // Set on setup, not only in cleanup: StrictMode's mount → cleanup → mount
  // would otherwise latch this false forever and freeze the optimistic
  // "resolving" card the moment a driver is chosen.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Get date locale
  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // Build persons map for O(1) lookups
  const personsMap = useMemo(() => {
    const map = new Map<PersonId, Person>();
    for (const person of persons) {
      map.set(person.id, person);
    }
    return map;
  }, [persons]);

  // Rides by id, so volunteering can tell "this leg is already in a car nobody
  // drives" from "this leg has no car at all" without a scan per click.
  //
  // Both readings go through this map rather than through `Transport.rideId`
  // alone: a leg can name a ride this device does not hold — legs travel on the
  // QR-changeset path and rides do not yet — and treating that as membership
  // would aim every write at a car that is not there.
  const ridesById = useMemo(() => {
    const map = new Map<RideId, Ride>();
    for (const ride of rides) {
      map.set(ride.id, ride);
    }
    return map;
  }, [rides]);

  const knownRideIds = useMemo(
    () => new Set<string>(ridesById.keys()),
    [ridesById],
  );

  // The one answer to "which pickups still need a driver" — shared with the
  // transport list's alert gate and the analytics badge, so the number in the
  // header, the visibility of this panel and the cards below always agree.
  const pickupsNeedingDriver = useMemo(
    () => selectPickupsNeedingDriver(upcomingPickups, rides),
    [upcomingPickups, rides],
  );

  // Group those pickups by station proximity for combined-trip planning.
  // Grouping partitions the selection, so the cards rendered here are exactly
  // the pickups counted in the header badge.
  const pickupGroups = useMemo(
    () => groupPickupsByProximity(pickupsNeedingDriver, DEFAULT_TIME_WINDOW_MINUTES),
    [pickupsNeedingDriver],
  );

  // Each group alongside the car — or, for a mixed arrival/departure group, the
  // two cars — it implies. Read once here so the buttons and the handler that
  // acts on them can never disagree about which legs are in which car.
  const groupPlans = useMemo(
    () =>
      pickupGroups.map((group) => ({
        group,
        suggestions: suggestRidesForGroup(group, knownRideIds),
      })),
    [pickupGroups, knownRideIds],
  );

  // The cars each waiting leg could still be added to. Computed for the whole
  // list rather than on demand, so a card only offers the action when the
  // picker it opens would have something in it.
  const joinableRidesByTransport = useMemo(() => {
    const map = new Map<TransportId, readonly Ride[]>();
    for (const pickup of pickupsNeedingDriver) {
      const candidates = selectJoinableRides(rides, pickup, nowMs);
      if (candidates.length > 0) {
        map.set(pickup.id, candidates);
      }
    }
    return map;
  }, [pickupsNeedingDriver, rides, nowMs]);

  const joinableRides = useMemo(
    () =>
      joinTransport === null
        ? []
        : (joinableRidesByTransport.get(joinTransport.id) ?? []),
    [joinTransport, joinableRidesByTransport],
  );

  const unassignedCount = pickupsNeedingDriver.length;

  /** Drops a pickup out of the optimistic "resolving" state. */
  const stopResolving = useCallback((transportId: TransportId) => {
    setResolvingMap((prev) => {
      const next = new Map(prev);
      next.delete(transportId);
      return next;
    });
  }, []);

  // Handle volunteer button click - open driver selector
  const handleVolunteer = useCallback(
    (transportId: TransportId) => {
      const transport = pickupsNeedingDriver.find((p) => p.id === transportId);
      if (transport) {
        setSelectedTransport(transport);
        setDriverDialogOpen(true);
      }
    },
    [pickupsNeedingDriver],
  );

  /**
   * Turns a proximity group into one car, then puts every leg of it inside.
   *
   * The ride is created first and kept whatever happens next: a car carrying
   * two of its three passengers is something the user can finish from the ride
   * card, whereas undoing the ride because the third write failed throws away
   * the arrangement they just made. Each leg is attached on its own so one
   * refusal does not take the rest of the group with it — and a group that
   * already has a car half-filled extends that car rather than starting a
   * second one beside it.
   */
  const handleBuildRide = useCallback(
    async (group: PickupGroup, suggestion: RideSuggestion) => {
      setBuildingRideKey(groupActionKey(group, suggestion.direction));

      try {
        const rideId =
          suggestion.existingRideId ??
          (
            await createRide({
              direction: suggestion.direction,
              meetDatetime: suggestion.meetDatetime,
              location: suggestion.location,
              leadTimeMinutes: DEFAULT_LEAD_TIME_MINUTES,
            })
          ).id;

        const boarding = suggestion.legs.filter((leg) => leg.rideId !== rideId);
        let attached = 0;

        for (const leg of boarding) {
          try {
            await setTransportRide(leg.id, rideId);
            attached += 1;
          } catch (error) {
            console.error('Failed to put a pickup in the new ride:', error);
          }
        }

        if (attached === boarding.length) {
          successToast(t('pickups.rideCreated'));
        } else {
          toast.error(t('pickups.rideCreatedPartial'));
        }
      } catch (error) {
        console.error('Failed to build a ride from a pickup group:', error);
        toast.error(t('errors.saveFailed'));
      } finally {
        if (isMountedRef.current) {
          setBuildingRideKey(null);
        }
      }
    },
    [createRide, setTransportRide, successToast, t],
  );

  // Handle "add to an existing car" click - open the ride picker
  const handleJoinRide = useCallback(
    (transportId: TransportId) => {
      const transport = pickupsNeedingDriver.find((p) => p.id === transportId);
      if (transport) {
        setJoinTransport(transport);
        setJoinDialogOpen(true);
      }
    },
    [pickupsNeedingDriver],
  );

  // Handle a car chosen in the picker
  const handleJoinConfirm = useCallback(
    async (transportId: TransportId, rideId: RideId) => {
      setJoinDialogOpen(false);

      try {
        await setTransportRide(transportId, rideId);
        successToast(t('pickups.addedToRide'));
      } catch (error) {
        console.error('Failed to add a pickup to a ride:', error);
        toast.error(t('errors.saveFailed'));
      }
    },
    [setTransportRide, successToast, t],
  );

  /**
   * Handles a volunteered driver.
   *
   * Volunteering arranges a *car*, never a `Transport.driverId`: that field is
   * the pre-ride shape and nothing writes it any more. A leg already sitting in
   * a driverless car gains its driver there — so the passengers already in it
   * keep the lift they were promised — and a leg with no car at all gets one
   * built around it.
   */
  const handleDriverConfirm = useCallback(
    async (transportId: TransportId, driverId: PersonId) => {
      const transport = pickupsNeedingDriver.find((p) => p.id === transportId);
      if (!transport) {
        return;
      }

      // Read the driver's name before the write, for the resolving card
      const driverName = personsMap.get(driverId)?.name ?? t('pickups.volunteerSuccess');

      // Mark as resolving for animation (store driver name for display)
      setResolvingMap((prev) => new Map(prev).set(transportId, driverName));
      setDriverDialogOpen(false);

      try {
        const existingRide =
          transport.rideId === undefined ? undefined : ridesById.get(transport.rideId);

        if (existingRide !== undefined) {
          await updateRide(existingRide.id, { driverId });
        } else {
          const ride = await createRide({
            direction: rideDirectionForLeg(transport),
            meetDatetime: transport.datetime,
            location: transport.location,
            leadTimeMinutes: DEFAULT_LEAD_TIME_MINUTES,
            driverId,
          });
          // A failure here leaves an empty car with a driver in it rather than
          // no car at all — recoverable from the ride card, and the toast below
          // says the seat was not taken.
          await setTransportRide(transportId, ride.id);
        }

        successToast(t('pickups.volunteerSuccess'));

        // Show driver name briefly, then remove from resolving
        setTimeout(() => {
          if (isMountedRef.current) {
            stopResolving(transportId);
          }
        }, 2000);
      } catch (error) {
        console.error('Failed to assign driver:', error);
        toast.error(t('errors.saveFailed'));
        stopResolving(transportId);
      }
    },
    [
      createRide,
      updateRide,
      setTransportRide,
      ridesById,
      personsMap,
      pickupsNeedingDriver,
      stopResolving,
      t,
      successToast,
    ],
  );

  // No unassigned upcoming pickups (including "all covered" and empty)
  if (unassignedCount === 0) {
    return null;
  }

  return (
    <div className={className}>
      {/* Section header with count badge */}
      <div className="flex items-center gap-2 mb-4">
        <Car
          className={cn('size-5', statusVariants({ tone: 'warning', emphasis: 'text' }))}
          aria-hidden="true"
        />
        <h2 className="text-base font-semibold">{t('pickups.needsDriver')}</h2>
        <Badge
          variant="outline"
          className={statusVariants({ tone: 'warning', emphasis: 'soft' })}
        >
          {t('pickups.unassignedCount', { count: unassignedCount })}
        </Badge>
      </div>

      {/* Pickup groups */}
      <div className="space-y-4">
        {groupPlans.map(({ group, suggestions }) => {
          const isGrouped = group.pickups.length > 1;
          // A group whose car exists keeps its cards — the car still needs a
          // driver — but not the offer to build another one around it.
          const buildable = suggestions.filter((each) => !each.isArranged);

          if (isGrouped) {
            // Grouped display with shared station header
            return (
              <div
                key={`${group.station}-${group.startTime}`}
                className={cn(
                  statusVariants({ tone: 'warning', emphasis: 'surface' }),
                  'rounded-xl border-2 bg-warning-surface/40 p-4',
                )}
              >
                {/* Group header */}
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-warning-border">
                  <MapPin
                    className={cn('size-4', statusVariants({ tone: 'warning', emphasis: 'text' }))}
                    aria-hidden="true"
                  />
                  <span className="font-medium text-sm">
                    {t('pickups.stationWindow', {
                      station: group.displayStation,
                      startTime: formatTransportDatetime(group.startTime, dateLocale, 'timeOnly'),
                      endTime: formatTransportDatetime(group.endTime, dateLocale, 'timeOnly'),
                    })}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn('shrink-0 text-xs', statusVariants({ tone: 'warning', emphasis: 'soft' }))}
                  >
                    <Users className="size-3 mr-1" aria-hidden="true" />
                    {t('pickups.combinedTrip')}
                  </Badge>
                </div>

                {/* Combined trip hint */}
                <p className="text-xs text-muted-foreground mb-3">
                  {t('pickups.combinedTripHint')}
                </p>

                {/* A car cannot both fetch and drop off, so a group holding
                    each says so rather than quietly arranging one of them. */}
                {suggestions.length > 1 && buildable.length > 0 && (
                  <p className="text-xs text-muted-foreground mb-3">
                    {t('pickups.mixedDirections')}
                  </p>
                )}

                {/* Build the car (or, for a mixed group, one per direction) */}
                {buildable.length > 0 && (
                  <div className="flex flex-col gap-2 mb-3 sm:flex-row">
                    {buildable.map((suggestion) => {
                      const isBuilding =
                        buildingRideKey === groupActionKey(group, suggestion.direction);

                      return (
                        <Button
                          key={suggestion.direction}
                          onClick={() => void handleBuildRide(group, suggestion)}
                          disabled={isBuilding}
                          className="h-11 md:h-9 flex-1"
                        >
                          {isBuilding ? (
                            <Loader2 className="size-4 mr-2 animate-spin" aria-hidden="true" />
                          ) : (
                            <Car className="size-4 mr-2" aria-hidden="true" />
                          )}
                          {/* Named per direction only when the group really
                              implies two cars — `suggestions`, not the
                              buildable subset, so a half-arranged mixed group
                              still says which half this button covers. */}
                          {suggestions.length === 1
                            ? t('pickups.oneCar')
                            : suggestion.direction === 'pickup'
                              ? t('pickups.oneCarArrivals')
                              : t('pickups.oneCarDepartures')}
                        </Button>
                      );
                    })}
                  </div>
                )}

                {/* Individual pickup cards within group */}
                <div className="space-y-3">
                  {group.pickups.map((pickup) => {
                    const resolvingDriverName = resolvingMap.get(pickup.id);
                    const isResolving = resolvingDriverName !== undefined;
                    return (
                      <div
                        key={pickup.id}
                        className={cn(
                          'motion-safe:transition-all motion-safe:duration-500',
                          isResolving && 'motion-safe:opacity-0 motion-safe:scale-95',
                        )}
                      >
                        {isResolving ? (
                          <div
                            className={cn(
                              statusVariants({ tone: 'success' }),
                              'rounded-lg border-2 p-4 text-center text-sm',
                            )}
                          >
                            {resolvingDriverName}
                          </div>
                        ) : (
                          <PickupAlertCard
                            transport={pickup}
                            person={personsMap.get(pickup.personId)}
                            dateLocale={dateLocale}
                            onVolunteer={handleVolunteer}
                            canJoinRide={joinableRidesByTransport.has(pickup.id)}
                            onJoinRide={handleJoinRide}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }

          // Single pickup (no group)
          const pickup = group.pickups[0]!;
          const resolvingDriverName = resolvingMap.get(pickup.id);
          const isResolving = resolvingDriverName !== undefined;
          return (
            <div
              key={pickup.id}
              className={cn(
                'motion-safe:transition-all motion-safe:duration-500',
                isResolving && 'motion-safe:opacity-0 motion-safe:scale-95',
              )}
            >
              {isResolving ? (
                <div
                  className={cn(
                    statusVariants({ tone: 'success' }),
                    'rounded-lg border-2 p-4 text-center text-sm',
                  )}
                >
                  {resolvingDriverName}
                </div>
              ) : (
                <PickupAlertCard
                  transport={pickup}
                  person={personsMap.get(pickup.personId)}
                  dateLocale={dateLocale}
                  onVolunteer={handleVolunteer}
                  canJoinRide={joinableRidesByTransport.has(pickup.id)}
                  onJoinRide={handleJoinRide}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Driver selection dialog */}
      <DriverSelectDialog
        open={driverDialogOpen}
        onOpenChange={setDriverDialogOpen}
        transport={selectedTransport}
        pickupPerson={selectedTransport ? personsMap.get(selectedTransport.personId) : undefined}
        persons={persons}
        onConfirm={handleDriverConfirm}
      />

      {/* Picker of cars this pickup could join */}
      <RidePickerDialog
        open={joinDialogOpen}
        onOpenChange={setJoinDialogOpen}
        transport={joinTransport}
        rides={joinableRides}
        personsById={personsMap}
        dateLocale={dateLocale}
        onSelect={handleJoinConfirm}
      />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { UpcomingPickups };
