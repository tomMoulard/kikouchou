/**
 * @fileoverview One page for the fridge door: the printable trip summary.
 *
 * Route: `/trips/:tripId/summary`
 *
 * Everything on it comes out of IndexedDB, so the sheet prints with no account
 * and no network — which is the point, since it is meant to be produced the
 * morning everybody leaves and stuck on a kitchen wall for a week.
 *
 * Like `TripAnalyticsPage`, it reads through a loader keyed on the trip id in
 * the URL rather than through the trip-scoped contexts: those lag the URL
 * during a trip switch, and a printed sheet cannot be corrected once it is on
 * the wall.
 *
 * @module features/summary/pages/TripSummaryPage
 */

import { type ReactElement, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { PageHeader } from '@/components/shared/PageHeader';
import { readAnalytics } from '@/features/analytics/lib/trip-stats';
import { SummarySheet } from '@/features/summary/components/SummarySheet';
import { loadTripSummary } from '@/features/summary/lib/trip-summary';
import { useTripContext } from '@/contexts/TripContext';
import type { TripId } from '@/types';

// ============================================================================
// Page
// ============================================================================

const TripSummaryPage = memo(function TripSummaryPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Bumped by Retry, so a failed read is attempted again rather than sitting on
  // the same rejected promise.
  const [retryToken, setRetryToken] = useState(0);
  const { tripId: tripIdFromUrl } = useParams<'tripId'>();

  const {
    trips,
    currentTrip,
    isLoading: isTripLoading,
    error: tripError,
    setCurrentTrip,
    checkConnection,
  } = useTripContext();

  useEffect(() => {
    if (tripIdFromUrl && !isTripLoading && currentTrip?.id !== tripIdFromUrl) {
      setCurrentTrip(tripIdFromUrl).catch((err) => {
        console.error('Failed to set current trip from URL:', err);
      });
    }
  }, [tripIdFromUrl, currentTrip?.id, isTripLoading, setCurrentTrip]);

  // Existence is decided from the trips list rather than from `currentTrip`,
  // which is still the previous trip while a switch is in flight.
  const trip = useMemo(
    () => trips.find((candidate) => candidate.id === tripIdFromUrl),
    [trips, tripIdFromUrl],
  );

  // `readAnalytics` turns a failed read into a value instead of a throw.
  // `useLiveQuery` re-throws a rejected querier *during render*, which hands the
  // failure to the route's ErrorBoundary and replaces the whole page; every list
  // page here shows an in-page `ErrorDisplay` instead. The helper is named for
  // the feature it was written in, not for a rule about analytics — reusing it
  // is what keeps a second copy of that reasoning from existing.
  const result = useLiveQuery(
    async () => {
      if (tripIdFromUrl === undefined) {
        return null;
      }
      return readAnalytics('load the trip summary', () =>
        loadTripSummary(tripIdFromUrl as TripId),
      );
    },
    [tripIdFromUrl, retryToken],
  );

  const readError = result?.error ?? null;
  const summary = result?.data ?? null;

  // The sheet dates itself, so paper found on a wall says how old it is. Fixed
  // at mount rather than read per render: the date must not change between what
  // the screen shows and what the printer receives.
  const [printedOn] = useState(() => new Date());

  const backLink = tripIdFromUrl ? `/trips/${tripIdFromUrl}/calendar` : '/trips';

  const handleBack = useCallback((): void => {
    void navigate(backLink);
  }, [navigate, backLink]);

  const handleRetry = useCallback((): void => {
    void checkConnection().catch(() => {
      // Whatever went wrong is already in the context's own error state.
    });
    setRetryToken((previous) => previous + 1);
  }, [checkConnection]);

  // The browser's own print dialog is the whole feature: it prints on paper and
  // it saves a PDF, on every platform, with nothing to install and no network.
  const handlePrint = useCallback((): void => {
    window.print();
  }, []);

  const isLoading =
    isTripLoading || (tripIdFromUrl !== undefined && result === undefined);

  // ==========================================================================
  // Render: Loading
  // ==========================================================================

  if (isLoading) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader title={t('summary.title')} />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <LoadingState variant="inline" size="lg" />
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: Error
  // ==========================================================================

  if (readError) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader title={t('summary.title')} />
        <ErrorDisplay error={readError} onRetry={handleRetry} onBack={handleBack} />
      </div>
    );
  }

  // ==========================================================================
  // Render: Trip Not Found
  // ==========================================================================

  // Before the context's own error: an id that is not on this device makes
  // `setCurrentTrip` reject, and showing that as "failed to load" with a Retry
  // button is the wrong answer to a mistyped URL.
  if (!tripIdFromUrl || trip === undefined || summary === null) {
    return (
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader title={t('summary.title')} backLink="/trips" />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <EmptyState
            icon={Printer}
            title={t('errors.tripNotFound')}
            description={t('errors.tripNotFoundDescription')}
            action={{ label: t('common.back'), onClick: handleBack }}
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
      <div className="container max-w-4xl py-6 md:py-8">
        <PageHeader title={t('summary.title')} />
        <ErrorDisplay error={tripError} onRetry={handleRetry} onBack={handleBack} />
      </div>
    );
  }

  // ==========================================================================
  // Render: The Sheet
  // ==========================================================================

  return (
    <div className="container max-w-4xl py-6 md:py-8 print:max-w-none print:py-0">
      {/* The header, the hint and the button are screen furniture. Paper gets
          the sheet alone. */}
      <div className="print:hidden">
        <PageHeader
          title={t('summary.title')}
          description={t('summary.description')}
          action={
            <Button onClick={handlePrint}>
              <Printer className="mr-2 size-4" aria-hidden="true" />
              {t('summary.print')}
            </Button>
          }
        />
      </div>

      <SummarySheet summary={summary} printedOn={printedOn} />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TripSummaryPage };
export default TripSummaryPage;
