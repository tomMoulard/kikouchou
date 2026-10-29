/**
 * @fileoverview A live, read-only view of the current trip, drawn inside an
 * assistant answer.
 *
 * Each view reuses the component its own page draws, fed from the same
 * contexts, so the chat shows what the page shows. Nothing here writes: a tap
 * on a stay, an activity or the "Open" link goes to the page, where the edit
 * controls and the access checks live.
 *
 * @module features/assistant/components/AssistantTripView
 */

import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BedDouble,
  CalendarDays,
  Car,
  ChevronRight,
  PartyPopper,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { statusVariants } from '@/components/ui/status.variants';

import { ActivityAgenda } from '@/features/activities/components/ActivityAgenda';
import { CalendarTimeline } from '@/features/calendar/components/CalendarTimeline';
import { BalancesCard } from '@/features/money/components/BalancesCard';
import { loadTripMoney } from '@/features/money/lib/trip-money';
import { RoomOccupancyTimeline } from '@/features/rooms/components/RoomOccupancyTimeline';
import {
  resolveRides,
  selectRideByLeg,
} from '@/features/transports/utils/ride-model';

import { OPENED_FROM_ASSISTANT } from '@/hooks/useSampleTripViewReport';
import { useToday } from '@/hooks/useToday';

import { useActivityContext } from '@/contexts/ActivityContext';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';

import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';

import type { Trip } from '@/types';

import type { AssistantView } from '../views';

// ============================================================================
// Type Definitions
// ============================================================================

interface AssistantTripViewProps {
  readonly view: AssistantView;
}

interface TripViewBodyProps {
  readonly trip: Trip;
  /** Goes to the view's own page, where a tap can do something. */
  readonly onOpenPage: () => void;
}

// ============================================================================
// Constants
// ============================================================================

/** The trip page each view comes from, under `/trips/:tripId/`. */
const VIEW_PAGES: Readonly<Record<AssistantView, string>> = {
  planning: 'calendar',
  rooms: 'rooms',
  rides: 'transports',
  activities: 'activities',
  money: 'money',
};

const VIEW_ICONS: Readonly<Record<AssistantView, LucideIcon>> = {
  planning: CalendarDays,
  rooms: BedDouble,
  rides: Car,
  activities: PartyPopper,
  money: Wallet,
};

// ============================================================================
// Views
// ============================================================================

/** Who is here when: the calendar page's timeline, guests and agenda. */
const PlanningView = memo(function PlanningView({
  trip,
  onOpenPage,
}: TripViewBodyProps): ReactElement {
  const { i18n } = useTranslation();
  const { rooms } = useRoomContext();
  const { assignments } = useAssignmentContext();
  const { persons } = usePersonContext();
  const { arrivals, departures } = useTransportContext();
  const { activities } = useActivityContext();
  const { rides, vehicles } = useRideContext();
  const { today } = useToday();

  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  // The same index the calendar page builds, so a leg in a car reads as one
  // here too.
  const rideByTransportId = useMemo(
    () =>
      selectRideByLeg(
        rides.length === 0
          ? []
          : resolveRides({
              transports: [...arrivals, ...departures],
              rides,
              vehicles,
              persons,
            }),
      ),
    [arrivals, departures, persons, rides, vehicles],
  );
  const rideForTransport = useCallback(
    (id: Parameters<typeof rideByTransportId.get>[0]) => rideByTransportId.get(id),
    [rideByTransportId],
  );

  return (
    <CalendarTimeline
      trip={trip}
      persons={persons}
      rooms={rooms}
      assignments={assignments}
      arrivals={arrivals}
      departures={departures}
      activities={activities}
      dateLocale={dateLocale}
      today={today}
      onAssignmentClick={onOpenPage}
      onTransportClick={onOpenPage}
      // The day-by-day agenda under the grid is drawn only when a click has
      // somewhere to go.
      onActivityClick={onOpenPage}
      rideForTransport={rideForTransport}
    />
  );
});

/** Who sleeps where: the rooms page's occupancy timeline, with no handler. */
const RoomsView = memo(function RoomsView({ trip }: TripViewBodyProps): ReactElement {
  const { i18n } = useTranslation();
  const { rooms } = useRoomContext();
  const { assignments } = useAssignmentContext();
  const { persons } = usePersonContext();
  const { arrivals, departures } = useTransportContext();
  const { today } = useToday();

  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);
  const range = useMemo(
    () => ({ startDate: trip.startDate, endDate: trip.endDate }),
    [trip.startDate, trip.endDate],
  );

  return (
    <RoomOccupancyTimeline
      trip={trip}
      rooms={rooms}
      assignments={assignments}
      arrivals={arrivals}
      departures={departures}
      persons={persons}
      dateLocale={dateLocale}
      range={range}
      today={today}
    />
  );
});

/**
 * Who comes and goes, and how: every arrival and departure in time order, with
 * the car that meets it.
 *
 * The transport page's list is private to that page and carries its edit
 * menus, so this is a short list of its own rather than a copy of it.
 */
