/**
 * @fileoverview The trip's own settings page: its name, dates and location, who
 * this browser is on it, its printable summary, and deleting it.
 *
 * Everything that belongs to one trip lives here. `/settings` used to carry the
 * trip form, the delete button, the guest identity card and the print button
 * beside the language and the theme, which put two jobs on one page: a
 * preference that follows the device and a trip that follows the group. The app
 * settings page keeps the preferences, and this page owns the trip.
 *
 * @module features/trips/pages/TripEditPage
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useOfflineAwareNotify, useUnsavedChanges } from '@/hooks';
import { Eye, Share2, Trash2 } from 'lucide-react';

import { PageHeader } from '@/components/shared/PageHeader';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GuestIdentitySelector } from '@/features/trips/components/GuestIdentitySelector';
import { PrintSummaryCard } from '@/features/trips/components/PrintSummaryCard';
import { TripForm } from '@/features/trips/components/TripForm';
import { ShareDialog } from '@/features/sharing';
import { tripAccessOf } from '@/hooks/useTripAccess';
import { useTripContext } from '@/contexts/TripContext';

import { deleteTrip, getTripById, updateTrip } from '@/lib/db';
import posthog, { captureUsage } from '@/lib/posthog';
import { notify } from '@/lib/notifications';
import type { Trip, TripFormData, TripId } from '@/types';

// ============================================================================
// Component
// ============================================================================

/**
 * Page component for one trip's settings.
 *
 * Features:
 * - Loads trip data from URL params
 * - Handles loading, error, and success states
 * - Uses TripForm component in edit mode
 * - Which guest this browser is, and the printable summary
 * - Supports trip deletion with confirmation dialog
 * - Confirms success as an OS notification, reports errors as a toast
 * - Prevents double-submission and memory leaks
 *
 * A viewer trip, opened from an invite link with no account, gets the facts
 * instead of the form: the cards below it read the *current* trip, so the page
 * also puts the trip in the URL into the trip context, the way every other
 * trip-scoped page does.
 *
 * @returns The trip settings page element with form or loading/error state
 *
 * @example
 * ```tsx
 * // In router configuration
 * <Route path="/trips/:tripId/edit" element={<TripEditPage />} />
 * ```
 */
