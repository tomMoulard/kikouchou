/**
 * @fileoverview "You need to leave now" — the driver's own departure banner.
 *
 * Requirement 1A of the transport upgrade, and 1C is half of its design: the
 * alert goes to **the driver alone**, because nobody else can act on it. A
 * passenger told that their lift is late has been handed a worry and no lever;
 * the driver told the same thing can pick up the car keys.
 *
 * Three things are worth knowing about how this is built.
 *
 * **It borrows the clock rather than starting one.** `TransportContext`
 * publishes `nowMs`, refreshed every minute and again on resume — a
 * backgrounded PWA has its timers throttled or frozen, so a user coming back
 * after lunch would otherwise read an hours-stale clock. Reading that value
 * instead of calling `useNowMs()` again is what stops the transport list and
 * this banner disagreeing about whether a pickup has happened.
 *
 * **A self-driven ride gets different words.** Tom and Aurélia taking the hire
 * car to the airport *are* the passengers, so "leave to pick up passengers" is
 * nonsense; it is "leave for CDG". `ResolvedRide.isSelfDriven` derives that
 * from who owns the legs, and this component is where it shows up as copy.
 *
 * **It announces once per device.** The banner itself is a live view of state
 * and simply renders while the ride is due, but the *announcement* — the thing
 * a sibling change turns into an OS notification — fires once, watermarked
 * through `rideNotices` with kind `leave`. `onAnnounce` is the seam: this file
 * deliberately contains no notification code of its own, so wiring
 * `lib/notifications` in later is a prop, not a rewrite.
 *
 * @module features/transports/components/DriverAlert
 */

