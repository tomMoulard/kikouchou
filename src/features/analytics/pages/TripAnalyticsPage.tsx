/**
 * @fileoverview Analytics overview for the trip named in the URL.
 *
 * Reads Dexie directly through {@link loadTripStats} rather than through
 * `PersonContext` / `RoomContext` / `AssignmentContext` / `TransportContext`.
 * Those are scoped to `TripContext.currentTrip`, which lags the URL during a
 * trip switch, so the page could report the previous trip's rows under this
 * trip's name — and disagree with `/analytics`, which reads Dexie. One reader,
 * keyed on the id in the URL, is the only way the two pages cannot diverge.
 *
 * @module features/analytics/pages/TripAnalyticsPage
 */

import { type ReactElement, memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { BarChart2 } from 'lucide-react';

import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { AnalyticsScopeSelector } from '@/features/analytics/components/AnalyticsScopeSelector';
import { SpendTimelineChart } from '@/features/analytics/components/SpendTimelineChart';
import { StatCard } from '@/features/analytics/components/StatCard';
import { useMoneyFormat } from '@/features/money/hooks/useMoneyFormat';
import { useAnalyticsClock } from '@/features/analytics/hooks/useAnalyticsClock';
import {
  isTripStatsEmpty,
  loadTripStats,
  readAnalytics,
} from '@/features/analytics/lib/trip-stats';
import { useTripContext } from '@/contexts/TripContext';
import type { TripId } from '@/types';
import { captureEvent } from '@/lib/posthog';

// ============================================================================
// Constants
// ============================================================================

/** Separator between the parts of a stat card's hint line. */
const HINT_SEPARATOR = ' · ';

// ============================================================================
// Page
// ============================================================================

const TripAnalyticsPage = memo(function TripAnalyticsPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tripId: tripIdFromUrl } = useParams<'tripId'>();

  const {
    trips,
    currentTrip,
    isLoading: isTripLoading,
    error: tripError,
    setCurrentTrip,
    checkConnection,
  } = useTripContext();
  // Live: "pickups needing a driver" only counts *upcoming* pickups, so the
  // number goes stale on a page left open. `TransportContext` ticks its own
  // clock every minute for the same reason.
  const { now, retryToken, retry } = useAnalyticsClock({ live: true });

  useEffect(() => {
    if (tripIdFromUrl && !isTripLoading && currentTrip?.id !== tripIdFromUrl) {
      setCurrentTrip(tripIdFromUrl).catch((err) => {
        console.error('Failed to set current trip from URL:', err);
      });
    }
  }, [tripIdFromUrl, currentTrip?.id, isTripLoading, setCurrentTrip]);

  // Existence is decided from the trips list, not from `currentTrip`: during a
  // switch `currentTrip` is still the previous trip, and treating that as "trip
  // not found" made the page flash an error on every navigation into it.
  const trip = useMemo(
    () => trips.find((candidate) => candidate.id === tripIdFromUrl),
    [trips, tripIdFromUrl],
  );

  const result = useLiveQuery(
    async () => {
      if (tripIdFromUrl === undefined) {
        return null;
      }
      return readAnalytics('load trip analytics', () =>
        loadTripStats(tripIdFromUrl as TripId, now),
      );
    },
    [tripIdFromUrl, now, retryToken],
  );

  // Labelled with the trip's own currency, which the read carries so the page
  // never has to guess at one. Called here rather than beside the figures it
  // formats: the render below returns early for loading, error and not-found,
  // and a hook after those runs in some renders and not others.
  const formatMoney = useMoneyFormat(result?.data?.currency);

  const tripAnalyticsHref = useMemo(
    () => (tripIdFromUrl ? `/trips/${tripIdFromUrl}/analytics` : '/trips'),
    [tripIdFromUrl],
  );

  const backLink = tripIdFromUrl ? `/trips/${tripIdFromUrl}/calendar` : '/trips';

  // The page the money figures are read from and acted on.
  const moneyHref = tripIdFromUrl ? `/trips/${tripIdFromUrl}/money` : '/trips';

  // The screen that lists what "pickups needing a driver" counts, already
  // narrowed to those legs.
  const runSheetHref = tripIdFromUrl
    ? `/trips/${tripIdFromUrl}/transports/runsheet?filter=needsDriver`
    : '/trips';

  // `useLiveQuery` keeps its previous result while a changed dependency
  // re-subscribes, so straight after a trip switch `result` still describes the
  // trip we just left. `TripStats` carries the id it was read for precisely so
  // that stale paint can be caught and shown as loading — rendering it would
  // reintroduce the very divergence this page was rewritten to remove.
  const isStatsStale =
    result?.data !== undefined &&
    result.data !== null &&
    result.data.tripId !== tripIdFromUrl;

  const isLoading =
    isTripLoading ||
    isStatsStale ||
    (tripIdFromUrl !== undefined && result === undefined);

  // Reported once per trip, after the numbers are actually on screen.
  //
  // `$pageview` already counts the route, and counting it twice would be
  // pointless. What it cannot say is whether the page had anything to show:
  // these figures separate a reader who opened a trip worth analysing from one
  // who opened an empty one and left. The effect has to sit above the loading
  // return below — hooks cannot live under a conditional — so it carries its
  // own guards instead: nothing is reported while `isLoading`, which covers
  // both the first read and the stale paint straight after a trip switch.
  const reportedTripIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const loadedStats = result?.data ?? null;
    if (
      isLoading ||
      tripIdFromUrl === undefined ||
      loadedStats === null ||
      reportedTripIdRef.current === tripIdFromUrl
    ) {
      return;
    }
    // Set before the capture, not after: the clock ticks every minute on this
    // page and each tick re-runs the effect.
    reportedTripIdRef.current = tripIdFromUrl;
    captureEvent('analytics_viewed', {
      scope: 'trip',
      guest_count: loadedStats.guestCount,
      room_count: loadedStats.roomCount,
      transport_count: loadedStats.transportCount,
      expense_count: loadedStats.expenseCount,
    });
  }, [isLoading, result, tripIdFromUrl]);

  const handleBack = useCallback((): void => {
    void navigate(backLink);
  }, [navigate, backLink]);

  // Retry has to clear the trip context's error too: it is sticky, and bumping
  // only the analytics query would re-render the same alert forever.
  const handleRetry = useCallback((): void => {
    void checkConnection().catch(() => {
      // Whatever went wrong is already in the context's own error state.
    });
    retry();
  }, [checkConnection, retry]);

  const handleAddGuests = useCallback((): void => {
    if (tripIdFromUrl) {
      void navigate(`/trips/${tripIdFromUrl}/persons`);
      return;
    }
    void navigate('/trips');
  }, [navigate, tripIdFromUrl]);

  // ==========================================================================
  // Render: Loading
  // ==========================================================================

  if (isLoading) {
    return (
      <div className="container max-w-6xl py-6 md:py-8">
        <PageHeader title={t('analytics.tripTitle')} />
        <AnalyticsScopeSelector active="trip" tripHref={tripAnalyticsHref} />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <LoadingState variant="inline" size="lg" />
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: Error
  // ==========================================================================

  const statsError = result?.error ?? null;
  const stats = result?.data ?? null;

  // Per real person, and only where there is one: a trip with no guests yet
  // still has a total, and dividing it by nobody would print Infinity.
  const spendPerPerson =
    stats && stats.headcount > 0
      ? Math.round((stats.spendTotal / stats.headcount) * 100) / 100
      : 0;

  // The read failing is a real database problem, so it outranks everything.
  if (statsError) {
    return (
      <div className="container max-w-6xl py-6 md:py-8">
        <PageHeader title={t('analytics.tripTitle')} />
        <AnalyticsScopeSelector active="trip" tripHref={tripAnalyticsHref} />
        <ErrorDisplay
          error={statsError}
          onRetry={handleRetry}
          onBack={handleBack}
        />
      </div>
    );
  }

  // ==========================================================================
  // Render: Trip Not Found
  // ==========================================================================

  // Checked BEFORE the trip context's error: an id that is not on this device
  // makes `setCurrentTrip` reject with `Trip with ID "…" not found`, which the
  // context stores as an error. Showing that as "failed to load", with a Retry
  // button that can never succeed, is the wrong answer to a mistyped URL.
  if (!tripIdFromUrl || trip === undefined || stats === null) {
    return (
      <div className="container max-w-6xl py-6 md:py-8">
        <PageHeader title={t('analytics.tripTitle')} backLink="/trips" />
        <AnalyticsScopeSelector active="trip" tripHref={tripAnalyticsHref} />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <EmptyState
            icon={BarChart2}
            title={t('errors.tripNotFound')}
            description={t('errors.tripNotFoundDescription')}
            action={{
              label: t('common.back'),
              onClick: handleBack,
            }}
          />
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: Trip Context Error
  // ==========================================================================

  if (tripError) {
    return (
      <div className="container max-w-6xl py-6 md:py-8">
        <PageHeader title={t('analytics.tripTitle')} />
        <AnalyticsScopeSelector active="trip" tripHref={tripAnalyticsHref} />
        <ErrorDisplay
          error={tripError}
          onRetry={handleRetry}
          onBack={handleBack}
        />
      </div>
    );
  }

  // ==========================================================================
  // Render: Empty Trip
  // ==========================================================================

  if (isTripStatsEmpty(stats)) {
    return (
      <div className="container max-w-6xl py-6 md:py-8">
        <PageHeader title={t('analytics.tripTitle')} />
        <AnalyticsScopeSelector active="trip" tripHref={tripAnalyticsHref} />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <EmptyState
            icon={BarChart2}
            title={t('analytics.emptyTrip')}
            description={t('analytics.emptyTripDescription')}
            action={{
              label: t('persons.new'),
              onClick: handleAddGuests,
            }}
          />
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: Stats
  // ==========================================================================

  return (
    <div className="container max-w-6xl py-6 md:py-8">
      <PageHeader title={t('analytics.tripTitle')} />

      <AnalyticsScopeSelector active="trip" tripHref={tripAnalyticsHref} />

      <p className="mb-6 text-sm text-muted-foreground">{t('analytics.tripDescription')}</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* "People" and not "Guests": the Guests page lists rows, and one row
            can stand for a couple or a family. Naming both "Guests" made the
            two pages contradict each other. */}
        <StatCard
          label={t('analytics.people')}
          value={stats.headcount}
          hint={t('analytics.peopleHint', { count: stats.guestCount })}
          testId="stat-people"
        />
        <StatCard
          label={t('analytics.rooms')}
          value={stats.roomCount}
          testId="stat-rooms"
        />
        <StatCard
          label={t('analytics.assignments')}
          value={stats.assignmentCount}
          testId="stat-assignments"
        />
        {/* Same label and same total as the all-trips page, with the arrivals
            and departures split spelled out underneath rather than shown as
            two unrelated cards. */}
        <StatCard
          label={t('analytics.transports')}
          value={stats.transportCount}
          hint={[
            t('analytics.countArrivals', { count: stats.arrivalCount }),
            t('analytics.countDepartures', { count: stats.departureCount }),
          ].join(HINT_SEPARATOR)}
          testId="stat-transports"
        />
        {/* A car journey is not a transport leg and the two must never be
            added together: one car meeting three trains is one ride and three
            legs. They sit side by side so the difference is visible rather
            than explained. The count comes from `resolveRides()`, so a leg
            carrying only a legacy `driverId` counts as the one-passenger
            journey every transport surface draws it as. */}
        <StatCard
          label={t('analytics.rides')}
          value={stats.rideCount}
          testId="stat-rides"
        />
        <StatCard
          label={t('analytics.vehicles')}
          value={stats.vehicleCount}
          testId="stat-vehicles"
        />
        {/* Money. The total is what the trip cost — expenses less incomes,
            with transfers left out, because a guest paying another back moves
            the group's own money rather than spending any. */}
        <StatCard
          label={t('analytics.spendTotal')}
          value={formatMoney(stats.spendTotal)}
          hint={t('analytics.spendTotalHint', { count: stats.expenseCount })}
          href={moneyHref}
          testId="stat-spend"
        />
        {/* Per person, not per guest row: a row can stand for a family. */}
        <StatCard
          label={t('analytics.spendPerPerson')}
          value={formatMoney(spendPerPerson)}
          hint={t('analytics.spendPerPersonHint', { count: stats.headcount })}
          testId="stat-spend-per-person"
        />
        <StatCard
          label={t('analytics.unsettledTotal')}
          value={formatMoney(stats.unsettledTotal)}
          hint={
            stats.unsettledTotal === 0
              ? t('analytics.unsettledSettled')
              : t('analytics.unsettledTotalHint')
          }
          href={moneyHref}
          testId="stat-unsettled"
        />

        {/* The one figure on this page with something to do about it: the run
            sheet lists the very legs this counts. */}
        <StatCard
          label={t('analytics.pickupsNeedingDriver')}
          value={stats.pickupsNeedingDriver}
          hint={t('analytics.pickupsNeedingDriverHint', 'Open the run sheet')}
          href={runSheetHref}
          testId="stat-pickups"
        />
      </div>

      {/* Under the cards rather than among them: the total says what the trip
          cost, and this says when it was spent — the deposit in March, then a
          fortnight of groceries. A card-sized version of it would be too small
          to read either fact from. Left out entirely when no money line carries
          a date, because an empty chart is a blank rectangle the reader has to
          interpret. */}
      {stats.spendTimeline !== null && (
        <SpendTimelineChart
          timeline={stats.spendTimeline}
          formatMoney={formatMoney}
        />
      )}
    </div>
  );
});

export { TripAnalyticsPage };
