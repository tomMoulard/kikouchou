/**
 * @fileoverview Trip Create Page for creating new vacation trips.
 * Provides a form interface to create trips with navigation and toast feedback.
 *
 * @module features/trips/pages/TripCreatePage
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useUnsavedChanges } from '@/hooks';

import { PageHeader } from '@/components/shared/PageHeader';
import { UnsavedChangesDialog } from '@/components/shared/UnsavedChangesDialog';
import { Card, CardContent } from '@/components/ui/card';
import { TripForm } from '@/features/trips/components/TripForm';
import { createTrip, setCurrentTrip } from '@/lib/db';
import type { TripFormData } from '@/types';

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
function TripCreatePageComponent(): ReactElement {
  const navigate = useNavigate();
  const { t } = useTranslation();

  // ============================================================================
  // Dirty State & Unsaved Changes Guard
  // ============================================================================

  const [isDirty, setIsDirty] = useState(false);
  const { isBlocked, proceed, reset, skipNextBlock } = useUnsavedChanges(isDirty);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    setIsDirty(dirty);
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

      // Set the new trip as the current trip so CalendarPage can display it
      await setCurrentTrip(newTrip.id);

      // Reset dirty state and skip blocker before navigation.
      // skipNextBlock() prevents the blocker from firing if setIsDirty(false)
      // hasn't re-rendered yet when navigate() executes.
      setIsDirty(false);
      skipNextBlock();

      // Show success toast with fallback for missing translation key
      toast.success(t('trips.created', 'Trip created successfully'));

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
          <TripForm onSubmit={handleSubmit} onCancel={handleCancel} onDirtyChange={handleDirtyChange} />
        </CardContent>
      </Card>

      <UnsavedChangesDialog open={isBlocked} onStay={reset} onLeave={proceed} />
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Memoized Trip Create Page component.
 */
export const TripCreatePage = memo(TripCreatePageComponent);
TripCreatePage.displayName = 'TripCreatePage';