import { type ReactElement, memo, useEffect, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from 'date-fns';
import { AlertTriangle, Car, Clock, type LucideIcon } from 'lucide-react';

import { statusVariants } from '@/components/ui/status.variants';
import {
  selectRideDepartures,
  type RideDeparture,
  type RideDepartureStatus,
} from '@/features/transports/utils/ride-departure';
import { resolveRides } from '@/features/transports/utils/ride-model';
// From the module rather than the `@/hooks` barrel, as `Layout` reaches for
// `useToday`: a test that stubs the whole barrel to get one hook would
// otherwise make this component throw on an export the stub never listed.
import { useTripIdentity } from '@/hooks/useTripIdentity';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';
import { getRideNotices, markNoticeFired, rideNoticeKey } from '@/lib/db';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { formatTransportDatetime } from '@/lib/utils/datetime-format';
import type { RideId, TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * One "set off now" announcement, ready to be handed to a notifier.
 *
 * Pre-rendered strings rather than the ride, so the seam carries no opinion
 * about locale, formatting or which of the nine sentences applies — a notifier
 * that had to re-derive those would be a second copy of the copy rules, and
 * the two would drift.
 */
export interface RideDepartureAnnouncement {
  readonly rideId: RideId;
  /** Never `upcoming`: a ride that is not due yet is not announced. */
  readonly status: Exclude<RideDepartureStatus, 'upcoming'>;
  /** The headline, translated — "Leave now to pick up Alice". */
  readonly title: string;
  /** The supporting line, translated — leave time, meeting time, place. */
  readonly body: string;
  /** When the driver must set off, epoch ms. */
  readonly leaveAtMs: number;
}

/** Props for {@link DriverAlert}. */
export interface DriverAlertProps {
  /** Optional className for additional styling. */
  readonly className?: string;
  /**
   * Called once per ride per device, the first time it becomes due.
   *
   * The seam for `lib/notifications`. Left undefined the banner is entirely
   * self-contained — it still watermarks the ride, so wiring a notifier in
   * later cannot re-announce a ride this device already showed.
   */
  readonly onAnnounce?: (announcement: RideDepartureAnnouncement) => void;
}

/** Props for one row of the banner. */
interface DriverAlertRowProps {
  readonly departure: RideDeparture;
  /** The trip the ride belongs to, for the notice watermark. */
  readonly tripId: TripId | undefined;
  /** The shared reference instant, recorded as the announcement time. */
  readonly nowMs: number;
  readonly dateLocale: Locale;
  readonly onAnnounce: DriverAlertProps['onAnnounce'];
}

/**
 * What a row keeps for its fire-once effect to read without re-running.
 *
 * The effect must not depend on values that change on the minute tick, so
 * everything it needs beyond its three stable keys is stashed here instead.
 */
interface LatestRowState {
  /** Undefined while the ride is merely on the horizon. */
  readonly announcement: RideDepartureAnnouncement | undefined;
  readonly onAnnounce: DriverAlertProps['onAnnounce'];
  /** The shared reference instant, recorded as the announcement time. */
  readonly nowMs: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * The headline for each state, spelled out rather than assembled.
 *
 * Nine literal keys, because a template built from `driverAlert.${status}…`
 * cannot be grepped, cannot be checked against the locale files by eye, and
 * would let a missing key render its own name to a user. The `self` column is
 * requirement 4 in copy: when the driver is one of the travellers there is
 * nobody to pick up.
 */
const HEADLINE_KEYS = {
  upcoming: {
    self: 'driverAlert.upcomingSelf',
    pickup: 'driverAlert.upcomingPickup',
    dropoff: 'driverAlert.upcomingDropoff',
  },
  leaveNow: {
    self: 'driverAlert.leaveNowSelf',
    pickup: 'driverAlert.leaveNowPickup',
    dropoff: 'driverAlert.leaveNowDropoff',
  },
  late: {
    self: 'driverAlert.lateSelf',
    pickup: 'driverAlert.latePickup',
    dropoff: 'driverAlert.lateDropoff',
  },
} as const;

/**
 * How each state is drawn, and how loudly it is announced.
 *
 * Amber through `statusVariants`, never a raw palette shade, and colour never
 * carries the meaning on its own: each row keeps its icon and says in words
 * what it is. `live` is the ARIA role — a due ride interrupts (`alert`), one
 * that is merely on the horizon is polite (`status`).
 */
const STATUS_PRESENTATION: Record<
  RideDepartureStatus,
  { readonly card: string; readonly icon: LucideIcon; readonly live: 'alert' | 'status' }
> = {
  upcoming: {
    card: statusVariants({ tone: 'warning', emphasis: 'outline' }),
    icon: Clock,
    live: 'status',
  },
  leaveNow: {
    card: cn(statusVariants({ tone: 'warning', emphasis: 'surface' }), 'border-warning'),
    icon: Car,
    live: 'alert',
  },
  late: {
    card: cn(
      statusVariants({ tone: 'danger', emphasis: 'surface' }),
      'border-destructive',
    ),
    icon: AlertTriangle,
    live: 'alert',
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Picks the headline key for one departure.
 *
 * A journey with nobody named in it falls back to the `self` wording rather
 * than rendering "Leave now to pick up " with an empty tail: an empty car is a
 * journey to a place, which is exactly what that sentence says.
 *
 * @param departure - The departure being rendered
 * @param hasNamedPassengers - Whether any leg resolved to a guest with a name
 * @returns The translation key
 */
function selectHeadlineKey(
  departure: RideDeparture,
  hasNamedPassengers: boolean,
): string {
  const row = HEADLINE_KEYS[departure.status];

  if (departure.journey.isSelfDriven || !hasNamedPassengers) {
    return row.self;
  }

  return departure.journey.direction === 'pickup' ? row.pickup : row.dropoff;
}

// ============================================================================
// DriverAlertRow Subcomponent
// ============================================================================

/**
 * One ride the driver has to set off for.
 *
 * The fire-once effect lives here rather than in the parent because its
 * dependencies are then three primitives — trip, ride, status — that are
 * stable across the minute tick. Keyed on the parent's departure array instead,
 * it would re-read the notice table sixty times an hour to learn nothing.
 *
 * @param props - The departure and the context it is rendered in
 * @returns The row element
 */
const DriverAlertRow = memo(function DriverAlertRow({
  departure,
  tripId,
  nowMs,
  dateLocale,
  onAnnounce,
}: DriverAlertRowProps): ReactElement {
  const { t } = useTranslation(),
    { journey, status, leaveAtMs } = departure,
    rideId = journey.id,
    presentation = STATUS_PRESENTATION[status],
    StatusIcon = presentation.icon,
    passengerNames = useMemo(
      () =>
        journey.legs
          .map((leg) => leg.person?.name)
          .filter((name): name is string => name !== undefined && name.length > 0),
      [journey.legs],
    ),
    // Short in the sentence, spelled out underneath. "Leave at 16:32" is what
    // somebody reads at a glance; "Wed 15 Jul, 16:32" is what survives a
    // screenshot and a phone left face-up on a table until tomorrow.
    leaveClock = formatTransportDatetime(
      new Date(leaveAtMs).toISOString(),
      dateLocale,
      'timeOnly',
    ),
    leaveFull = formatTransportDatetime(
      new Date(leaveAtMs).toISOString(),
      dateLocale,
      'dayAndTime',
    ),
    meetFull = formatTransportDatetime(journey.meetDatetime, dateLocale, 'dayAndTime'),
    headline = t(selectHeadlineKey(departure, passengerNames.length > 0), {
      time: leaveClock,
      names: passengerNames.join(', '),
      location: journey.location,
    }),
    timesLine = `${t('rides.leaveAt', { time: leaveFull })} · ${t('rides.meetAt', {
      time: meetFull,
    })}`,
    announcement: RideDepartureAnnouncement | undefined =
      status === 'upcoming'
        ? undefined
        : {
            rideId,
            status,
            title: headline,
            body: `${timesLine} · ${journey.location}`,
            leaveAtMs,
          },
    // Set on setup, not only in cleanup — the cleanup-only form latches false
    // forever under StrictMode and every guarded write after it is a no-op.
    isMountedRef = useRef(true),
    // Read by the fire-once effect so that recomputing the strings on every
    // render does not re-run it. Refreshed by the effect declared immediately
    // below, which runs *before* the announcing one in the same commit.
    latestRef = useRef<LatestRowState>({ announcement, onAnnounce, nowMs }),
    // Departures this row has already started announcing.
    //
    // `rideNotices` is the durable watermark, but it is read across an `await`
    // and written after another, so two invocations that start before the first
    // write lands both see an empty set and both announce. StrictMode makes
    // that the *normal* path in development — it runs every effect twice on the
    // same fiber, with no cleanup here to cancel the first async run — and any
    // dependency change arriving mid-flight reaches it in production. The ref
    // survives that double-invoke, so claiming the key synchronously before the
    // first `await` is what actually makes "once" true.
    announcingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    latestRef.current = { announcement, onAnnounce, nowMs };
  });

  useEffect(() => {
    if (tripId === undefined || status === 'upcoming') {
      return;
    }

    // Claimed synchronously, before anything is awaited. The departure instant
    // is part of the key so that moving the car — a genuinely new thing to say
    // — is not mistaken for a repeat of the old one.
    const guardKey = `${rideId}:${leaveAtMs}`;

    if (announcingRef.current.has(guardKey)) {
      return;
    }
    announcingRef.current.add(guardKey);

    void (async (): Promise<void> => {
      try {
        const notices = await getRideNotices(tripId);

        if (!isMountedRef.current) {
          return;
        }

        // Stale-aware rather than a bare presence check. Keyed on the ride id
        // alone, one fired notice would silence that ride for the life of the
        // trip: the 17:00 airport run announces at 16:30, the group moves it to
        // 21:00, and 20:30 passes in silence. `firedAtMs` is always at or after
        // the leave time it fired for, so a leave time now *later* than it is
        // proof the car moved. A row we cannot date is treated as fired —
        // saying nothing is the safer half of that guess.
        const fired = notices.get(rideNoticeKey('leave', rideId));

        if (fired !== undefined && leaveAtMs <= (fired.firedAtMs ?? Infinity)) {
          return;
        }

        const { announcement: due, onAnnounce: announce, nowMs: firedAtMs } =
          latestRef.current;

        if (due !== undefined) {
          announce?.(due);
        }

        // Watermarked whether or not anybody is listening on the seam. The row
        // is what the user saw; a notifier wired in tomorrow must not replay
        // this morning's ride at them.
        await markNoticeFired(tripId, 'leave', rideId, firedAtMs);
      } catch (error) {
        // Released, so a later status change can try again: the guard exists to
        // stop a double announcement, not to make one failure permanent.
        announcingRef.current.delete(guardKey);
        console.error('Failed to record the driver departure notice:', error);
      }
    })();
  }, [tripId, rideId, status, leaveAtMs]);

  return (
    <div
      role={presentation.live}
      className={cn(presentation.card, 'rounded-lg border-2 p-4')}
    >
      <div className="flex items-start gap-3">
        <StatusIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{headline}</p>
          <p className="mt-1 text-sm text-muted-foreground">{timesLine}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="truncate">{journey.location}</span>
            {passengerNames.length > 0 && (
              <span> · {t('rides.passengers', { count: passengerNames.length })}</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// DriverAlert Component
// ============================================================================

/**
 * Tells the guest holding this device about the cars they are driving.
 *
 * Renders nothing at all when this device is not driving anything due soon —
 * including when nobody has said who they are, because `selectRidesDrivenBy`
 * answers "nothing" for an unknown guest rather than "everything".
 *
 * Placed in the page flow rather than fixed to the viewport. A fixed overlay
 * eats every tap underneath it, and this repo has three bugs of exactly that
 * shape; a banner with nothing to click still swallows the nav bar behind it.
 *
 * @param props - Component props
 * @returns The banner, or null when there is nothing to say
 *
 * @example
 * ```tsx
 * <DriverAlert className="mb-6" onAnnounce={notify} />
 * ```
 */
const DriverAlert = memo(function DriverAlert({
  className,
  onAnnounce,
}: DriverAlertProps): ReactElement | null {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const { currentTrip } = useTripContext();
  // The shared reference instant, not a second clock of our own: the transport
  // list and this banner have to agree about whether a pickup has happened.
  const { transports, nowMs } = useTransportContext();
  const { rides, vehicles } = useRideContext();
  const { persons } = usePersonContext();
  const { myPersonId } = useTripIdentity();

  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);
  const journeys = useMemo(
    () => resolveRides({ transports, rides, vehicles, persons }),
    [transports, rides, vehicles, persons],
  );
  const departures = useMemo(
    () => selectRideDepartures(journeys, myPersonId, nowMs),
    [journeys, myPersonId, nowMs],
  );

  if (departures.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby={headingId} className={cn('space-y-3', className)}>
      <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold">
        <Car
          className={cn('size-5', statusVariants({ tone: 'warning', emphasis: 'text' }))}
          aria-hidden="true"
        />
        {t('driverAlert.title')}
      </h2>

      {departures.map((departure) => (
        <DriverAlertRow
          key={departure.journey.id}
          departure={departure}
          tripId={currentTrip?.id}
          nowMs={nowMs}
          dateLocale={dateLocale}
          onAnnounce={onAnnounce}
        />
      ))}
    </section>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { DriverAlert };
