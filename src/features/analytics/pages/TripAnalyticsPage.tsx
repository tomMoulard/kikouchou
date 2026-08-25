/**
 * @fileoverview Analytics overview for the trip in the URL (current trip context).
 *
 * @module features/analytics/pages/TripAnalyticsPage
 */

import { type ReactElement, memo, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { getPersonHeadcount } from '@/types';
import { BarChart2 } from 'lucide-react';

import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { LoadingState } from '@/components/shared/LoadingState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AnalyticsScopeSelector } from '@/features/analytics/components/AnalyticsScopeSelector';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';
import { cn } from '@/lib/utils';

// ============================================================================
// Subcomponents
// ============================================================================

const StatCard = memo(function StatCard({
  label,
  value,
  className,
}: {
  readonly label: string;
  readonly value: number | string;
  readonly className?: string;
}): ReactElement {
  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Page
// ============================================================================

const TripAnalyticsPage = memo(function TripAnalyticsPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tripId: tripIdFromUrl } = useParams<'tripId'>();

  const { currentTrip, isLoading: isTripLoading, setCurrentTrip } = useTripContext();
  const { persons, isLoading: isPersonsLoading } = usePersonContext();
  const { rooms, isLoading: isRoomsLoading } = useRoomContext();
  const { assignments, isLoading: isAssignmentsLoading } = useAssignmentContext();
  const {
    arrivals,
    departures,
    upcomingPickups,
    isLoading: isTransportsLoading,
  } = useTransportContext();

  useEffect(() => {
    if (tripIdFromUrl && !isTripLoading && currentTrip?.id !== tripIdFromUrl) {
      setCurrentTrip(tripIdFromUrl).catch((err) => {
        console.error('Failed to set current trip from URL:', err);
      });
    }
  }, [tripIdFromUrl, currentTrip?.id, isTripLoading, setCurrentTrip]);

  const tripMismatch = useMemo(() => {
    if (!tripIdFromUrl || !currentTrip) {
      return false;
    }
    return tripIdFromUrl !== currentTrip.id;
  }, [tripIdFromUrl, currentTrip]);

  // A guest entry can stand for several real people, so the headline number
  // must sum headcount rather than count rows.
  const guestHeadcount = useMemo(
    () => persons.reduce((total, person) => total + getPersonHeadcount(person), 0),
    [persons],
  );

  const pickupsNeedingDriver = useMemo(
    () => upcomingPickups.filter((tr) => tr.needsPickup && !tr.driverId).length,
    [upcomingPickups],
  );

  const tripAnalyticsHref = useMemo(
    () => (tripIdFromUrl ? `/trips/${tripIdFromUrl}/analytics` : '/trips'),
    [tripIdFromUrl],
  );

  const isLoading =
    isTripLoading ||
    isPersonsLoading ||
    isRoomsLoading ||
    isAssignmentsLoading ||
    isTransportsLoading;

  const handleBack = (): void => {
    if (tripIdFromUrl) {
      navigate(`/trips/${tripIdFromUrl}/calendar`);
      return;
    }
    navigate('/trips');
  };

  if (isLoading) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader
          title={t('analytics.tripTitle')}
          backLink={tripIdFromUrl ? `/trips/${tripIdFromUrl}/calendar` : '/trips'}
        />
        <AnalyticsScopeSelector active="trip" tripHref={tripAnalyticsHref} />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <LoadingState variant="inline" size="lg" />
        </div>
      </div>
    );
  }

  if (!tripIdFromUrl || !currentTrip || tripMismatch) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader title={t('analytics.tripTitle')} backLink="/trips" />
        <AnalyticsScopeSelector active="trip" tripHref={tripAnalyticsHref} />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <EmptyState
            icon={BarChart2}
            title={t('errors.tripNotFound', 'Trip not found')}
            description={t(
              'errors.tripNotFoundDescription',
              'The trip you are looking for does not exist or you do not have access to it.',
            )}
            action={{
              label: t('common.back'),
              onClick: handleBack,
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl py-6 md:py-8">
      <PageHeader
        title={t('analytics.tripTitle')}
        backLink={`/trips/${tripIdFromUrl}/calendar`}
      />

      <AnalyticsScopeSelector active="trip" tripHref={tripAnalyticsHref} />

      <p className="mb-6 text-sm text-muted-foreground">{t('analytics.tripDescription')}</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={t('analytics.guests')} value={guestHeadcount} />
        <StatCard label={t('analytics.rooms')} value={rooms.length} />
        <StatCard label={t('analytics.assignments')} value={assignments.length} />
        <StatCard label={t('analytics.arrivals')} value={arrivals.length} />
        <StatCard label={t('analytics.departures')} value={departures.length} />
        <StatCard label={t('analytics.pickupsNeedingDriver')} value={pickupsNeedingDriver} />
      </div>
    </div>
  );
});

export { TripAnalyticsPage };
