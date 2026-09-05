/**
 * @fileoverview Upcoming Pickups component displays unassigned pickups as
 * prominent alert cards. Pickups at the same station within a time window
 * are grouped for combined trip planning.
 *
 * @module features/transports/components/UpcomingPickups
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useMemo,
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
import {
  DEFAULT_TIME_WINDOW_MINUTES,
  groupPickupsByProximity,
  selectPickupsNeedingDriver,
} from '@/features/transports/utils/pickup-utils';
import type { Person, PersonId, Transport, TransportId } from '@/types';

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
 * - Filters to show ONLY unassigned pickups (needsPickup && !driverId)
 * - Alert-style cards with amber/warning styling
 * - "Volunteer to drive" button with person selector dialog
 * - Station/time grouping with "Combined trip" badge
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
  const { upcomingPickups, updateTransport } = useTransportContext(),
    // A leg sitting in a ride somebody has volunteered for is not unassigned,
    // even though the leg itself carries no `driverId`.
    { rides } = useRideContext();
  const { persons } = usePersonContext();
  const { successToast } = useOfflineAwareToast();

  // Dialog state
  const [driverDialogOpen, setDriverDialogOpen] = useState(false);
  const [selectedTransport, setSelectedTransport] = useState<Transport | null>(null);

  // Track recently resolved pickups for animation (transport ID -> driver name)
  const [resolvingMap, setResolvingMap] = useState<Map<TransportId, string>>(new Map());

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

  const unassignedCount = pickupsNeedingDriver.length;

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

  // Handle driver confirmed
  const handleDriverConfirm = useCallback(
    async (transportId: TransportId, driverId: PersonId) => {
      try {
        // Get driver name before async operation for display during animation
        const driver = personsMap.get(driverId);
        const driverName = driver?.name ?? t('pickups.volunteerSuccess');

        // Mark as resolving for animation (store driver name for display)
        setResolvingMap((prev) => new Map(prev).set(transportId, driverName));
        setDriverDialogOpen(false);

        await updateTransport(transportId, { driverId });

        successToast(t('pickups.volunteerSuccess'));

        // Show driver name briefly, then remove from resolving
        setTimeout(() => {
          setResolvingMap((prev) => {
            const next = new Map(prev);
            next.delete(transportId);
            return next;
          });
        }, 2000);
      } catch (error) {
        console.error('Failed to assign driver:', error);
        toast.error(t('errors.saveFailed'));
        setResolvingMap((prev) => {
          const next = new Map(prev);
          next.delete(transportId);
          return next;
        });
      }
    },
    [updateTransport, personsMap, t, successToast],
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
        {pickupGroups.map((group) => {
          const isGrouped = group.pickups.length > 1;

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
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { UpcomingPickups };
