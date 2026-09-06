/**
 * @fileoverview Transport List Page - Displays arrivals and departures for a trip.
 * Shows transports in a single chronological list grouped by date.
 *
 * Route: /trips/:tripId/transports
 *
 * The list has two kinds of row, and only two:
 *
 * - **A car journey** (`RideCard`), with the legs riding in it nested inside
 *   it. Three guests landing at the same terminal within the hour used to be
 *   three unrelated cards that never mentioned one another, so the driver had
 *   to reconstruct the car in their head.
 * - **A leg travelling on its own** (`TransportCard`) — a transport with no
 *   ride and nobody driving it, rendered exactly as it always was.
 *
 * Which is which is decided by `resolveRides`, never here: the card, the
 * calendar, the map and the "time to leave" notification all read that one
 * function so they cannot disagree about the same car. A legacy `driverId`-only
 * transport therefore arrives as a one-passenger journey — nothing migrates
 * those rows, and the read is where the two storage shapes converge.
 *
 * Features:
 * - Single chronological list (no tabs)
 * - Date grouping with date headers
 * - Clear visual distinction between arrivals (green) and departures (orange)
 * - Transport cards with person badge, datetime, location, mode, and pickup indicator
 * - Edit/delete actions via dropdown menu
 * - Add transport action (FAB on mobile, header button on desktop)
 * - Empty state when no transports
 * - "Only mine" / "Everyone" scope filter, persisted in `?scope=`
 * - Responsive design
 *
 * @module features/transports/pages/TransportListPage
 */

import {
  type KeyboardEvent,
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { toast } from 'sonner';
import { useOfflineAwareToast } from '@/hooks';
import { type Locale, format, parseISO } from 'date-fns';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CarFront,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit,
  GripVertical,
  History,
  Map as MapIcon,
  MapPin,
  MoreVertical,
  Plane,
  Plus,
  Trash2,
  Unlink,
  User,
} from 'lucide-react';

import { useTripContext } from '@/contexts/TripContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { statusVariants } from '@/components/ui/status.variants';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { formatFullDate } from '@/lib/utils/date-format';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';
import { getTransportModeIcon } from '@/lib/utils/transport-icons';
import { DriverAlert } from '@/features/transports/components/DriverAlert';
import {
  createHeadcountResolver,
  type HeadcountResolver,
} from '@/features/rooms/utils/capacity-utils';
import {
  DroppableRide,
  type DroppableRideData,
} from '@/features/transports/components/DroppableRide';
import { RideCard } from '@/features/transports/components/RideCard';
import { RideDialog } from '@/features/transports/components/RideDialog';
import { RideChangeFeed } from '@/features/transports/components/RideChangeFeed';
import { TransportDialog } from '@/features/transports/components/TransportDialog';
import { TransportScopeFilter } from '@/features/transports/components/TransportScopeFilter';
import { UpcomingPickups } from '@/features/transports/components/UpcomingPickups';
import { useTransportScope } from '@/features/transports/hooks/useTransportScope';
import {
  collectDrivenRideIds,
  isLegCovered,
  isTransportUpcoming,
  selectPickupsNeedingDriver,
  toTransportInstant,
} from '@/features/transports/utils/pickup-utils';
import {
  type ResolvedRide,
  resolveRides,
  rideConcernsPerson,
} from '@/features/transports/utils/ride-model';
import type {
  Person,
  PersonId,
  RideId,
  Transport,
  TransportId,
  TransportType,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the TransportCard component.
 */
interface TransportCardProps {
  /** The transport to display */
  readonly transport: Transport;
  /** The person associated with this transport */
  readonly person: Person | undefined;
  /** The driver for pickup (if applicable) */
  readonly driver: Person | undefined;
  /** Callback when edit is clicked */
  readonly onEdit: (transportId: TransportId) => void;
  /** Callback when delete is clicked */
  readonly onDelete: (transportId: TransportId) => void;
  /** Date locale for formatting */
  readonly dateLocale: Locale;
  /** Whether actions are disabled */
  readonly isActionsDisabled?: boolean;
  /** Whether this transport is in the past */
  readonly isPast?: boolean;
  /**
   * The rides somebody has volunteered to drive, from `collectDrivenRideIds`.
   *
   * Passed in rather than read here so the badge and the page's amber alert
   * gate answer "is anybody driving this leg" from one index and one
   * definition. They briefly did not, and the page contradicted itself: the
   * panel vanished once Guillaume volunteered on the ride while Alice's own
   * card went on saying nobody was collecting her.
   */
  readonly drivenRideIds: ReadonlySet<string>;
  /**
   * Whether this leg can be dragged onto a ride.
   *
   * False when the trip has no ride to drag it to, so the handle is absent
   * rather than present and futile — and false outside a `DndContext`, where
   * `useDraggable` throws and this card is rendered on its own by tests.
   */
  readonly isDraggable?: boolean;
}

/**
 * One row of the list.
 *
 * A journey and a lone leg are different shapes with different cards, so the
 * list carries the discriminated union rather than two parallel arrays — the
 * two have to interleave chronologically inside a day.
 */
type TransportListEntry =
  | {
      readonly kind: 'ride';
      /** React key: the journey's id, which a legacy journey borrows from its leg. */
      readonly key: string;
      /** The instant this row is filed and sorted under — the meeting time. */
      readonly datetime: string;
      readonly journey: ResolvedRide;
    }
  | {
      readonly kind: 'leg';
      readonly key: string;
      readonly datetime: string;
      readonly transport: Transport;
    };

/**
 * A group of list entries for a single date.
 */
interface DateGroup {
  /** Date key (YYYY-MM-DD format) */
  readonly dateKey: string;
  /** Formatted date for display */
  readonly displayDate: string;
  /** Entries for this date, sorted by time */
  readonly entries: readonly TransportListEntry[];
}

/**
 * Props for the TransportList component.
 */
interface TransportListProps {
  /** Array of date groups for upcoming entries */
  readonly upcomingDateGroups: readonly DateGroup[];
  /** Array of date groups for past entries */
  readonly pastDateGroups: readonly DateGroup[];
  /** Total count of past entries — cards, not legs */
  readonly pastCount: number;
  /** Map of person ID to Person object */
  readonly personsMap: Map<PersonId, Person>;
  /** Callback when edit is clicked */
  readonly onEdit: (transportId: TransportId) => void;
  /** Callback when delete is clicked */
  readonly onDelete: (transportId: TransportId) => void;
  /** Date locale for formatting */
  readonly dateLocale: Locale;
  /** Accessible label for the list */
  readonly listLabel: string;
  /** Empty state message */
  readonly emptyTitle: string;
  /** Empty state description */
  readonly emptyDescription: string;
  /** Whether actions are disabled */
  readonly isActionsDisabled?: boolean;
  /** The rides somebody is driving, from `collectDrivenRideIds`. */
  readonly drivenRideIds: ReadonlySet<string>;
  /** How many people a guest row stands for — never assume one. */
  readonly resolveHeadcount: HeadcountResolver;
  /** The guest holding this device, so a car knows whose call it is. */
  readonly myPersonId: PersonId | undefined;
  /** Opens one car journey for editing. */
  readonly onEditRide: (rideId: RideId) => void;
  /** Asks to cancel one car journey. */
  readonly onDeleteRide: (rideId: RideId) => void;
  /**
   * Whether a lone leg can be dragged onto a ride.
   *
   * False when the trip has no ride at all: a handle that can only ever be
   * dropped on nothing is an invitation to a dead end.
   */
  readonly canDropOnRide: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extracts the date key (YYYY-MM-DD) from a datetime string.
 *
 * @param datetime - ISO datetime string
 * @returns Date key string or empty string on error
 */
function getDateKey(datetime: string): string {
  try {
    const parsedDate = parseISO(datetime);
    if (isNaN(parsedDate.getTime())) {return '';}
    return format(parsedDate, 'yyyy-MM-dd');
  } catch {
    return '';
  }
}

/**
 * Orders list entries chronologically by instant.
 *
 * Sorting by the raw string mis-orders mixed-offset values — see
 * `toTransportInstant`. An entry whose datetime cannot be parsed sorts last,
 * and ties break on the key so the order does not wobble between renders.
 *
 * @param entries - Entries to order (not mutated)
 * @returns A new array sorted earliest first
 */
function sortEntriesByInstant(
  entries: readonly TransportListEntry[],
): TransportListEntry[] {
  return [...entries].sort((a, b) => {
    const left = toTransportInstant(a.datetime),
      right = toTransportInstant(b.datetime);

    if (left === null) {
      return right === null ? a.key.localeCompare(b.key) : 1;
    }
    if (right === null) {
      return -1;
    }
    return left === right ? a.key.localeCompare(b.key) : left - right;
  });
}

/**
 * Groups list entries by date, sorted chronologically.
 *
 * @param entries - Entries to group
 * @param locale - date-fns locale for date formatting
 * @returns Array of date groups, each containing the entries for that date
 */
function groupEntriesByDate(
  entries: readonly TransportListEntry[],
  locale: Locale,
): DateGroup[] {
  // Create a map of date key to entries
  const groupsMap = new Map<string, TransportListEntry[]>();

  for (const entry of entries) {
    const dateKey = getDateKey(entry.datetime);
    if (!dateKey) {continue;}

    const existing = groupsMap.get(dateKey);
    if (existing) {
      existing.push(entry);
    } else {
      groupsMap.set(dateKey, [entry]);
    }
  }

  // Convert to array and sort by date key (chronological). Date keys are all
  // `yyyy-MM-dd`, so comparing them as strings is sound; the entries inside a
  // day are ordered by instant, because their datetimes may carry different UTC
  // offsets and would then sort by wall clock rather than by when they happen.
  const groups: DateGroup[] = Array.from(groupsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, dayEntries]) => ({
      dateKey,
      displayDate: formatFullDate(dateKey, locale),
      entries: sortEntriesByInstant(dayEntries),
    }));

  return groups;
}

