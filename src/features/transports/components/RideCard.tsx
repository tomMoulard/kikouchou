/**
 * @fileoverview One car journey, with the people riding in it nested inside it.
 *
 * Three guests landing at the same terminal within the hour are one car, not
 * three unrelated rows — and the list said "three unrelated rows" right up
 * until this card existed, so a driver had to reconstruct the trip in their
 * head from three cards that never mentioned one another.
 *
 * Everything drawn here comes from a {@link ResolvedRide}, never from the
 * stored `Ride` or the legs directly. That is the whole point of
 * `resolveRides`: the card, the calendar, the map and the "time to leave"
 * notification read one function, so they cannot disagree about the same car.
 * It also means a legacy `driverId`-only transport arrives here already shaped
 * like a one-passenger ride (`isLegacy: true`, `ride: undefined`) and needs no
 * branch of its own — nothing migrates those rows, because a Dexie upgrade
 * inventing `Ride` rows would push one device's guesses into the shared
 * document as though the group had agreed them.
 *
 * The actions are deliberately per **leg**, not per journey: a leg exists in
 * both storage shapes, so editing or deleting one is safe on a legacy journey
 * that has no ride row to update. Any control that edits the *journey* has to
 * check `isLegacy` first.
 *
 * @module features/transports/components/RideCard
 */

