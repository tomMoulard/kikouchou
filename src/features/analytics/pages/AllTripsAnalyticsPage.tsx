/**
 * @fileoverview Aggregated analytics across every trip stored on this device.
 *
 * Shares {@link loadTripStats} with `/trips/:tripId/analytics`, so a trip's row
 * here and that trip's own page count the same rows the same way — see
 * `features/analytics/lib/trip-stats` for why they used not to.
 *
 * @module features/analytics/pages/AllTripsAnalyticsPage
 */

import { type ReactElement, memo, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { BarChart2 } from 'lucide-react';

import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AnalyticsScopeSelector } from '@/features/analytics/components/AnalyticsScopeSelector';
import { StatCard } from '@/features/analytics/components/StatCard';
import { useAnalyticsClock } from '@/features/analytics/hooks/useAnalyticsClock';
import {
  type TripStats,
  loadTripStats,
  readAnalytics,
  sumTripStats,
} from '@/features/analytics/lib/trip-stats';
import { TripsLocationMap } from '@/features/trips/components/TripsLocationMap';
import { useTripContext } from '@/contexts/TripContext';
import type { Trip } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/** Separator between the parts of a hint or breakdown line. */
const HINT_SEPARATOR = ' · ';

// ============================================================================
// Page
// ============================================================================

const AllTripsAnalyticsPage = memo(function AllTripsAnalyticsPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    trips,
    currentTrip,
    isLoading: isTripsLoading,
    error: tripsError,
    checkConnection,
  } = useTripContext();
  // Not live: nothing on this page depends on the time, so a ticking clock
  // would only re-read every trip once a minute to render the same numbers.
  const { now, retryToken, retry } = useAnalyticsClock();

  const tripScopeHref = useMemo(
    () => (currentTrip ? `/trips/${currentTrip.id}/analytics` : '/trips'),
    [currentTrip],
  );

  const tripDependencyKey = useMemo(
    () =>
      trips
        .map((tr) => tr.id)
        .sort()
        .join('|'),
    [trips],
  );

  const result = useLiveQuery(
    async () =>
      readAnalytics('load all-trips analytics', async () =>
        Promise.all(trips.map(async (trip) => loadTripStats(trip.id, now))),
      ),
    [tripDependencyKey, trips, now, retryToken],
  );

  const statsByTripId = useMemo(() => {
    const byId = new Map<string, TripStats>();
    for (const row of result?.data ?? []) {
      byId.set(row.tripId, row);
    }
    return byId;
  }, [result]);

  const totals = useMemo(() => sumTripStats(result?.data ?? []), [result]);

  // `useLiveQuery` keeps its previous result while a changed dependency
  // re-subscribes, so just after a trip is added or removed the totals still
  // describe the old set. Showing them under the new trip count would be the
  // same lie this page was rewritten to stop telling.
  const areStatsStale =
    result?.data !== undefined &&
    result.data !== null &&
    result.data
      .map((row) => row.tripId)
      .sort()
      .join('|') !== tripDependencyKey;

  const handleNewTrip = useCallback((): void => {
    void navigate('/trips/new');
  }, [navigate]);

  // Retry has to clear the trip context's error too: it is sticky, and bumping
  // only the analytics query would re-render the same alert forever.
  const handleRetry = useCallback((): void => {
    void checkConnection().catch(() => {
      // Whatever went wrong is already in the context's own error state.
    });
    retry();
  }, [checkConnection, retry]);

  const rowSummary = useCallback(
    (stats: TripStats): string =>
      [
        t('analytics.countPeople', { count: stats.headcount }),
        t('analytics.countRooms', { count: stats.roomCount }),
        t('analytics.countTransports', { count: stats.transportCount }),
        t('analytics.countAssignments', { count: stats.assignmentCount }),
      ].join(HINT_SEPARATOR),
    [t],
  );

  // ==========================================================================
  // Render: Loading
  // ==========================================================================

  if (isTripsLoading || result === undefined || areStatsStale) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader title={t('analytics.allTripsTitle')} backLink="/trips" />
        <AnalyticsScopeSelector active="all" tripHref={tripScopeHref} />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <LoadingState variant="inline" size="lg" />
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: Error
  // ==========================================================================

  if (tripsError ?? result.error) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader title={t('analytics.allTripsTitle')} backLink="/trips" />
        <AnalyticsScopeSelector active="all" tripHref={tripScopeHref} />
        <ErrorDisplay error={tripsError ?? result.error} onRetry={handleRetry} />
      </div>
    );
  }

  // ==========================================================================
  // Render: Empty State
  // ==========================================================================

  if (trips.length === 0) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader title={t('analytics.allTripsTitle')} backLink="/trips" />
        <AnalyticsScopeSelector active="all" tripHref={tripScopeHref} />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <EmptyState
            icon={BarChart2}
            title={t('analytics.emptyTrips')}
            description={t('trips.emptyDescription')}
            action={{
              label: t('trips.new'),
              onClick: handleNewTrip,
            }}
          />
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: Totals and Breakdown
  // ==========================================================================

  return (
    <div className="container max-w-4xl py-6 md:py-8">
      <PageHeader title={t('analytics.allTripsTitle')} backLink="/trips" />

      <AnalyticsScopeSelector active="all" tripHref={tripScopeHref} />

      <p className="mb-6 text-sm text-muted-foreground">{t('analytics.allTripsDescription')}</p>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label={t('analytics.trips')}
          value={trips.length}
          testId="stat-trips"
        />
        {/* Headcount, with the guest rows behind it named — the same pair the
            trip page shows, so "People" means one thing across the app. */}
        <StatCard
          label={t('analytics.totalPeople')}
          value={totals.headcount}
          hint={t('analytics.peopleHint', { count: totals.guestCount })}
          testId="stat-total-people"
        />
        <StatCard
          label={t('analytics.totalRooms')}
          value={totals.roomCount}
          testId="stat-total-rooms"
        />
        <StatCard
          label={t('analytics.totalTransports')}
          value={totals.transportCount}
          hint={[
            t('analytics.countArrivals', { count: totals.arrivalCount }),
            t('analytics.countDepartures', { count: totals.departureCount }),
          ].join(HINT_SEPARATOR)}
          testId="stat-total-transports"
        />
        <StatCard
          label={t('analytics.totalAssignments')}
          value={totals.assignmentCount}
          testId="stat-total-assignments"
        />
        {/* Beside the legs rather than folded into them: one car meeting three
            trains is one ride and three legs, so the two totals answer
            different questions and summing them would answer neither. */}
        <StatCard
          label={t('analytics.totalRides')}
          value={totals.rideCount}
          testId="stat-total-rides"
        />
        <StatCard
          label={t('analytics.totalVehicles')}
          value={totals.vehicleCount}
          testId="stat-total-vehicles"
        />
      </div>

      <div className="mb-8">
        <TripsLocationMap trips={trips} />
      </div>

      <h2 className="mb-3 text-base font-semibold">{t('analytics.tripBreakdown')}</h2>
      <ul className="space-y-3" aria-label={t('analytics.tripBreakdown')}>
        {trips.map((trip: Trip) => {
          const stats = statsByTripId.get(trip.id);
          return (
            <li key={trip.id}>
              <Card>
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{trip.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {stats === undefined ? t('common.loading') : rowSummary(stats)}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" asChild>
                    <Link to={`/trips/${trip.id}/analytics`}>{t('analytics.openTrip')}</Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

export { AllTripsAnalyticsPage };