/**
 * Splits a trip's transports into the rows the list draws.
 *
 * The partition is `resolveRides`' own: every leg it places in a journey is
 * covered by that journey's card, and what is left is a leg travelling alone —
 * no ride, nobody driving. Re-deriving that split here (say, by testing
 * `transport.rideId`) is exactly how a leg ends up rendered twice, or not at
 * all: a `rideId` naming a ride this device does not yet hold is not membership,
 * and `resolveRides` is the only place that knows it.
 *
 * @param journeys - The resolved journeys, already ordered by meeting time
 * @param transports - Every transport of the trip
 * @returns One entry per card, in no particular order (the grouping sorts them)
 */
function buildListEntries(
  journeys: readonly ResolvedRide[],
  transports: readonly Transport[],
): TransportListEntry[] {
  const covered = new Set<TransportId>(),
    entries: TransportListEntry[] = [];

  for (const journey of journeys) {
    for (const leg of journey.legs) {
      covered.add(leg.transport.id);
    }
    entries.push({
      kind: 'ride',
      key: journey.id,
      // A journey is filed under its meeting time — except when that time
      // cannot be placed at all, in which case the earliest leg's own datetime
      // stands in. Without the fallback a single unreadable `meetDatetime`
      // would drop the card out of every date group and take three perfectly
      // valid arrivals off the page with it.
      datetime:
        journey.meetAtMs === null
          ? (journey.legs[0]?.transport.datetime ?? journey.meetDatetime)
          : journey.meetDatetime,
      journey,
    });
  }

  for (const transport of transports) {
    if (!covered.has(transport.id)) {
      entries.push({
        kind: 'leg',
        key: transport.id,
        datetime: transport.datetime,
        transport,
      });
    }
  }

  return entries;
}

// ============================================================================
// Drag and Drop
// ============================================================================

/** What a dragged leg carries to the drop handler. */
interface DraggableLegData {
  /** The leg being moved into a car. */
  readonly transportId: TransportId;
}

/**
 * The prefix every dragged leg's id carries.
 *
 * Matched on rather than parsed: the id only has to be unique and recognisable
 * within the one `DndContext` this page owns, and the `transportId` travels in
 * `data` where it keeps its type.
 */
const LEG_DRAGGABLE_PREFIX = 'leg-drag-';

// ============================================================================
// TransportCard Component
// ============================================================================

