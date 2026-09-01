/**
 * @fileoverview Aggregated analytics across every trip stored on this device.
 *
 * @module features/analytics/pages/AllTripsAnalyticsPage
 */

import { type ReactElement, memo, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { BarChart2 } from 'lucide-react';

import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { LoadingState } from '@/components/shared/LoadingState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AnalyticsScopeSelector } from '@/features/analytics/components/AnalyticsScopeSelector';
import { TripsLocationMap } from '@/features/trips/components/TripsLocationMap';
import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { getPersonHeadcount } from '@/types';
import type { Trip } from '@/types';

// ============================================================================
// Types
// ============================================================================

interface TripAnalyticsRow {
  readonly trip: Trip;
  readonly personCount: number;
  readonly roomCount: number;
  readonly transportCount: number;
  readonly assignmentCount: number;
}

// ============================================================================
// Page
// ============================================================================

const AllTripsAnalyticsPage = memo(function AllTripsAnalyticsPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { trips, currentTrip, isLoading: isTripsLoading } = useTripContext();

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

  const rows = useLiveQuery(
    async (): Promise<TripAnalyticsRow[]> => {
      if (trips.length === 0) {
        return [];
      }
      return Promise.all(
        trips.map(async (trip) => {
          // `count()` would count guest rows; a row can stand for a couple or a
          // family, so read the rows and sum their headcount instead.
          const [tripPersons, roomCount, transportCount, assignmentCount] =
            await Promise.all([
              db.persons.where('tripId').equals(trip.id).toArray(),
              db.rooms.where('tripId').equals(trip.id).count(),
              db.transports.where('tripId').equals(trip.id).count(),
              db.roomAssignments.where('tripId').equals(trip.id).count(),
            ]);
          const personCount = tripPersons.reduce(
            (total, person) => total + getPersonHeadcount(person),
            0,
          );
          return { trip, personCount, roomCount, transportCount, assignmentCount };
        }),
      );
    },
    [tripDependencyKey, trips],
  );

  const totals = useMemo(() => {
    if (!rows || rows.length === 0) {
      return { guests: 0, rooms: 0, transports: 0, assignments: 0 };
    }
    return rows.reduce(
      (acc, row) => ({
        guests: acc.guests + row.personCount,
        rooms: acc.rooms + row.roomCount,
        transports: acc.transports + row.transportCount,
        assignments: acc.assignments + row.assignmentCount,
      }),
      { guests: 0, rooms: 0, transports: 0, assignments: 0 },
    );
  }, [rows]);

  if (isTripsLoading || rows === undefined) {
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
              onClick: () => {
                void navigate('/trips/new');
              },
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6 md:py-8">
      <PageHeader title={t('analytics.allTripsTitle')} backLink="/trips" />

      <AnalyticsScopeSelector active="all" tripHref={tripScopeHref} />

      <p className="mb-6 text-sm text-muted-foreground">{t('analytics.allTripsDescription')}</p>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('analytics.trips')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{trips.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('analytics.totalGuests')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{totals.guests}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('analytics.totalRooms')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{totals.rooms}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('analytics.totalTransports')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{totals.transports}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('analytics.totalAssignments')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">{totals.assignments}</p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-8">
        <TripsLocationMap trips={trips} />
      </div>

      <h2 className="mb-3 text-base font-semibold">{t('analytics.tripBreakdown')}</h2>
      <ul className="space-y-3" aria-label={t('analytics.tripBreakdown')}>
        {rows.map((row) => (
          <li key={row.trip.id}>
            <Card>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.trip.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('analytics.rowSummary', {
                      guests: row.personCount,
                      rooms: row.roomCount,
                      transports: row.transportCount,
                      assignments: row.assignmentCount,
                    })}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="shrink-0" asChild>
                  <Link to={`/trips/${row.trip.id}/analytics`}>{t('analytics.openTrip')}</Link>
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
});

export { AllTripsAnalyticsPage };
