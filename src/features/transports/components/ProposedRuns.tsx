/**
 * @fileoverview The runs the app proposes, for a host to accept in one pass.
 *
 * Nobody should have to work out which car meets which train. Every fact the
 * arrangement needs is already in the trip — where each guest lands, when, how
 * many people the row stands for, which of them needs a booster — so the app
 * proposes the cars and a person confirms them, exactly as the rooms feature
 * fills the beds and asks for one review.
 *
 * Two answers are offered on every card, because they come from two different
 * people:
 *
 * - **I'll drive** is the guest's own answer, on their own phone. It arranges
 *   the car *and* puts their name in it in one tap, so a driver never has to
 *   find themselves in a dropdown of the whole trip.
 * - **Confirm** is the host's answer: it arranges the car and leaves the
 *   driver's seat open, which is what turns the run into something a guest can
 *   claim later.
 *
 * Nothing here is stored until one of those is pressed: the list is derived by
 * {@link buildProposedRuns} on every render, so it can never go stale against
 * the legs it is proposing for.
 *
 * @module features/transports/components/ProposedRuns
 */

import { type ReactElement, memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, ArrowUpFromLine, Baby, Clock, MapPin, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PersonBadge } from '@/components/shared/PersonBadge';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useOfflineAwareNotify, useTripIdentity } from '@/hooks';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { notify } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';
import { selectPickupsNeedingDriver } from '@/features/transports/utils/pickup-utils';
import {
  type ProposedRun,
  buildProposedRuns,
} from '@/features/transports/utils/proposed-runs';
import { DEFAULT_LEAD_TIME_MINUTES } from '@/types';
import type { Person, PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link ProposedRuns}.
 */
export interface ProposedRunsProps {
  /** Optional className for additional styling. */
  readonly className?: string;
}

/**
 * Props for one proposal card.
 */
interface ProposedRunCardProps {
  /** The proposal to draw. */
  readonly run: ProposedRun;
  /** The guests travelling in it, in the legs' order. */
  readonly passengers: readonly Person[];
  /** Date locale for formatting. */
  readonly dateLocale: Locale;
  /** Whether this browser knows which guest it is, so it can claim the run. */
  readonly canClaim: boolean;
  /** Whether a write for this card is in flight. */
  readonly isBusy: boolean;
  /** Arranges the car and takes the driver's seat. */
  readonly onClaim: (run: ProposedRun) => void;
  /** Arranges the car and leaves the driver's seat open. */
  readonly onConfirm: (run: ProposedRun) => void;
}

/** The date-fns locale, named here so the props above read as one line. */
type Locale = ReturnType<typeof getDateLocale>;

// ============================================================================
// Sub-components
// ============================================================================

/**
 * One proposed run: where and when the car has to be, who is in it, what it
 * has to hold, and the two ways to accept it.
 *
 * @param props - The proposal, its passengers and the two answers
 * @returns The card
 */