export const TripEditPage = memo(function TripEditPage(): ReactElement {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { tripId } = useParams<{ tripId: string }>();
  const {
    currentTrip,
    setCurrentTrip,
    isLoading: isTripContextLoading,
  } = useTripContext();
  const { notifySuccess } = useOfflineAwareNotify();

  // ============================================================================
  // State
  // ============================================================================

  const [trip, setTrip] = useState<Trip | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // ============================================================================
  // Unsaved Changes Guard
  // ============================================================================

  const { isBlocked, proceed, reset, skipNextBlock } = useUnsavedChanges(isDirty);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    setIsDirty(dirty);
  }, []);

  // ============================================================================
  // Refs for Async Operation Safety
  // ============================================================================

  /**
   * Tracks whether the component is still mounted.
   * Used to prevent state updates and navigation after unmount.
   */
  const isMountedRef = useRef(true);

  /**
   * Guards against double-click during delete operations.
   */
  const isDeletingRef = useRef(false);

  /**
   * Set once the trip is gone, so the effect below stops offering it.
   *
   * A delete clears the current trip and then navigates, and this page renders
   * at least once in between — with `currentTrip` null and the URL still naming
   * the trip that has just been destroyed. Without this the effect would ask
   * the context to select it again, and the trips list would greet the user
   * with "Trip with ID … not found" over the empty state.
   */
  const isDeletedRef = useRef(false);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Cleanup effect to track component unmount.
   */
  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false
    // forever, silently turning every guarded setState into a no-op.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Put the trip in the URL in front of the app, the way every other
   * trip-scoped page does.
   *
   * The guest identity card and the print button read `currentTrip`, and the
   * guests they offer come from `PersonContext`, which is scoped to it too.
   * Without this, opening this page for a trip that is not the selected one
   * would name the guests of a different trip entirely.
   */
  useEffect(() => {
    if (!tripId || isTripContextLoading || isDeletedRef.current) {
      return;
    }
    // Only a trip this page has actually loaded: asking the context to select
    // an id that is not in the database turns a "trip not found" page into a
    // context-wide error that outlives the visit.
    if (trip?.id !== tripId || currentTrip?.id === tripId) {
      return;
    }

    setCurrentTrip(tripId).catch((err: unknown) => {
      console.error('Failed to set current trip from URL:', err);
    });
  }, [tripId, trip?.id, currentTrip?.id, isTripContextLoading, setCurrentTrip]);

  /**
   * Load trip data when tripId changes.
   * Uses cancelled flag pattern to prevent stale updates.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadTrip(): Promise<void> {
      // Validate tripId presence
      if (!tripId) {
        setLoadError(new Error('No trip ID provided'));
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setLoadError(null);

      try {
        const data = await getTripById(tripId as TripId);

        // Check if request was cancelled (component unmounted or tripId changed)
        if (cancelled) {
          return;
        }

        if (!data) {
          setLoadError(new Error('Trip not found'));
          setTrip(null);
        } else {
          setTrip(data);
          setLoadError(null);
        }
      } catch (error) {
        // Only update state if not cancelled
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error : new Error('Failed to load trip'),
          );
          setTrip(null);
        }
      } finally {
        // Only update loading state if not cancelled
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadTrip();

    return () => {
      cancelled = true;
    };
  }, [tripId]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Submission handler for form updates.
   * TripForm handles its own useFormSubmission internally — this is the
   * business logic callback passed as onSubmit.
   */
  const handleSubmit = useCallback(
    async (data: TripFormData): Promise<void> => {
      if (!tripId) return;

      await updateTrip(tripId as TripId, data);

      captureUsage('trip_updated');

      // Reset dirty state and skip blocker before navigation.
      // skipNextBlock() prevents the blocker from firing if setIsDirty(false)
      // hasn't re-rendered yet when navigate() executes.
      setIsDirty(false);
      skipNextBlock();

      // Offline-aware, like every other entity.
      notifySuccess(t('trips.updated', 'Trip updated successfully'));

      // Navigate to the trip's calendar
      navigate(`/trips/${tripId}/calendar`);
    },
    [tripId, navigate, skipNextBlock, notifySuccess, t],
  );

  /**
   * Handles cancel action by navigating back to trips list.
   * Reset dirty state first so the unsaved changes dialog doesn't appear.
   */
  const handleCancel = useCallback(() => {
    setIsDirty(false);
    skipNextBlock();
    navigate('/trips');
  }, [navigate, skipNextBlock]);

  /**
   * Handles trip deletion with confirmation.
   * Called by ConfirmDialog on confirm.
   */
  const handleDelete = useCallback(async (): Promise<void> => {
    // Prevent double-click during deletion
    if (isDeletingRef.current || !tripId) {
      return;
    }

    isDeletingRef.current = true;

    try {
      await deleteTrip(tripId as TripId);
      isDeletedRef.current = true;

      if (currentTrip?.id === tripId) {
        try {
          await setCurrentTrip(null);
        } catch (clearErr) {
          console.error('Failed to clear current trip after delete:', clearErr);
        }
      }

      notifySuccess(t('trips.deleted', 'Trip deleted successfully'));
      posthog?.capture('trip_deleted');

      skipNextBlock();

      navigate('/trips', { replace: true });
    } catch (error) {
      // Log error for debugging
      console.error('Failed to delete trip:', error);

      // Only report the failure if the component is still mounted
      if (isMountedRef.current) {
        notify.error(
          t('errors.deleteFailed', 'Failed to delete. Please try again.'),
        );
      }

      // Do NOT re-throw - ConfirmDialog handles its own error state
      // Throwing here would close the dialog, preventing retry
    } finally {
      isDeletingRef.current = false;
    }
  }, [currentTrip?.id, navigate, setCurrentTrip, skipNextBlock, notifySuccess, t, tripId]);

  /**
   * Handles opening the delete confirmation dialog.
   */
  const handleOpenDeleteDialog = useCallback(() => {
    setIsDeleteDialogOpen(true);
  }, []);

  /**
   * Opens the share dialog (link + QR) for this trip.
   *
   * The same dialog the trip list opens from a card: sharing belongs to the
   * trip, so the page that owns the trip offers it too.
   */
  const handleOpenShareDialog = useCallback(() => {
    setIsShareDialogOpen(true);
  }, []);

  /**
   * Handles share dialog open state changes.
   */
  const handleShareDialogOpenChange = useCallback((open: boolean) => {
    setIsShareDialogOpen(open);
  }, []);

  /**
   * Handles delete dialog open state changes.
   */
  const handleDeleteDialogOpenChange = useCallback((open: boolean) => {
    setIsDeleteDialogOpen(open);
  }, []);

  /**
   * Handles navigation back to trips list from error state.
   */
  const handleBackToTrips = useCallback(() => {
    navigate('/trips');
  }, [navigate]);

  // ============================================================================
  // Render
  // ============================================================================

  // Asked of the loaded row rather than of `useTripAccess()`, which reads the
  // *current* trip: the effect above needs a render to land it, and for that one
  // render an editable form over somebody else's read-only trip is exactly the
  // control this rule exists to hide.
  const canEdit = tripAccessOf(trip) === 'member';

  // Loading state
  if (isLoading) {
    return <LoadingState variant="fullPage" />;
  }

  // Error state - trip not found or load error
  if (loadError || !trip) {
    return (
      <div className="container mx-auto max-w-2xl py-6 md:py-8">
        <PageHeader title={t('trips.settings', 'Trip settings')} backLink="/trips" />
        <ErrorDisplay
          error={loadError}
          title={t('errors.tripNotFound', 'Trip not found')}
          onRetry={() => window.location.reload()}
          onBack={handleBackToTrips}
          showMessage={false}
        >
          <p className="text-sm text-muted-foreground text-center">
            {t(
              'errors.tripNotFoundDescription',
              'The trip you are looking for does not exist or has been deleted.',
            )}
          </p>
        </ErrorDisplay>
      </div>
    );
  }

  // Success state - the trip's own settings
  return (
    <div className="container mx-auto max-w-2xl py-6 md:py-8">
      <PageHeader
        title={t('trips.settings', 'Trip settings')}
        description={t(
          'trips.settingsDescription',
          'The trip itself: its name, its dates, and who you are on it.',
        )}
        backLink="/trips"
        action={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenShareDialog}
              aria-label={t('trips.shareTripAria')}
            >
              <Share2 className="mr-2 size-4" aria-hidden="true" />
              {t('nav.share')}
            </Button>
            <Button variant="destructive" onClick={handleOpenDeleteDialog}>
              <Trash2 className="mr-2 size-4" aria-hidden="true" />
              {t('common.delete')}
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            {canEdit ? (
              <TripForm trip={trip} onSubmit={handleSubmit} onCancel={handleCancel} onDirtyChange={handleDirtyChange} />
            ) : (
              // A read-only trip: the facts, and the one thing that can be done
              // about it here — deleting this device's copy — stays in the header.
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t('trips.name')}</dt>
                  <dd className="font-medium">{trip.name}</dd>
                </div>
                {trip.location && (
                  <div>
                    <dt className="text-muted-foreground">{t('trips.location')}</dt>
                    <dd className="font-medium">{trip.location}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted-foreground">{t('trips.startDate')}</dt>
                  <dd className="font-medium">{trip.startDate}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('trips.endDate')}</dt>
                  <dd className="font-medium">{trip.endDate}</dd>
                </div>
                <p className="flex items-start gap-2 text-muted-foreground sm:col-span-2">
                  <Eye className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t(
                    'viewer.description',
                    'You opened this trip from an invite link. You can see everything and change nothing. Sign in to edit it with the others.',
                  )}
                </p>
              </dl>
            )}
          </CardContent>
        </Card>

        {/* Which guest this browser is — under the trip it belongs to, because
            the answer is per trip and means nothing without one. */}
        <GuestIdentitySelector />

        {/* The printable sheet, reached from here rather than from a navigation
            entry of its own: printing is an occasional action, not a section of
            the trip. */}
        <PrintSummaryCard />
      </div>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={handleDeleteDialogOpenChange}
        title={t('confirm.deleteTrip')}
        description={t('confirm.deleteTripDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={handleDelete}
        variant="destructive"
      />

      <ShareDialog
        open={isShareDialogOpen}
        onOpenChange={handleShareDialogOpenChange}
        trip={trip}
      />

      <UnsavedChangesDialog open={isBlocked} onStay={reset} onLeave={proceed} />
    </div>
  );
});