/**
 * Individual transport card displaying transport details with actions.
 */
const TransportCard = memo(function TransportCard({
  transport,
  person,
  driver,
  onEdit,
  onDelete,
  dateLocale,
  isActionsDisabled = false,
  isPast = false,
  drivenRideIds,
  isDraggable = false,
}: TransportCardProps): ReactElement {
  const { t } = useTranslation(),

  // Format datetime for display
   { date, time } = useMemo(
    () => formatTransportDatetimeParts(transport.datetime, dateLocale, 'dayAndTime'),
    [transport.datetime, dateLocale],
  ),

  // Get transport mode icon
   ModeIcon = useMemo(
    () => getTransportModeIcon(transport.transportMode),
    [transport.transportMode],
  ),

  // Get transport type icon
   TypeIcon = transport.type === 'arrival' ? ArrowDownToLine : ArrowUpFromLine,

  // Handle edit click
   handleEdit = useCallback(() => {
    onEdit(transport.id);
  }, [transport.id, onEdit]),

  // Handle delete click
   handleDelete = useCallback(() => {
    onDelete(transport.id);
  }, [transport.id, onDelete]),

  // Handle keyboard activation for card
   handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleEdit();
      }
    },
    [handleEdit],
  ),

  // "Needs pickup" only while nobody is driving it — which since rides exist
  // means no legacy driver *and* no driven ride. `isLegCovered` is the single
  // definition, shared with the page's alert gate and the map popup.
   showNeedsPickupBadge =
    transport.needsPickup && !isLegCovered(transport, drivenRideIds),

  // The traveller driving their own leg. `resolveRides()` derives the same
  // thing for a real ride and calls it `isSelfDriven`; this is the legacy
  // shape of it, and the share wizard writes exactly that when a guest says
  // they will have a car of their own. Named as a driver, Alice would appear
  // on her own card as the person collecting Alice.
   isSelfDriven = driver !== undefined && driver.id === transport.personId,

  // Drag-and-drop onto a ride card. Called unconditionally — this card is only
  // ever rendered by the page, which wraps the whole list in a `DndContext` —
  // while `isDraggable` decides whether the handle that activates it exists.
   {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragNodeRef,
    setActivatorNodeRef,
    isDragging,
  } = useDraggable({
    id: `${LEG_DRAGGABLE_PREFIX}${transport.id}`,
    data: { transportId: transport.id } satisfies DraggableLegData,
  }),

  // Build aria-label for accessibility
   ariaLabel = useMemo(() => {
    const parts = [
      transport.type === 'arrival' ? t('transports.arrival') : t('transports.departure'),
      person?.name ?? t('common.unknown'),
      date,
      time,
      transport.location,
    ];
    if (showNeedsPickupBadge) {
      parts.push(t('transports.needsPickup'));
    }
    if (isSelfDriven) {
      parts.push(t('rides.selfDriven'));
    } else if (driver) {
      parts.push(`${t('transports.driver')}: ${driver.name}`);
    }
    return parts.filter(Boolean).join(', ');
  }, [transport, person, driver, date, time, t, showNeedsPickupBadge, isSelfDriven]);

  return (
    <Card
      ref={setDragNodeRef}
      role="article"
      tabIndex={0}
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        'transition-all duration-200',
        'hover:shadow-md hover:border-primary/20',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        // A guest's own leg, drawn flat and bordered. The car journeys it can
        // join are the tinted, accented cards — see `RideCard`. Two rows that
        // mean different things must not look the same.
        'border-dashed',
        // Past transport styling - dimmed appearance
        isPast && 'opacity-60',
        isDragging && 'opacity-40',
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          {/* Person badge and type indicator */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <TypeIcon
              className={cn(
                'size-5 shrink-0',
                statusVariants({ tone: transport.type, emphasis: 'text' }),
              )}
              aria-hidden="true"
            />
            {person ? (
              <PersonBadge person={person} size="default" />
            ) : (
              <Badge variant="secondary" className="text-muted-foreground">
                {t('common.unknown')}
              </Badge>
            )}
            {/* Smart pickup indicator: show "needs pickup" only when no driver assigned */}
            {showNeedsPickupBadge && (
              <Badge
                variant="outline"
                className={cn('shrink-0', statusVariants({ tone: 'warning' }))}
              >
                {t('transports.needsPickup')}
              </Badge>
            )}
            {/* Show driver badge when driver is assigned (pickup resolved) —
                unless the driver is the traveller, which is not a pickup being
                resolved but somebody getting themselves there. */}
            {driver && !isSelfDriven && transport.needsPickup && (
              <Badge
                variant="outline"
                className={cn('shrink-0', statusVariants({ tone: 'success' }))}
              >
                {t('transports.driver')}: {driver.name}
              </Badge>
            )}
          </div>

          {/*
            No car. Distinct from "needs pickup", which is a request the guest
            made: this says only that the leg is in no car, which is equally
            true of somebody who never asked for one. Both can be on the card at
            once, and they answer different questions.

            An icon with a real accessible name, not a bare glyph — the whole
            statement is "nobody is carrying this" and a decorative pictogram
            would put it out of reach of a screen reader.
          */}
          {!isLegCovered(transport, drivenRideIds) && transport.rideId === undefined && (
            <span
              className="shrink-0 text-muted-foreground"
              title={t('transports.noRideYet')}
            >
              <Unlink className="size-4" aria-hidden="true" />
              <span className="sr-only">{t('transports.noRideYet')}</span>
            </span>
          )}

          {/*
            The drag handle, not the whole card. A card carries a menu, a
            person badge and selectable text, and making all of it draggable
            takes those away; a handle is also the only visible clue that this
            can be dragged at all.

            Dragging is never the only way in: the same move is the Ride select
            in this leg's own dialog, which is where a keyboard reaches it.
          */}
          {isDraggable && (
            <Button
              ref={setActivatorNodeRef}
              variant="ghost"
              size="icon"
              className="md:size-8 shrink-0 cursor-grab touch-none active:cursor-grabbing"
              disabled={isActionsDisabled}
              aria-label={t('transports.dragToRide')}
              {...dragAttributes}
              {...dragListeners}
            >
              <GripVertical className="size-5 md:size-4" aria-hidden="true" />
            </Button>
          )}

          {/* Actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:size-8 shrink-0"
                disabled={isActionsDisabled}
                aria-label={t('common.actions', 'Actions')}
              >
                <MoreVertical className="size-5 md:size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleEdit}>
                <Edit className="size-4" aria-hidden="true" />
                {t('common.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={handleDelete}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-2">
        {/* Date and time */}
        <div className="flex items-center gap-2 text-sm">
          <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{date}</span>
          <span className="text-muted-foreground">{time}</span>
        </div>

        {/* Location */}
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate" title={transport.location}>
            {transport.location}
          </span>
        </div>

        {/* Transport mode and number */}
        {(transport.transportMode ?? transport.transportNumber) && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ModeIcon className="size-4 shrink-0" aria-hidden="true" />
            {transport.transportMode && (
              <span>{t(`transports.modes.${transport.transportMode}`)}</span>
            )}
            {transport.transportNumber && (
              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                {transport.transportNumber}
              </span>
            )}
          </div>
        )}

        {/* Somebody is driving this leg, and it is the traveller themselves. */}
        {isSelfDriven && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="size-4 shrink-0" aria-hidden="true" />
            <span>{t('rides.selfDriven')}</span>
          </div>
        )}

        {/* Driver - only show in content if not already shown in badge (badge shown when needsPickup is true) */}
        {driver && !isSelfDriven && !transport.needsPickup && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="size-4 shrink-0" aria-hidden="true" />
            <span>{t('transports.driver')}:</span>
            <PersonBadge person={driver} size="sm" />
          </div>
        )}

        {/* Notes */}
        {transport.notes && (
          <p className="text-sm text-muted-foreground italic line-clamp-2">
            {transport.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
});

// ============================================================================
// DateGroupSection Component
// ============================================================================

/**
 * Props for the DateGroupSection component.
 */
interface DateGroupSectionProps {
  /** The date group to render */
  readonly group: DateGroup;
  /** Map of person ID to Person object */
  readonly personsMap: Map<PersonId, Person>;
  /** Callback when edit is clicked */
  readonly onEdit: (transportId: TransportId) => void;
  /** Callback when delete is clicked */
  readonly onDelete: (transportId: TransportId) => void;
  /** Date locale for formatting */
  readonly dateLocale: Locale;
  /** Whether actions are disabled */
  readonly isActionsDisabled?: boolean;
  /** Whether the entries in this group are past */
  readonly isPast?: boolean;
  /** The rides somebody is driving, from `collectDrivenRideIds`. */
  readonly drivenRideIds: ReadonlySet<string>;
  /** How many people a guest row stands for — never assume one. */
  readonly resolveHeadcount: HeadcountResolver;
  /** The guest holding this device, so a car knows whose call it is. */
  readonly myPersonId: PersonId | undefined;
  /** Opens one car journey for editing. */
  readonly onEditRide: (rideId: RideId) => void;
  /** Asks to cancel one car journey. */
  readonly onDeleteRide: (rideId: RideId) => void;
  /**
   * Whether a lone leg can be dragged onto a ride.
   *
   * False when the trip has no ride at all: a handle that can only ever be
   * dropped on nothing is an invitation to a dead end.
   */
  readonly canDropOnRide: boolean;
}

/**
 * Renders a single date group with its transports.
 */
const DateGroupSection = memo(function DateGroupSection({
  group,
  personsMap,
  onEdit,
  onDelete,
  dateLocale,
  isActionsDisabled = false,
  isPast = false,
  drivenRideIds,
  resolveHeadcount,
  myPersonId,
  onEditRide,
  onDeleteRide,
  canDropOnRide,
}: DateGroupSectionProps): ReactElement {
  return (
    <section key={group.dateKey} aria-labelledby={`date-header-${group.dateKey}`}>
    {/* Date header */}
    <h2
      id={`date-header-${group.dateKey}`}
      className={cn(
        'text-sm font-semibold uppercase tracking-wide mb-3 px-1',
        isPast ? 'text-muted-foreground/60' : 'text-muted-foreground',
      )}
    >
      {group.displayDate}
    </h2>
    
    {/* Transports grid for this date */}
    <div
      className={cn(
        'grid gap-4',
        'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
      )}
    >
      {group.entries.map((entry) => {
        if (entry.kind === 'ride') {
          const card = (
            <RideCard
                journey={entry.journey}
                dateLocale={dateLocale}
                drivenRideIds={drivenRideIds}
                resolveHeadcount={resolveHeadcount}
                canResolveMismatch={
                  myPersonId !== undefined && entry.journey.driverId === myPersonId
                }
                onEditRide={onEditRide}
                onDeleteRide={onDeleteRide}
              onEditLeg={onEdit}
              onDeleteLeg={onDelete}
              isActionsDisabled={isActionsDisabled}
              isPast={isPast}
            />
          );

          return (
            <div key={entry.key} role="listitem">
              {/*
                Only a real `Ride` accepts a drop. A legacy `driverId`-only
                journey is drawn like one so the list has a single shape, but it
                has no row to point a leg's `rideId` at.
              */}
              {entry.journey.ride === undefined ? (
                card
              ) : (
                <DroppableRide rideId={entry.journey.ride.id}>{card}</DroppableRide>
              )}
            </div>
          );
        }

        // A leg reaching this branch has nobody driving it — `resolveRides`
        // took every driven one into a journey above — so this card's driver
        // and its `isLegCovered` badge both answer "nobody" today. Both are
        // still asked rather than assumed, so the card degrades honestly if
        // that partition ever widens.
        const { transport } = entry,
         person = personsMap.get(transport.personId),
         driver = transport.driverId
          ? personsMap.get(transport.driverId)
          : undefined;

        return (
          <div key={entry.key} role="listitem">
            <TransportCard
              transport={transport}
              person={person}
              driver={driver}
              onEdit={onEdit}
              onDelete={onDelete}
              dateLocale={dateLocale}
              isActionsDisabled={isActionsDisabled}
              isPast={isPast}
              drivenRideIds={drivenRideIds}
              isDraggable={canDropOnRide}
            />
          </div>
        );
      })}
    </div>
  </section>
  );
});

// ============================================================================
// TransportList Component
// ============================================================================

/**
 * List of transport cards grouped by date with date headers.
 * Includes collapsible section for past transports.
 */
const TransportList = memo(function TransportList({
  upcomingDateGroups,
  pastDateGroups,
  pastCount,
  personsMap,
  onEdit,
  onDelete,
  dateLocale,
  listLabel,
  emptyTitle,
  emptyDescription,
  isActionsDisabled = false,
  drivenRideIds,
  resolveHeadcount,
  myPersonId,
  onEditRide,
  onDeleteRide,
  canDropOnRide,
}: TransportListProps): ReactElement {
  const { t } = useTranslation();
  
  // State for past transports collapsible section
  const [isPastExpanded, setIsPastExpanded] = useState(false);
  
  // Toggle past section visibility
  const togglePastSection = useCallback(() => {
    setIsPastExpanded((prev) => !prev);
  }, []);

  // Render empty state if no transports at all
  if (upcomingDateGroups.length === 0 && pastDateGroups.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <EmptyState
          icon={Plane}
          title={emptyTitle}
          description={emptyDescription}
        />
      </div>
    );
  }

  return (
    <div
      role="list"
      aria-label={listLabel}
      // Bottom clearance is `<main>`'s job (`pb-bottom-stack`), not this list's.
      className="space-y-6"
    >
      {/* Upcoming transports */}
      {upcomingDateGroups.map((group) => (
        <DateGroupSection
          key={group.dateKey}
          group={group}
          personsMap={personsMap}
          onEdit={onEdit}
          onDelete={onDelete}
          dateLocale={dateLocale}
          isActionsDisabled={isActionsDisabled}
          isPast={false}
          drivenRideIds={drivenRideIds}
          resolveHeadcount={resolveHeadcount}
          myPersonId={myPersonId}
          onEditRide={onEditRide}
          onDeleteRide={onDeleteRide}
          canDropOnRide={canDropOnRide}
        />
      ))}

      {/* Past transports - collapsible section */}
      {pastCount > 0 && (
        <div className="border-t pt-4 mt-6">
          {/* Past section toggle button */}
          <button
            type="button"
            onClick={togglePastSection}
            className={cn(
              'flex items-center gap-2 w-full text-left',
              'text-sm font-semibold text-muted-foreground',
              'hover:text-foreground transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md',
              'py-2 px-1',
            )}
            aria-expanded={isPastExpanded}
            aria-controls="past-transports-section"
          >
            {isPastExpanded ? (
              <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
            )}
            <History className="size-4 shrink-0" aria-hidden="true" />
            <span>
              {t('transports.pastTransports', 'Past transports')} ({pastCount})
            </span>
          </button>

          {/* Past transports content - shown when expanded */}
          {isPastExpanded && (
            <div id="past-transports-section" className="mt-4 space-y-6">
              {pastDateGroups.map((group) => (
                <DateGroupSection
                  key={group.dateKey}
                  group={group}
                  personsMap={personsMap}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  dateLocale={dateLocale}
                  isActionsDisabled={isActionsDisabled}
                  isPast={true}
                  drivenRideIds={drivenRideIds}
                  resolveHeadcount={resolveHeadcount}
                  myPersonId={myPersonId}
                  onEditRide={onEditRide}
                  onDeleteRide={onDeleteRide}
                  canDropOnRide={canDropOnRide}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// TransportListPage Component
// ============================================================================

/**
 * Main transport list page component.
 * Displays arrivals and departures in a single chronological list grouped by date.
 *
 * @example
 * ```tsx
 * // In router configuration
 * { path: '/trips/:tripId/transports', element: <TransportListPage /> }
 * ```
 */
const TransportListPage = memo(function TransportListPage(): ReactElement {
  const { t, i18n } = useTranslation(),
   navigate = useNavigate(),
   { tripId: tripIdFromUrl } = useParams<'tripId'>(),

  // Context hooks
   { successToast } = useOfflineAwareToast(),

   { currentTrip, isLoading: isTripLoading, setCurrentTrip } = useTripContext(),
   { persons, isLoading: isPersonsLoading } = usePersonContext(),
   {
    arrivals,
    departures,
    upcomingPickups,
    nowMs,
    isLoading: isTransportsLoading,
    error: transportsError,
    deleteTransport,
  } = useTransportContext(),
   // Same reason as the panel: a driven ride covers its legs. The list also
   // draws those rides, so it takes the cars along with them — and gates on the
   // ride load, because a paint before they arrive filters against no cars at
   // all and flags every ride-covered pickup as driverless.
   {
     rides,
     vehicles,
     deleteRide,
     setTransportRide,
     isLoading: isRidesLoading,
   } = useRideContext(),

  // Local state
   [transportToDelete, setTransportToDelete] = useState<TransportId | null>(null),

  // Dialog state for create/edit transport
   [isDialogOpen, setIsDialogOpen] = useState(false),
   [editingTransportId, setEditingTransportId] = useState<TransportId | undefined>(undefined),
   [defaultTransportType, setDefaultTransportType] = useState<TransportType>('arrival'),

  // Dialog state for create/edit ride. Kept apart from the transport dialog
  // rather than folded into it: a car journey and a guest's own leg are
  // different rows with different fields, and one dialog switching shape on a
  // mode flag is how both halves end up half-tested.
   [isRideDialogOpen, setIsRideDialogOpen] = useState(false),
   [editingRideId, setEditingRideId] = useState<RideId | undefined>(undefined),
   [rideToDelete, setRideToDelete] = useState<RideId | null>(null),

  // Track if we're currently navigating to prevent double-clicks
   isNavigatingRef = useRef(false),

  // Combined loading state. The rides are part of it: until they land,
  // `drivenRideIds` is empty, so a paint taken before that flags every
  // ride-covered pickup as needing a driver — the contradiction the ids were
  // added to remove — and the scope filter resolves no cars, hiding the legs
  // sharing mine.
   isLoading =
    isTripLoading || isPersonsLoading || isTransportsLoading || isRidesLoading,

  // Get date locale based on current language
   dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]),

  // Build persons map for O(1) lookups
   personsMap = useMemo(() => {
    const map = new Map<PersonId, Person>();
    for (const person of persons) {
      map.set(person.id, person);
    }
    return map;
  }, [persons]),

  // Combine arrivals and departures into a single list
   allTransports = useMemo(() => [...arrivals, ...departures], [arrivals, departures]),

  // The one read of the journey model. Everything below — which rows exist,
  // when each is filed, what a card draws — comes from this, so the list, the
  // map and the notifications cannot disagree about the same car.
   journeys = useMemo(
    () => resolveRides({ transports: allTransports, rides, vehicles, persons }),
    [allTransports, rides, vehicles, persons],
  ),

  // "Only mine" versus the whole trip's logistics, persisted in `?scope=`.
  // Shared with the map so the two views can never disagree about which rows
  // concern the guest holding this device.
   {
    scope,
    canFilter: canFilterScope,
    myPersonId,
    visibleTransports,
    hiddenCount,
    setScope,
  } = useTransportScope(allTransports),

  // What the summary above the list counts. Filtered, because "3 arrivals"
  // over a list showing one is a lie the user has no way to resolve.
   visibleCounts = useMemo(() => {
    let arrivalCount = 0,
      departureCount = 0;

    for (const transport of visibleTransports) {
      if (transport.type === 'arrival') {
        arrivalCount += 1;
      } else {
        departureCount += 1;
      }
    }

    return { arrivalCount, departureCount };
  }, [visibleTransports]),

  // The trip has travel; none of it is mine. Saying "No travel plans yet" here
  // would be false, and false in the direction that reads as data loss — the
  // map says the same thing with the same words.
   isScopedToNothing =
    scope === 'mine' && visibleTransports.length === 0 && allTransports.length > 0,

   visibleTransportIds = useMemo(
    () => new Set(visibleTransports.map((transport) => transport.id)),
    [visibleTransports],
  ),

  // The scope filter is applied to the *journeys*, not to the flat leg list.
  // A car is shown when any leg it carries concerns me, or when I am driving
  // it — hiding one passenger's leg must not hide the car the other two are
  // still sitting in, and a ride I drive but have no leg on is still mine.
   listEntries = useMemo(() => {
    const entries = buildListEntries(journeys, allTransports);

    if (scope === 'all' || myPersonId === undefined) {
      return entries;
    }

    return entries.filter((entry) =>
      entry.kind === 'ride'
        ? rideConcernsPerson(entry.journey, myPersonId) ||
          entry.journey.legs.some((leg) => visibleTransportIds.has(leg.transport.id))
        : visibleTransportIds.has(entry.transport.id),
    );
  }, [journeys, allTransports, scope, visibleTransportIds, myPersonId]),

  // Separate upcoming and past entries against the context's single reference
  // instant, so this split and the pickup alerts agree — and so the list ages
  // on the same minute tick instead of only when something else happens to
  // re-render it. A journey is filed by its meeting time, not by its earliest
  // leg: the car is what the row is about.
   { upcomingEntries, pastEntries } = useMemo(() => {
    const upcoming: TransportListEntry[] = [];
    const past: TransportListEntry[] = [];

    for (const entry of listEntries) {
      if (isTransportUpcoming(entry.datetime, nowMs)) {
        upcoming.push(entry);
      } else {
        past.push(entry);
      }
    }

    return { upcomingEntries: upcoming, pastEntries: past };
  }, [listEntries, nowMs]),

  // Group upcoming entries by date (chronological)
   upcomingDateGroups = useMemo(
    () => groupEntriesByDate(upcomingEntries, dateLocale),
    [upcomingEntries, dateLocale],
  ),

  // Group past entries by date (reverse chronological - most recent first)
   pastDateGroups = useMemo(
    () => groupEntriesByDate(pastEntries, dateLocale).reverse(),
    [pastEntries, dateLocale],
  ),

  // Count what the accordion actually renders: `groupEntriesByDate` drops rows
  // whose datetime cannot be parsed, so counting `pastEntries` promised more
  // entries than the section could show.
   pastCount = useMemo(
    () => pastDateGroups.reduce((total, group) => total + group.entries.length, 0),
    [pastDateGroups],
  ),

  // Amber pickup alerts only when at least one upcoming pickup still needs a
  // driver — same selection the panel counts and the analytics badge reports.
   hasUnassignedUpcomingPickup = useMemo(
    () => selectPickupsNeedingDriver(upcomingPickups, rides).length > 0,
    [upcomingPickups, rides],
  ),

  // Built once for the whole page: every card asks whether somebody is driving
  // its leg, and the answer must be the same one the alert gate above used.
   drivenRideIds = useMemo(() => collectDrivenRideIds(rides), [rides]),

  // How many people a guest row stands for. One resolver for the page, so the
  // ride cards and the capacity chips on them cannot disagree about whether
  // "Alice+Auré" is one person or two.
   headcountOf = useMemo(() => createHeadcountResolver(persons), [persons]),

  // A short drag before the pointer takes over, and a hold before touch does,
  // so a tap on the handle is still a tap and a scroll is still a scroll. Same
  // thresholds the rooms timeline settled on.
   dragSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // Sync URL tripId with context - if URL has a tripId but context doesn't match, update context
  useEffect(() => {
    if (tripIdFromUrl && !isTripLoading && currentTrip?.id !== tripIdFromUrl) {
      setCurrentTrip(tripIdFromUrl).catch((err) => {
        console.error('Failed to set current trip from URL:', err);
      });
    }
  }, [tripIdFromUrl, currentTrip?.id, isTripLoading, setCurrentTrip]);

  // Validate tripId matches current trip
  const tripMismatch = useMemo(() => {
    if (!tripIdFromUrl || !currentTrip) {return false;}
    return tripIdFromUrl !== currentTrip.id;
  }, [tripIdFromUrl, currentTrip]),

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles edit transport click - opens the transport edit dialog.
   */
   handleEdit = useCallback(
    (transportId: TransportId) => {
      if (isNavigatingRef.current) {return;}
      setEditingTransportId(transportId);
      setIsDialogOpen(true);
    },
    [],
  ),

  /**
   * Opens delete confirmation dialog.
   */
   handleDeleteClick = useCallback((transportId: TransportId) => {
    setTransportToDelete(transportId);
  }, []),

  /**
   * Confirms and executes transport deletion.
   * Note: Loading state is managed by ConfirmDialog internally.
   */
   handleConfirmDelete = useCallback(async () => {
    if (!transportToDelete) {return;}

    try {
      await deleteTransport(transportToDelete);
      setTransportToDelete(null);
      successToast(t('transports.deleteSuccess', 'Transport deleted successfully'));
    } catch (error) {
      // Log for debugging, show user-friendly error via toast
      console.error('Failed to delete transport:', error);
      toast.error(t('errors.deleteFailed', 'Failed to delete'));
      throw error; // Re-throw to keep dialog open for retry
    }
  }, [transportToDelete, deleteTransport, t, successToast]),

  /**
   * Closes delete confirmation dialog.
   */
   handleCancelDelete = useCallback((open: boolean) => {
    if (!open) {
      setTransportToDelete(null);
    }
  }, []),

  /**
   * Puts a dragged leg into the car it was dropped on.
   *
   * `setTransportRide` is the one writer for membership: it sets the leg's
   * scalar `rideId` and clears the legacy `driverId`, so a leg never names two
   * people collecting it. Nothing is written to the ride — it holds no
   * passenger list, deliberately, so two guests joining the same car offline
   * both survive the merge.
   */
   handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const legData = event.active.data.current as DraggableLegData | undefined,
        rideData = event.over?.data.current as DroppableRideData | undefined;

      // Dropped on nothing, or on something that is not a ride.
      if (legData?.transportId === undefined || rideData?.rideId === undefined) {
        return;
      }

      void setTransportRide(legData.transportId, rideData.rideId)
        .then(() => {
          successToast(t('transports.addedToRide'));
        })
        .catch((error: unknown) => {
          console.error('Failed to put the leg in the ride:', error);
          toast.error(t('errors.saveFailed'));
        });
    },
    [setTransportRide, successToast, t],
  ),

  /**
   * Handles add transport button click - opens the create transport dialog.
   */
   handleAddTransport = useCallback(() => {
    setEditingTransportId(undefined); // Clear editing transport ID for create mode
    setDefaultTransportType('arrival'); // Default to arrival for new transports
    setIsDialogOpen(true);
  }, []),

  /**
   * Opens the ride dialog in create mode.
   *
   * A pickup arranged from here starts empty and is filled by the legs that
   * join it — membership lives on the leg's `rideId`, never on a list held by
   * the ride, so there is nothing to pick here and nothing to keep in step.
   */
   handleAddRide = useCallback(() => {
    setEditingRideId(undefined);
    setIsRideDialogOpen(true);
  }, []),

  /**
   * Opens one car journey for editing.
   */
   handleEditRide = useCallback((rideId: RideId) => {
    if (isNavigatingRef.current) {return;}
    setEditingRideId(rideId);
    setIsRideDialogOpen(true);
  }, []),

  /**
   * Opens the confirmation for cancelling a car journey.
   */
   handleDeleteRideClick = useCallback((rideId: RideId) => {
    setRideToDelete(rideId);
  }, []),

  /**
   * Cancels the car journey, leaving its passengers' own legs alone.
   *
   * `deleteRide` clears the `rideId` of every leg pointing at it, so the guests
   * keep their arrivals and simply stop being in a car. Deleting their legs too
   * would throw away the fact that they are still turning up.
   */
   handleConfirmDeleteRide = useCallback(async () => {
    if (!rideToDelete) {return;}

    try {
      await deleteRide(rideToDelete);
      setRideToDelete(null);
      successToast(t('rides.deleteSuccess'));
    } catch (error) {
      console.error('Failed to delete ride:', error);
      toast.error(t('errors.deleteFailed', 'Failed to delete'));
      throw error; // Re-thrown so the dialog stays open for a retry
    }
  }, [rideToDelete, deleteRide, t, successToast]),

  /**
   * Closes the ride delete confirmation.
   */
   handleCancelDeleteRide = useCallback((open: boolean) => {
    if (!open) {
      setRideToDelete(null);
    }
  }, []),

  /**
   * Closes the ride dialog and forgets what was being edited.
   */
   handleRideDialogOpenChange = useCallback((open: boolean) => {
    setIsRideDialogOpen(open);
    if (!open) {
      setEditingRideId(undefined);
    }
  }, []),

  /**
   * Handles back navigation.
   */
   handleBack = useCallback(() => {
    navigate(`/trips/${tripIdFromUrl}/calendar`);
  }, [navigate, tripIdFromUrl]),

  /**
   * Handles navigation to map view.
   */
   handleOpenMap = useCallback(() => {
    navigate(`/trips/${tripIdFromUrl}/transports/map`);
  }, [navigate, tripIdFromUrl]),

  /**
   * Handles navigation to the trip's cars.
   *
   * This button is the only way in. The cars are not in the main navigation:
   * a car exists to be picked on a ride, and nobody sets out to manage one for
   * its own sake, so it lives under the transport list that uses it.
   */
   handleOpenCars = useCallback(() => {
    navigate(`/trips/${tripIdFromUrl}/transports/vehicles`);
  }, [navigate, tripIdFromUrl]),

  /**
   * Handles dialog close - resets editing state.
   */
   handleDialogOpenChange = useCallback((open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingTransportId(undefined);
    }
  }, []),

  // ============================================================================
  // Header Action (desktop buttons)
  // ============================================================================

   headerAction = useMemo(
    () => (
      /*
        Four controls, and only one of them is hidden on a phone.

        "New transport" stays desktop-only because the FAB below already is
        that button on a small screen, and two of the same control is worse
        than none. The other three have no mobile equivalent at all, so they
        drop their labels rather than themselves — "Cars" in particular is the
        single way into a page that is deliberately not in the navigation.
      */
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" onClick={handleOpenCars}>
          <CarFront className="size-4 sm:mr-2" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">{t('vehicles.title')}</span>
        </Button>
        <Button variant="outline" onClick={handleOpenMap}>
          <MapIcon className="size-4 sm:mr-2" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">
            {t('transports.mapView', 'Map view')}
          </span>
        </Button>
        <Button variant="outline" onClick={handleAddRide}>
          <Plus className="size-4 mr-2" aria-hidden="true" />
          {t('rides.new')}
        </Button>
        <Button className="hidden sm:inline-flex" onClick={handleAddTransport}>
          <Plus className="size-4 mr-2" aria-hidden="true" />
          {t('transports.new')}
        </Button>
      </div>
    ),
    [handleAddRide, handleAddTransport, handleOpenCars, handleOpenMap, t],
  );

  // ============================================================================
  // Render: Loading State
  // ============================================================================

  if (isLoading) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('transports.title')}
          backLink={tripIdFromUrl ? `/trips/${tripIdFromUrl}/calendar` : '/trips'}
        />
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
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
        <PageHeader title={t('transports.title')} backLink="/trips" />
        <div className="flex-1 flex items-center justify-center min-h-[200px]">
          <EmptyState
            icon={Plane}
            title={t('errors.tripNotFound', 'Trip not found')}
            description={t(
              'errors.tripNotFoundDescription',
              'The trip you are looking for does not exist or you do not have access to it.',
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
          title={t('transports.title')}
          backLink={`/trips/${tripIdFromUrl}/calendar`}
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
  // Render: Main Content - Single Chronological List
  // ============================================================================

  return (
    <div className="container max-w-4xl py-6 md:py-8">
      <PageHeader
        title={t('transports.title')}
        backLink={`/trips/${tripIdFromUrl}/calendar`}
        action={headerAction}
      />

      {/* Whose travel this page is showing, and what that is hiding */}
      <TransportScopeFilter
        scope={scope}
        canFilter={canFilterScope}
        hiddenCount={hiddenCount}
        onScopeChange={setScope}
      />

      {/* Transport count summary */}
      {allTransports.length > 0 && (
        <div className="flex items-center gap-4 mb-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <ArrowDownToLine
              className={cn('size-4', statusVariants({ tone: 'arrival', emphasis: 'text' }))}
              aria-hidden="true"
            />
            <span>
              {t('transports.arrivalsCount', {
                count: visibleCounts.arrivalCount,
                defaultValue_one: '{{count}} arrival',
                defaultValue_other: '{{count}} arrivals',
              })}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <ArrowUpFromLine
              className={cn('size-4', statusVariants({ tone: 'departure', emphasis: 'text' }))}
              aria-hidden="true"
            />
            <span>
              {t('transports.departuresCount', {
                count: visibleCounts.departureCount,
                defaultValue_one: '{{count}} departure',
                defaultValue_other: '{{count}} departures',
              })}
            </span>
          </div>
        </div>
      )}

      {/*
        Three bands of news, in the order a driver has to read them.

        What *moved* comes first. "Leave now" is computed from a meeting time,
        and a driver who reads the banner before the feed leaves for a pickup
        that has since been pushed to 19:00. Then the driver's own departure
        banner — a car this device is already driving is news. Then the panel
        below, which asks for volunteers: a car still looking for anybody has
        been looking all along, so it is a request rather than news.

        Both render nothing when they have nothing to say, so on most visits
        this costs two empty nodes.

        In the page flow rather than fixed: a fixed overlay eats every tap
        underneath it, and the nav bar, the FAB and the toasts already share
        the bottom edge.
      */}
      <RideChangeFeed className="mb-6" />
      <DriverAlert className="mb-6" />

      {/* Pickup alerts section - only when a driver is still needed */}
      {hasUnassignedUpcomingPickup && (
        <div
          className={cn(
            statusVariants({ tone: 'warning', emphasis: 'surface' }),
            'mb-6 rounded-xl border-2 bg-warning-surface/40 p-4',
          )}
        >
          <UpcomingPickups />
        </div>
      )}

      {/*
        Single chronological list grouped by date with collapsible past section.

        Wrapped in a `DndContext` so a leg's handle can be dropped on a ride
        card. The context is here rather than around the whole page because
        nothing outside this list drags or accepts a drop, and a context that
        spans more than it needs makes every pointer event its business.
      */}
      <DndContext sensors={dragSensors} onDragEnd={handleDragEnd}>
      <TransportList
        upcomingDateGroups={upcomingDateGroups}
        pastDateGroups={pastDateGroups}
        pastCount={pastCount}
        personsMap={personsMap}
        onEdit={handleEdit}
        onDelete={handleDeleteClick}
        dateLocale={dateLocale}
        listLabel={t('transports.title')}
        emptyTitle={isScopedToNothing ? t('transports.scope.empty') : t('transports.empty')}
        emptyDescription={
          isScopedToNothing
            ? t('transports.scope.emptyDescription')
            : t('transports.emptyDescription')
        }
        drivenRideIds={drivenRideIds}
        resolveHeadcount={headcountOf}
        myPersonId={myPersonId}
        onEditRide={handleEditRide}
        onDeleteRide={handleDeleteRideClick}
        canDropOnRide={rides.length > 0}
      />
      </DndContext>

      {/* Floating Action Button for mobile */}
      <Button
        onClick={handleAddTransport}
        size="lg"
        className={cn(
          'fixed bottom-nav-safe right-4 z-10',
          'size-14 rounded-full shadow-lg',
          'sm:hidden',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
        aria-label={t('transports.new')}
      >
        <Plus className="size-6" aria-hidden="true" />
      </Button>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={transportToDelete !== null}
        onOpenChange={handleCancelDelete}
        title={t('confirm.deleteTransport')}
        description={t('confirm.deleteTransportDescription')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />

      {/* Ride Cancel Confirmation Dialog */}
      <ConfirmDialog
        open={rideToDelete !== null}
        onOpenChange={handleCancelDeleteRide}
        title={t('confirm.deleteRide')}
        description={t('confirm.deleteRideDescription')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={handleConfirmDeleteRide}
      />

      {/* Ride Create/Edit Dialog */}
      <RideDialog
        rideId={editingRideId}
        open={isRideDialogOpen}
        onOpenChange={handleRideDialogOpenChange}
      />

      {/* Transport Create/Edit Dialog */}
      <TransportDialog
        transportId={editingTransportId}
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        defaultType={defaultTransportType}
      />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TransportListPage };
export default TransportListPage;
