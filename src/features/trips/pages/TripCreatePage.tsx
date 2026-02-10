/**
 * @fileoverview Trip Create Page for creating new vacation trips.
 * Provides a form interface to create trips with navigation and toast feedback.
 *
 * @module features/trips/pages/TripCreatePage
 */

import { type ReactElement, memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useFormSubmission } from '@/hooks';

import { PageHeader } from '@/components/shared/PageHeader';
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
  // Submission via useFormSubmission hook
  // ============================================================================

  /**
   * Submission handler that creates the trip and navigates on success.
   */
  const { submitError, handleSubmit } = useFormSubmission<TripFormData>(
    async (data) => {
      const newTrip = await createTrip(data);

      // Validate trip was created with valid ID (defensive check for database quirks)
      if (!newTrip?.id) {
        throw new Error('Trip creation failed: missing trip ID');
      }

      // Set the new trip as the current trip so CalendarPage can display it
      await setCurrentTrip(newTrip.id);

      // Show success toast with fallback for missing translation key
      toast.success(t('trips.created', 'Trip created successfully'));

      // Navigate to the new trip's calendar
      navigate(`/trips/${newTrip.id}/calendar`);
    },
  );

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles cancel action by navigating back to trips list.
   */
  const handleCancel = useCallback(() => {
    navigate('/trips');
  }, [navigate]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="container max-w-2xl py-6 md:py-8">
      <PageHeader title={t('trips.new')} backLink="/trips" />

      <Card>
        <CardContent className="pt-6">
          {submitError && (
            <div
              className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mb-4"
              role="alert"
            >
              {submitError}
            </div>
          )}
          <TripForm onSubmit={handleSubmit} onCancel={handleCancel} />
        </CardContent>
      </Card>
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
