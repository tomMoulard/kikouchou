/**
 * @fileoverview Trip Edit Page for modifying and deleting existing vacation trips.
 * Provides form interface with trip data loading, update, and delete functionality.
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
import { toast } from 'sonner';
import { useOfflineAwareToast, useUnsavedChanges } from '@/hooks';
import { Trash2 } from 'lucide-react';

import { PageHeader } from '@/components/shared/PageHeader';
import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TripForm } from '@/features/trips/components/TripForm';
import { useTripContext } from '@/contexts/TripContext';

import { deleteTrip, getTripById, updateTrip } from '@/lib/db';
import posthog, { captureUsage } from '@/lib/posthog';
import type { Trip, TripFormData, TripId } from '@/types';

// ============================================================================
// Component
// ============================================================================

/**
 * Page component for editing an existing trip.
 *
 * Features:
 * - Loads trip data from URL params
 * - Handles loading, error, and success states
 * - Uses TripForm component in edit mode
 * - Supports trip deletion with confirmation dialog
 * - Shows toast notifications on success/error
 * - Prevents double-submission and memory leaks
 *
 * @returns The trip edit page element with form or loading/error state
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
  const { currentTrip, setCurrentTrip } = useTripContext();
  const { successToast } = useOfflineAwareToast();

  // ============================================================================
  // State
  // ============================================================================

  const [trip, setTrip] = useState<Trip | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
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
      successToast(t('trips.updated', 'Trip updated successfully'));

      // Navigate to the trip's calendar
      navigate(`/trips/${tripId}/calendar`);
    },
    [tripId, navigate, skipNextBlock, successToast, t],
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

      if (currentTrip?.id === tripId) {
        try {
          await setCurrentTrip(null);
        } catch (clearErr) {
          console.error('Failed to clear current trip after delete:', clearErr);
        }
      }

      successToast(t('trips.deleted', 'Trip deleted successfully'));
      posthog?.capture('trip_deleted');

      skipNextBlock();

      navigate('/trips', { replace: true });
    } catch (error) {
      // Log error for debugging
      console.error('Failed to delete trip:', error);

      // Only show toast if component is still mounted
      if (isMountedRef.current) {
        toast.error(
          t('errors.deleteFailed', 'Failed to delete. Please try again.'),
        );
      }

      // Do NOT re-throw - ConfirmDialog handles its own error state
      // Throwing here would close the dialog, preventing retry
    } finally {
      isDeletingRef.current = false;
    }
  }, [currentTrip?.id, navigate, setCurrentTrip, skipNextBlock, successToast, t, tripId]);

  /**
   * Handles opening the delete confirmation dialog.
   */
  const handleOpenDeleteDialog = useCallback(() => {
    setIsDeleteDialogOpen(true);
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

  // Loading state
  if (isLoading) {
    return <LoadingState variant="fullPage" />;
  }

  // Error state - trip not found or load error
  if (loadError || !trip) {
    return (
      <div className="container max-w-2xl py-6 md:py-8">
        <PageHeader title={t('trips.edit')} backLink="/trips" />
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

  // Success state - show edit form
  return (
    <div className="container max-w-2xl py-6 md:py-8">
      <PageHeader
        title={t('trips.edit')}
        backLink="/trips"
        action={
          <Button variant="destructive" onClick={handleOpenDeleteDialog}>
            <Trash2 className="mr-2 size-4" aria-hidden="true" />
            {t('common.delete')}
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <TripForm trip={trip} onSubmit={handleSubmit} onCancel={handleCancel} onDirtyChange={handleDirtyChange} />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={handleDeleteDialogOpenChange}
        title={t('confirm.deleteTrip')}
        description={t('confirm.deleteTripDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={handleDelete}
        variant="destructive"
      />

      <UnsavedChangesDialog open={isBlocked} onStay={reset} onLeave={proceed} />
    </div>
  );
});