const ProposedRunCard = memo(function ProposedRunCard({
  run,
  passengers,
  dateLocale,
  canClaim,
  isBusy,
  onClaim,
  onConfirm,
}: ProposedRunCardProps): ReactElement {
  const { t } = useTranslation();

  const isPickup = run.direction === 'pickup';
  const DirectionIcon = isPickup ? ArrowDownToLine : ArrowUpFromLine;
  const { date: meetDate, time: meetTime } = formatTransportDatetimeParts(
    run.meetDatetime,
    dateLocale,
  );

  const handleClaim = useCallback((): void => {
    onClaim(run);
  }, [onClaim, run]);

  const handleConfirm = useCallback((): void => {
    onConfirm(run);
  }, [onConfirm, run]);

  return (
    <Card
      role="article"
      aria-label={`${t(`rides.directions.${run.direction}`)}, ${meetDate}, ${meetTime}, ${run.location}`}
      // Dashed, because it is a proposal rather than a car: the moment it is
      // confirmed it becomes a `RideCard`, which is solid and tinted.
      className="border-dashed"
    >
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <DirectionIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-semibold text-sm truncate">
            {t(`rides.directions.${run.direction}`)}
          </span>
          <Badge variant="outline" className="shrink-0 ml-auto">
            {t('proposedRuns.seats', { count: run.seatsNeeded })}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">{meetDate}</span>
          <span className="text-muted-foreground">
            {t('rides.meetAt', { time: meetTime })}
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate" title={run.location}>
            {run.location}
          </span>
        </div>

        {/* Who travels. Named rather than counted: the card is read by the
            person deciding whether to drive, and "Alice and the twins" is the
            answer to that question. */}
        <div className="flex items-center gap-2 flex-wrap">
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {passengers.map((passenger) => (
            <PersonBadge key={passenger.id} person={passenger} size="sm" />
          ))}
        </div>

        {/* What the car has to carry. Spelled out one seat at a time, because
            "two boosters" is what a driver has to actually find. */}
        {run.childSeatsNeeded.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Baby className="size-4 shrink-0" aria-hidden="true" />
            <span>
              {run.childSeatsNeeded
                .map((kind) => t(`childSeats.${kind}`))
                .join(', ')}
            </span>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button variant="outline" size="sm" onClick={handleConfirm} disabled={isBusy}>
            {t('proposedRuns.confirm')}
          </Button>
          {/* Hidden rather than disabled when this browser is nobody in
              particular: there is no name to put in the car, and a disabled
              button with no explanation reads as a broken one. The card still
              carries Confirm, which is the host's answer. */}
          {canClaim && (
            <Button size="sm" onClick={handleClaim} disabled={isBusy}>
              {t('proposedRuns.claim')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Component
// ============================================================================

/**
 * The proposed runs for this trip, with one review for all of them.
 *
 * Renders nothing when there is nothing to propose — which is the ordinary
 * state of a trip whose cars are all arranged, and not worth a panel saying so.
 *
 * @param props - Optional className
 * @returns The panel, or an empty fragment
 *
 * @example
 * ```tsx
 * <ProposedRuns className="mb-6" />
 * ```
 */
export const ProposedRuns = memo(function ProposedRuns({
  className,
}: ProposedRunsProps): ReactElement | null {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateLocale(i18n.language);
  const { notifySuccess } = useOfflineAwareNotify();

  const { persons } = usePersonContext();
  const { upcomingPickups } = useTransportContext();
  const { rides, createRide, setTransportRide, updateRide } = useRideContext();
  const { myPersonId } = useTripIdentity();

  // A run whose write is in flight, so a double tap cannot arrange two cars
  // for the same guests. Keyed on the run, not a single boolean: confirming
  // all of them leaves every card busy at once.
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());

  const personsById = useMemo(
    () => new Map<PersonId, Person>(persons.map((person) => [person.id, person])),
    [persons],
  );

  const runs = useMemo(
    () =>
      buildProposedRuns({
        legsNeedingLift: selectPickupsNeedingDriver(upcomingPickups, rides),
        rides,
        persons,
      }),
    [upcomingPickups, rides, persons],
  );

  /**
   * Arranges one run's car, optionally with a driver in it.
   *
   * The car comes first and the passengers are pointed at it afterwards: a
   * failure that way round leaves an empty car somebody can still be added to,
   * where the other way round would leave passengers pointing at nothing.
   *
   * A run that already has a car extends it rather than building a rival: the
   * same reasoning as `RideSuggestion.existingRideId`.
   */
  const arrange = useCallback(
    async (run: ProposedRun, driverId: PersonId | undefined): Promise<void> => {
      if (run.existingRideId !== undefined) {
        if (driverId !== undefined) {
          await updateRide(run.existingRideId, { driverId });
        }
        for (const leg of run.legs) {
          if (leg.rideId !== run.existingRideId) {
            await setTransportRide(leg.id, run.existingRideId);
          }
        }
        return;
      }

      const ride = await createRide({
        direction: run.direction,
        meetDatetime: run.meetDatetime,
        location: run.location,
        leadTimeMinutes: DEFAULT_LEAD_TIME_MINUTES,
        ...(driverId === undefined ? {} : { driverId }),
      });

      for (const leg of run.legs) {
        await setTransportRide(leg.id, ride.id);
      }
    },
    [createRide, setTransportRide, updateRide],
  );

  const runWithBusyKey = useCallback(
    async (key: string, work: () => Promise<void>): Promise<boolean> => {
      setBusyKeys((previous) => new Set(previous).add(key));
      try {
        await work();
        return true;
      } catch (error) {
        console.error('Failed to arrange a proposed run:', error);
        notify.error(t('errors.saveFailed'));
        return false;
      } finally {
        setBusyKeys((previous) => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
      }
    },
    [t],
  );

  const handleClaim = useCallback(
    (run: ProposedRun): void => {
      if (myPersonId === undefined) {
        return;
      }
      void runWithBusyKey(run.key, () => arrange(run, myPersonId)).then((ok) => {
        if (ok) {
          notifySuccess(t('proposedRuns.claimed'));
        }
      });
    },
    [arrange, myPersonId, notifySuccess, runWithBusyKey, t],
  );

  const handleConfirm = useCallback(
    (run: ProposedRun): void => {
      void runWithBusyKey(run.key, () => arrange(run, undefined)).then((ok) => {
        if (ok) {
          notifySuccess(t('proposedRuns.confirmed'));
        }
      });
    },
    [arrange, notifySuccess, runWithBusyKey, t],
  );

  /**
   * Accepts every proposal at once.
   *
   * Sequential rather than parallel: the runs share nothing, but they do share
   * one Yjs document, and a burst of concurrent writes to it buys nothing on a
   * list this short.
   */
  const handleConfirmAll = useCallback((): void => {
    const pending = runs;

    void runWithBusyKey('all', async () => {
      for (const run of pending) {
        await arrange(run, undefined);
      }
    }).then((ok) => {
      if (ok) {
        notifySuccess(t('proposedRuns.confirmedAll', { count: pending.length }));
      }
    });
  }, [arrange, notifySuccess, runs, runWithBusyKey, t]);

  if (runs.length === 0) {
    return null;
  }

  const isConfirmingAll = busyKeys.has('all');

  return (
    <section className={cn('space-y-3', className)} aria-labelledby="proposed-runs-heading">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="proposed-runs-heading" className="text-base font-semibold">
            {t('proposedRuns.title')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('proposedRuns.description', { count: runs.length })}
          </p>
        </div>
        {runs.length > 1 && (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={handleConfirmAll}
            disabled={isConfirmingAll}
          >
            {t('proposedRuns.confirmAll')}
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {runs.map((run) => (
          <ProposedRunCard
            key={run.key}
            run={run}
            passengers={run.legs
              .map((leg) => personsById.get(leg.personId))
              .filter((passenger): passenger is Person => passenger !== undefined)}
            dateLocale={dateLocale}
            canClaim={myPersonId !== undefined}
            isBusy={isConfirmingAll || busyKeys.has(run.key)}
            onClaim={handleClaim}
            onConfirm={handleConfirm}
          />
        ))}
      </div>
    </section>
  );
});
