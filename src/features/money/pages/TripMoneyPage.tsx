/**
 * @fileoverview The trip's money page: who owes what, starting with the nights.
 *
 * Route: `/trips/:tripId/money`
 *
 * The group already keeps its expenses in Tricount — the trip description field
 * invites the link — and the one number that tool cannot work out is how many
 * nights each person slept there. This page hands it over, and divides a bill
 * by it.
 *
 * Like `TripSummaryPage`, the read is keyed on the trip id in the URL rather
 * than on the trip contexts, which lag the URL during a trip switch: a rent
 * share computed from the previous trip's guests is worse than no share.
 *
 * @module features/money/pages/TripMoneyPage
 */

import { type ReactElement, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Wallet } from 'lucide-react';

import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { PageHeader } from '@/components/shared/PageHeader';
import { readAnalytics } from '@/features/analytics/lib/trip-stats';
import { NightSplitCard } from '@/features/money/components/NightSplitCard';
import { loadTripNightSplit } from '@/features/money/lib/night-split';
import { useTripContext } from '@/contexts/TripContext';
import type { TripId } from '@/types';

// ============================================================================
// Page
// ============================================================================

const TripMoneyPage = memo(function TripMoneyPage(): ReactElement {
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

  // `readAnalytics` turns a failed read into a value instead of a throw, so the
  // failure shows as an in-page `ErrorDisplay` rather than replacing the whole
  // route through the ErrorBoundary.
  const result = useLiveQuery(
    async () => {
      if (tripIdFromUrl === undefined) {
        return null;
      }
      return readAnalytics('load the trip night split', () =>
        loadTripNightSplit(tripIdFromUrl as TripId),
      );
    },
    [tripIdFromUrl, retryToken],
  );

  const readError = result?.error ?? null;
  const split = result?.data ?? null;

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

  const isLoading =
    isTripLoading || (tripIdFromUrl !== undefined && result === undefined);

  // ==========================================================================
  // Render: Loading
  // ==========================================================================

  if (isLoading) {
    return (
      <div className="container max-w-3xl py-6 md:py-8">
        <PageHeader title={t('money.title')} />
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
      <div className="container max-w-3xl py-6 md:py-8">
        <PageHeader title={t('money.title')} />
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
  if (!tripIdFromUrl || trip === undefined || split === null) {
    return (
      <div className="container max-w-3xl py-6 md:py-8">
        <PageHeader title={t('money.title')} backLink="/trips" />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <EmptyState
            icon={Wallet}
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
      <div className="container max-w-3xl py-6 md:py-8">
        <PageHeader title={t('money.title')} />
        <ErrorDisplay error={tripError} onRetry={handleRetry} onBack={handleBack} />
      </div>
    );
  }

  // ==========================================================================
  // Render: The Page
  // ==========================================================================

  return (
    <div className="container max-w-3xl space-y-6 py-6 md:py-8">
      <PageHeader title={t('money.title')} description={t('money.description')} />

      <NightSplitCard split={split} />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TripMoneyPage };
export default TripMoneyPage;