const RidesView = memo(function RidesView(): ReactElement {
  const { t, i18n } = useTranslation();
  const { persons } = usePersonContext();
  const { arrivals, departures } = useTransportContext();
  const { rides, vehicles } = useRideContext();

  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  const rows = useMemo(() => {
    const names = new Map(persons.map((person) => [person.id, person.name]));
    const rideByLeg = selectRideByLeg(
      rides.length === 0
        ? []
        : resolveRides({
            transports: [...arrivals, ...departures],
            rides,
            vehicles,
            persons,
          }),
    );

    return [...arrivals, ...departures]
      .sort((a, b) => a.datetime.localeCompare(b.datetime))
      .map((transport) => ({
        transport,
        name: names.get(transport.personId) ?? t('common.unknown'),
        when: formatTransportDatetimeParts(transport.datetime, dateLocale).full,
        driver: rideByLeg.get(transport.id)?.driver?.name,
      }));
  }, [arrivals, dateLocale, departures, persons, rides, t, vehicles]);

  if (rows.length === 0) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">
        {t('assistant.views.rides.empty', 'No arrival or departure yet.')}
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {rows.map(({ transport, name, when, driver }) => {
        const isArrival = transport.type === 'arrival';
        const TypeIcon = isArrival ? ArrowDownToLine : ArrowUpFromLine;
        const mode =
          transport.transportMode !== undefined
            ? t(`transports.modes.${transport.transportMode}`)
            : undefined;

        return (
          <li key={transport.id} className="flex items-start gap-2 px-3 py-2 text-sm">
            <TypeIcon
              className={cn(
                'mt-0.5 size-4 shrink-0',
                statusVariants({ tone: transport.type, emphasis: 'text' }),
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                <span className="sr-only">
                  {isArrival ? t('transports.arrival') : t('transports.departure')}
                  {': '}
                </span>
                {name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {[when, mode, transport.transportNumber, transport.location]
                  .filter((part) => part !== undefined && part !== '')
                  .join(' · ')}
              </p>
              {driver !== undefined ? (
                <p className="truncate text-xs text-muted-foreground">
                  {t('assistant.views.rides.driver', {
                    name: driver,
                    defaultValue: 'Driver: {{name}}',
                  })}
                </p>
              ) : transport.needsPickup === true ? (
                <p
                  className={cn(
                    'truncate text-xs',
                    statusVariants({ tone: 'warning', emphasis: 'text' }),
                  )}
                >
                  {t('transports.needsPickup')}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
});

/** What the group does, day by day: the activities page's agenda. */
const ActivitiesView = memo(function ActivitiesView({
  onOpenPage,
}: TripViewBodyProps): ReactElement {
  const { i18n } = useTranslation();
  const { activities } = useActivityContext();
  const { today } = useToday();

  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  return (
    <ActivityAgenda
      activities={activities}
      dateLocale={dateLocale}
      today={today}
      onActivityClick={onOpenPage}
      // The deepest level the agenda offers. The view's title is an h3 as
      // well, so the days sit beside it rather than under it.
      headingLevel={3}
      className="p-3"
    />
  );
});

/** Who owes whom: the money page's balances, without the payment button. */
const MoneyView = memo(function MoneyView({ trip }: TripViewBodyProps): ReactElement {
  const { t } = useTranslation();
  // Money is not in a context: the pages read it from Dexie the same way.
  const tripMoney = useLiveQuery(() => loadTripMoney(trip.id), [trip.id]);

  if (tripMoney === undefined) {
    return (
      <p className="px-3 py-4 text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    );
  }

  return (
    <BalancesCard
      expenses={tripMoney?.expenses ?? []}
      persons={tripMoney?.persons ?? []}
      personNights={tripMoney?.personNights ?? new Map()}
      currency={tripMoney?.currency ?? trip.currency}
    />
  );
});

// ============================================================================
// Component
// ============================================================================

/**
 * One view of the current trip, framed for a chat bubble: a title, a link to
 * the page it comes from, and the view drawn from live data.
 */
const AssistantTripView = memo(function AssistantTripView({
  view,
}: AssistantTripViewProps): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentTrip } = useTripContext();

  const pagePath =
    currentTrip !== null ? `/trips/${currentTrip.id}/${VIEW_PAGES[view]}` : null;

  const handleOpenPage = useCallback((): void => {
    if (pagePath !== null) {
      navigate(pagePath, { state: OPENED_FROM_ASSISTANT });
    }
  }, [navigate, pagePath]);

  const Icon = VIEW_ICONS[view];
  const title = t(`assistant.views.${view}.title`);

  return (
    <section
      aria-label={title}
      className="mt-2 min-w-0 overflow-hidden rounded-xl border bg-background text-foreground"
    >
      <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="flex min-w-0 items-center gap-2 font-display text-sm font-semibold">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{title}</span>
        </h3>
        {pagePath !== null ? (
          <Link
            to={pagePath}
            state={OPENED_FROM_ASSISTANT}
            className="flex shrink-0 items-center gap-0.5 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('assistant.views.open', 'Open')}
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </header>

      {currentTrip === null ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          {t('assistant.views.noTrip', 'Pick a trip first to see it here.')}
        </p>
      ) : (
        <div className="min-w-0">
          {view === 'planning' ? (
            <PlanningView trip={currentTrip} onOpenPage={handleOpenPage} />
          ) : view === 'rooms' ? (
            <RoomsView trip={currentTrip} onOpenPage={handleOpenPage} />
          ) : view === 'rides' ? (
            <RidesView />
          ) : view === 'activities' ? (
            <ActivitiesView trip={currentTrip} onOpenPage={handleOpenPage} />
          ) : (
            <MoneyView trip={currentTrip} onOpenPage={handleOpenPage} />
          )}
        </div>
      )}
    </section>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { AssistantTripView };
