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
import { format, formatDistanceToNow, isToday, isTomorrow, parseISO } from 'date-fns';
import { enUS, fr } from 'date-fns/locale';
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
import { PersonBadge } from '@/components/shared/PersonBadge';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { cn } from '@/lib/utils';
import { DEFAULT_TIME_WINDOW_MINUTES, groupPickupsByProximity } from '@/features/transports/utils/pickup-utils';
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
  readonly dateLocale: typeof fr | typeof enUS;
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
 * Gets the date-fns locale based on the current i18n language.
 */
function getDateLocale(language: string): typeof fr | typeof enUS {
  return language === 'fr' ? fr : enUS;
}

/**
 * Formats a datetime string into a relative time display.
 * Shows "in X hours/minutes" for today, "tomorrow at HH:mm" for tomorrow,
 * and "Day at HH:mm" for other days.
 */
function formatRelativeTime(
  datetime: string,
  locale: typeof fr | typeof enUS,
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

    return format(date, 'EEE d MMM HH:mm', { locale });
  } catch {
    return t('common.unknown');
  }
}

/**
 * Returns urgency-based classes for a pickup based on its datetime.
 */
function getUrgencyClasses(datetime: string): {
  card: string;
  badge: string;
  isOverdue: boolean;
} {
  try {
    const date = parseISO(datetime);
    if (isNaN(date.getTime())) {
      return { card: 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20', badge: 'border-amber-500 text-amber-700 bg-amber-100 dark:bg-amber-950/40', isOverdue: false };
    }

    const now = new Date();

    if (date < now) {
      // Overdue
      return {
        card: 'border-red-300 bg-red-50/50 dark:bg-red-950/20',
        badge: 'border-red-500 text-red-700 bg-red-100 dark:bg-red-950/40',
        isOverdue: true,
      };
    }

    if (isToday(date)) {
      // Today - more urgent amber
      return {
        card: 'border-amber-400 bg-amber-50/70 dark:bg-amber-950/30',
        badge: 'border-amber-500 text-amber-700 bg-amber-100 dark:bg-amber-950/40',
        isOverdue: false,
      };
    }

    if (isTomorrow(date)) {
      // Tomorrow - lighter amber
      return {
        card: 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/15',
        badge: 'border-amber-400 text-amber-600 bg-amber-50 dark:bg-amber-950/30',
        isOverdue: false,
      };
    }

    // Later - warm neutral
    return {
      card: 'border-amber-200 bg-amber-50/20 dark:bg-amber-950/10',
      badge: 'border-amber-300 text-amber-500 bg-amber-50/50 dark:bg-amber-950/20',
      isOverdue: false,
    };
  } catch {
    return { card: 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20', badge: 'border-amber-500 text-amber-700 bg-amber-100 dark:bg-amber-950/40', isOverdue: false };
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
      <DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
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
        'rounded-lg border-2 p-4',
        'motion-safe:transition-all motion-safe:duration-300',
        urgency.card,
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
              transport.type === 'arrival' ? 'text-green-600' : 'text-orange-600',
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
 * - Warm empty state when all pickups covered
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
  const { upcomingPickups, updateTransport } = useTransportContext();
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

  // Group pickups by station proximity (handles filtering internally: unassigned, upcoming, valid datetime)
  const pickupGroups = useMemo(
    () => groupPickupsByProximity(upcomingPickups, DEFAULT_TIME_WINDOW_MINUTES),
    [upcomingPickups],
  );

  // Derive unassigned count from groups (single source of truth for displayed pickups)
  const unassignedCount = useMemo(
    () => pickupGroups.reduce((sum, group) => sum + group.pickups.length, 0),
    [pickupGroups],
  );

  // Handle volunteer button click - open driver selector
  const handleVolunteer = useCallback(
    (transportId: TransportId) => {
      const transport = upcomingPickups.find((p) => p.id === transportId);
      if (transport) {
        setSelectedTransport(transport);
        setDriverDialogOpen(true);
      }
    },
    [upcomingPickups],
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

  // Check if there are any pickups at all (assigned or unassigned)
  const hasAnyPickups = upcomingPickups.some((t) => t.needsPickup);

  // If there are no pickups needing a ride at all, hide the section entirely
  if (!hasAnyPickups) {
    return null;
  }

  // If all pickups are covered (have drivers), show warm empty state
  if (unassignedCount === 0) {
    return (
      <div className={className}>
        <div className="text-center py-6 text-sm text-muted-foreground">
          <p>{t('pickups.allCovered')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Section header with count badge */}
      <div className="flex items-center gap-2 mb-4">
        <Car className="size-5 text-amber-600" aria-hidden="true" />
        <h2 className="text-base font-semibold">{t('pickups.needsDriver')}</h2>
        <Badge
          variant="outline"
          className="border-amber-500 text-amber-700 bg-amber-50 dark:bg-amber-950/30"
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
                className="rounded-xl border-2 border-amber-300 bg-amber-50/30 dark:bg-amber-950/10 p-4"
              >
                {/* Group header */}
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-amber-200 dark:border-amber-800">
                  <MapPin className="size-4 text-amber-600" aria-hidden="true" />
                  <span className="font-medium text-sm">
                    {t('pickups.stationWindow', {
                      station: group.displayStation,
                      startTime: format(parseISO(group.startTime), 'HH:mm', { locale: dateLocale }),
                      endTime: format(parseISO(group.endTime), 'HH:mm', { locale: dateLocale }),
                    })}
                  </span>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-amber-400 text-amber-600 bg-amber-100 dark:bg-amber-950/40 text-xs"
                  >
                    <Users className="size-3 mr-1" aria-hidden="true" />
                    {t('pickups.combinedTrip')}
                  </Badge>
                </div>

                {/* Combined trip hint */}
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
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
                          <div className="rounded-lg border-2 border-green-300 bg-green-50/50 dark:bg-green-950/20 p-4 text-center text-sm text-green-700 dark:text-green-300">
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
                <div className="rounded-lg border-2 border-green-300 bg-green-50/50 dark:bg-green-950/20 p-4 text-center text-sm text-green-700 dark:text-green-300">
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
