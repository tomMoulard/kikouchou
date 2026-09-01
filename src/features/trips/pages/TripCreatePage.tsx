/**
 * @fileoverview Trip Create Page for creating new vacation trips.
 * Provides a form interface to create trips with navigation and toast feedback.
 *
 * @module features/trips/pages/TripCreatePage
 */

import { type ReactElement, memo, useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useUnsavedChanges } from '@/hooks';

import { PageHeader } from '@/components/shared/PageHeader';
import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesDialog';
import { Card, CardContent } from '@/components/ui/card';
import { TripForm } from '@/features/trips/components/TripForm';
import { createTrip, setCurrentTrip, cloneRoomsToTrip } from '@/lib/db';
import posthog from '@/lib/posthog';
import type { TripFormData, TripId } from '@/types';

// ============================================================================
// Component
// ============================================================================

/**
 * Page component for creating a new trip.
 *
 * Features:
 * - Uses TripForm component for form UI and validation
 * - Shows toast notifications on success/error
 * - Navigates to trip calendar on successful creation
 * - Prevents double-submission during async operations
 * - Handles unmount during async operations to prevent memory leaks
 *
 * @returns The trip create page element
 *
 * @example
 * ```tsx
 * // In router configuration
 * <Route path="/trips/new" element={<TripCreatePage />} />
 * ```
 */
export const TripCreatePage = memo(function TripCreatePage(): ReactElement {
  const navigate = useNavigate();
  const { t } = useTranslation();

  // ============================================================================
  // Dirty State & Unsaved Changes Guard
  // ============================================================================

  const [isDirty, setIsDirty] = useState(false);
  const { isBlocked, proceed, reset, skipNextBlock } = useUnsavedChanges(isDirty);
  const importSourceRef = useRef<TripId | null>(null);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    setIsDirty(dirty);
  }, []);

  /**
   * Tracks the import source trip ID from TripForm.
   */
  const handleImportSourceChange = useCallback((sourceTripId: TripId | null) => {
    importSourceRef.current = sourceTripId;
  }, []);

  // ============================================================================
  // Submission Handler
  // ============================================================================

  /**
   * Submission handler that creates the trip and navigates on success.
   * TripForm handles its own useFormSubmission internally — this is the
   * business logic callback passed as onSubmit.
   */
  const handleSubmit = useCallback(
    async (data: TripFormData): Promise<void> => {
      const newTrip = await createTrip(data);

      // Validate trip was created with valid ID (defensive check for database quirks)
      if (!newTrip?.id) {
        throw new Error('Trip creation failed: missing trip ID');
      }

      // Clone rooms from import source if one was selected
      let didImportRooms = false;
      if (importSourceRef.current) {
        try {
          await cloneRoomsToTrip(importSourceRef.current, newTrip.id);
          didImportRooms = true;
        } catch (error) {
          console.error('Failed to clone rooms from import source:', error);
          // Trip is created — show warning but don't block navigation
          toast.error(t('trips.importRoomsFailed', 'Trip created but room import failed'));
        }
      }

      // Set the new trip as the current trip so CalendarPage can display it
      await setCurrentTrip(newTrip.id);

      posthog?.capture('trip_created', { imported_rooms: didImportRooms });

      // Reset dirty state and skip blocker before navigation.
      // skipNextBlock() prevents the blocker from firing if setIsDirty(false)
      // hasn't re-rendered yet when navigate() executes.
      setIsDirty(false);
      skipNextBlock();

      // Show success toast with fallback for missing translation key
      if (didImportRooms) {
        toast.success(t('trips.createdWithImport', 'Trip created with rooms imported'));
      } else if (!importSourceRef.current) {
        toast.success(t('trips.created', 'Trip created successfully'));
      }

      // Navigate to the new trip's calendar
      navigate(`/trips/${newTrip.id}/calendar`);
    },
    [navigate, skipNextBlock, t],
  );

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles cancel action by navigating back to trips list.
   * Reset dirty state first so the unsaved changes dialog doesn't appear.
   */
  const handleCancel = useCallback(() => {
    setIsDirty(false);
    skipNextBlock();
    navigate('/trips');
  }, [navigate, skipNextBlock]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="container max-w-2xl py-6 md:py-8">
      <PageHeader title={t('trips.new')} backLink="/trips" />

      <Card>
        <CardContent className="pt-6">
          <TripForm onSubmit={handleSubmit} onCancel={handleCancel} onDirtyChange={handleDirtyChange} onImportSourceChange={handleImportSourceChange} />
        </CardContent>
      </Card>

      <UnsavedChangesDialog open={isBlocked} onStay={reset} onLeave={proceed} />
    </div>
  );
});