import { type ReactElement, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from 'date-fns';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Car,
  Clock,
  Edit,
  MapPin,
  MoreVertical,
  Timer,
  Trash2,
  User,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { statusVariants } from '@/components/ui/status.variants';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { TransportIcon } from '@/components/shared/TransportIcon';
import { RideCapacityBadge } from '@/features/transports/components/RideCapacityBadge';
import { RideMismatchNotice } from '@/features/transports/components/RideMismatchNotice';
import type { HeadcountResolver } from '@/features/rooms/utils/capacity-utils';
import { isLegCovered } from '@/features/transports/utils/pickup-utils';
import { summariseRideCapacity } from '@/features/transports/utils/ride-capacity';
import type {
  ResolvedLeg,
  ResolvedRide,
} from '@/features/transports/utils/ride-model';
import { cn } from '@/lib/utils';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';
import type { TransportId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link RideCard}.
 */
export interface RideCardProps {
  /** The journey to draw, straight from `resolveRides`. */
  readonly journey: ResolvedRide;
  /** Date locale for formatting. */
  readonly dateLocale: Locale;
  /**
   * The rides somebody has volunteered to drive, from `collectDrivenRideIds`.
   *
   * The card asks "is anybody driving this?" and so does the amber alert gate
   * above it, so both read `isLegCovered` over this one index. `journey.driver`
   * is *not* that answer: it is undefined both when nobody volunteered and when
   * the volunteer's guest row is missing, and reading the second as the first is
   * how one page came to contradict itself — the panel disappeared once
   * Guillaume volunteered while Alice's card went on saying nobody was coming.
   */
  readonly drivenRideIds: ReadonlySet<string>;
  /**
   * How many people a guest row stands for.
   *
   * Required, never optional-with-a-default-of-one: "Alice+Auré" is a single
   * row worth two seats, and a card that assumed one would report a full car
   * as having room. Build it with `createHeadcountResolver(persons)`.
   */
  readonly resolveHeadcount: HeadcountResolver;
  /**
   * Whether this device may act on a leg that has drifted out of the window.
   *
   * The notice offers *move the car* and *drop the passenger*, which are the
   * driver's calls — so it is shown to the driver alone. A passenger who moved
   * their own train already knows; what the rest of the car gets is the change
   * feed above the list, which reports without offering to reshuffle anybody.
   */
  readonly canResolveMismatch?: boolean;
  /** Opens one passenger's own leg for editing. */
  readonly onEditLeg: (transportId: TransportId) => void;
  /** Asks to delete one passenger's own leg. */
  readonly onDeleteLeg: (transportId: TransportId) => void;
  /** Whether the row actions are disabled. */
  readonly isActionsDisabled?: boolean;
  /** Whether the journey has already happened. */
  readonly isPast?: boolean;
}

/**
 * Props for the passenger row inside a card.
 */
interface RidePassengerRowProps {
  /** The leg, resolved against the guest travelling on it. */
  readonly leg: ResolvedLeg;
  /** True when this passenger is the one driving. */
  readonly isDriver: boolean;
  /** Date locale for formatting. */
  readonly dateLocale: Locale;
  /** Opens this leg for editing. */
  readonly onEdit: (transportId: TransportId) => void;
  /** Asks to delete this leg. */
  readonly onDelete: (transportId: TransportId) => void;
  /** Whether the row actions are disabled. */
  readonly isActionsDisabled: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Renders an epoch instant through the app's single datetime renderer.
 *
 * The renderer takes an ISO string because that is what a stored datetime is;
 * `leaveAtMs` is derived arithmetic, so it is handed back in the same shape
 * rather than being formatted by a second, forked `format()` call.
 *
 * @param instantMs - Epoch milliseconds, or null when the instant is unknown
 * @param locale - The date-fns locale
 * @returns The 24-hour wall clock, or an empty string when unplaceable
 */
function formatInstantTime(instantMs: number | null, locale: Locale): string {
  // `toISOString` throws on a non-finite instant rather than returning
  // something a renderer could shrug at, and a thrown card takes the page.
  if (instantMs === null || !Number.isFinite(instantMs)) {
    return '';
  }
  return formatTransportDatetimeParts(
    new Date(instantMs).toISOString(),
    locale,
    'timeOnly',
  ).time;
}

// ============================================================================
// RidePassengerRow Component
// ============================================================================

/**
 * One passenger inside a ride card: their colour, their name, their own time.
 */
const RidePassengerRow = memo(function RidePassengerRow({
  leg,
  isDriver,
  dateLocale,
  onEdit,
  onDelete,
  isActionsDisabled,
}: RidePassengerRowProps): ReactElement {
  const { t } = useTranslation(),
    { transport, person } = leg,
    name = person?.name ?? t('common.unknown'),
    time = useMemo(
      () =>
        formatTransportDatetimeParts(transport.datetime, dateLocale, 'timeOnly')
          .time,
      [transport.datetime, dateLocale],
    ),
    handleEdit = useCallback(() => {
      onEdit(transport.id);
    }, [transport.id, onEdit]),
    handleDelete = useCallback(() => {
      onDelete(transport.id);
    }, [transport.id, onDelete]);

  return (
    <li className="text-sm">
      <div className="flex items-center gap-2">
        {/* A guest's colour is chosen by the user and stored, so it cannot be a
            utility class. An orphaned leg falls back to the theme's neutral. */}
        <span
          className={cn(
            'size-3 rounded-full shrink-0',
            person === undefined && 'bg-muted-foreground',
          )}
          style={person === undefined ? undefined : { backgroundColor: person.color }}
          aria-hidden="true"
        />
        <span className="truncate" title={name}>
          {name}
        </span>
        {isDriver && (
          <>
            <Car className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t('rides.driver')}</span>
          </>
        )}
        {transport.transportMode !== undefined && (
          <TransportIcon mode={transport.transportMode} className="text-muted-foreground" />
        )}
        {transport.transportNumber !== undefined && transport.transportNumber !== '' && (
          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">
            {transport.transportNumber}
          </span>
        )}
        <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
          {time}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:size-8 shrink-0"
              disabled={isActionsDisabled}
              aria-label={`${t('common.actions', 'Actions')}: ${name}`}
            >
              <MoreVertical className="size-5 md:size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleEdit}>
              <Edit className="size-4" aria-hidden="true" />
              {t('common.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={handleDelete}>
              <Trash2 className="size-4" aria-hidden="true" />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* "Meet at gate 12" is written against one passenger's leg, and folding
          the legs into one card must not throw it away. */}
      {transport.notes !== undefined && transport.notes !== '' && (
        <p className="pl-5 text-xs text-muted-foreground italic line-clamp-2">
          {transport.notes}
        </p>
      )}
    </li>
  );
});

// ============================================================================
// RideCard Component
// ============================================================================

/**
 * A car journey: where and when it meets, who drives it, and who is in it.
 *
 * @param props - The resolved journey and its row callbacks
 * @returns The card element
 *
 * @example
 * ```tsx
 * {resolveRides({ transports, rides, vehicles, persons }).map((journey) => (
 *   <RideCard
 *     key={journey.id}
 *     journey={journey}
 *     dateLocale={dateLocale}
 *     drivenRideIds={drivenRideIds}
 *     resolveHeadcount={resolveHeadcount}
 *     canResolveMismatch={journey.driverId === myPersonId}
 *     onEditLeg={handleEdit}
 *     onDeleteLeg={handleDelete}
 *   />
 * ))}
 * ```
 */
const RideCard = memo(function RideCard({
  journey,
  dateLocale,
  drivenRideIds,
  resolveHeadcount,
  canResolveMismatch = false,
  onEditLeg,
  onDeleteLeg,
  isActionsDisabled = false,
  isPast = false,
}: RideCardProps): ReactElement {
  const { t } = useTranslation(),
    // Colour never carries the meaning on its own: the arrow stays.
    isPickup = journey.direction === 'pickup',
    DirectionIcon = isPickup ? ArrowDownToLine : ArrowUpFromLine,
    directionLabel = t(`rides.directions.${journey.direction}`),
    { date: meetDate, time: meetTime } = useMemo(
      () =>
        formatTransportDatetimeParts(journey.meetDatetime, dateLocale, 'dayAndTime'),
      [journey.meetDatetime, dateLocale],
    ),
    leaveTime = useMemo(
      () => formatInstantTime(journey.leaveAtMs, dateLocale),
      [journey.leaveAtMs, dateLocale],
    ),
    // Does this lot fit in that car, and are the right restraints in it. Asked
    // through the one helper the ride form and the badge also ask, so a card
    // and the form that produced it cannot give different answers.
    capacity = useMemo(
      () => summariseRideCapacity(journey, resolveHeadcount),
      [journey, resolveHeadcount],
    ),
    // Is anybody driving this? Read off the ride's own `driverId` — the very
    // field `collectDrivenRideIds` indexes — plus `isLegCovered` for the legacy
    // shape, where the driver lives on the leg instead. Deliberately *not*
    // `journey.driver !== undefined`: that is undefined both when nobody
    // volunteered and when the volunteer's guest row is missing, and it is
    // undefined for a car nobody has joined yet, which has no legs to ask.
    hasDriver =
      journey.ride?.driverId !== undefined ||
      journey.legs.some((leg) => isLegCovered(leg.transport, drivenRideIds)),
    // "Driving themselves" replaces the chauffeur line rather than sitting
    // beside it — the driver is one of the passengers below, marked there.
    namesAChauffeur = !journey.isSelfDriven && journey.driver !== undefined,
    driverSummary = journey.isSelfDriven
      ? t('rides.selfDriven')
      : journey.driver !== undefined
        ? `${t('rides.driver')}: ${journey.driver.name}`
        : hasDriver
          ? `${t('rides.driver')}: ${t('common.unknown')}`
          : t('rides.noDriver'),
    ariaLabel = useMemo(
      () =>
        [
          directionLabel,
          meetDate,
          meetTime,
          journey.location,
          driverSummary,
          t('rides.passengers', { count: journey.legs.length }),
        ]
          .filter(Boolean)
          .join(', '),
      [
        directionLabel,
        meetDate,
        meetTime,
        journey.location,
        driverSummary,
        journey.legs.length,
        t,
      ],
    );

  return (
    <Card
      role="article"
      aria-label={ariaLabel}
      className={cn(
        'transition-all duration-200',
        'hover:shadow-md hover:border-primary/20',
        isPast && 'opacity-60',
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <DirectionIcon
            className={cn(
              'size-5 shrink-0',
              statusVariants({
                tone: isPickup ? 'arrival' : 'departure',
                emphasis: 'text',
              }),
            )}
            aria-hidden="true"
          />
          <span className="font-semibold text-sm truncate">{directionLabel}</span>
          <Badge variant="secondary" className="shrink-0 ml-auto">
            {t('rides.passengers', { count: journey.legs.length })}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-2">
        {/* When the car meets */}
        <div className="flex items-center gap-2 text-sm">
          <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{meetDate}</span>
          <span className="text-muted-foreground">
            {t('rides.meetAt', { time: meetTime })}
          </span>
        </div>

        {/* Where it meets */}
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate" title={journey.location}>
            {journey.location}
          </span>
        </div>

        {/* When the driver has to set off — the whole reason a lead time exists */}
        {leaveTime !== '' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Timer className="size-4 shrink-0" aria-hidden="true" />
            <span>{t('rides.leaveAt', { time: leaveTime })}</span>
          </div>
        )}

        {/* Who drives */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <User className="size-4 shrink-0" aria-hidden="true" />
          {namesAChauffeur && journey.driver !== undefined ? (
            <>
              <span>{t('rides.driver')}:</span>
              <PersonBadge person={journey.driver} size="sm" />
            </>
          ) : (
            <span>{driverSummary}</span>
          )}
        </div>

        {/* Which car */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Car className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {journey.vehicle?.name ?? t('rides.noVehicle')}
          </span>
        </div>

        {/* Seats and child seats. Below the car it is measured against, so
            "4 people for 3 seats" reads as a sentence about the Espace rather
            than a number floating above it. Renders nothing when no car is
            chosen — an unmeasured car is not a car with no room in it. */}
        <RideCapacityBadge summary={capacity} />

        {/* A leg that has drifted out of the car's window, and the two ways
            out of it. The driver's alone: see `canResolveMismatch`. */}
        {canResolveMismatch && <RideMismatchNotice journey={journey} />}

        {/* Who is in it. A ride nobody has joined yet is a real state — the
            badge above already says so, and an empty bordered box would not. */}
        {journey.legs.length > 0 && (
        <ul className="border-t pt-2 space-y-1">
          {journey.legs.map((leg) => (
            <RidePassengerRow
              key={leg.transport.id}
              leg={leg}
              isDriver={
                journey.driver !== undefined &&
                leg.transport.personId === journey.driver.id
              }
              dateLocale={dateLocale}
              onEdit={onEditLeg}
              onDelete={onDeleteLeg}
              isActionsDisabled={isActionsDisabled}
            />
          ))}
        </ul>
        )}
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { RideCard };
