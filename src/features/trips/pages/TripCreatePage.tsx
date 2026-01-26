/**
 * @fileoverview Trip Create Page for creating new vacation trips.
 * Provides a form interface to create trips with navigation and toast feedback.
 *
 * @module features/trips/pages/TripCreatePage
 */

import { memo, useCallback, useEffect, useRef, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { TripForm } from '@/features/trips/components/TripForm';
import { createTrip } from '@/lib/db';
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
  // Refs for Async Operation Safety
  // ============================================================================

  /**
   * Tracks whether the component is still mounted.
   * Used to prevent state updates and navigation after unmount.
   */
  const isMountedRef = useRef(true);

  /**
   * Guards against double-submission during async operations.
   * Synchronous check prevents race conditions between rapid clicks.
   */
  const isSubmittingRef = useRef(false);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Cleanup effect to track component unmount.
   */
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles form submission by creating the trip and navigating on success.
   * Includes guards for double-submission and unmount safety.
   */
  const handleSubmit = useCallback(
    async (data: TripFormData): Promise<void> => {
      // Prevent double-submission
      if (isSubmittingRef.current) {
        return;
      }

      isSubmittingRef.current = true;

      try {
        const newTrip = await createTrip(data);

        // Only proceed if component is still mounted
        if (!isMountedRef.current) {
          return;
        }

        // Validate trip was created with valid ID (defensive check for database quirks)
        if (!newTrip?.id) {
          throw new Error('Trip creation failed: missing trip ID');
        }

        // Show success toast with fallback for missing translation key
        toast.success(t('trips.created', 'Trip created successfully'));

        // Navigate to the new trip's calendar
        navigate(`/trips/${newTrip.id}/calendar`);
      } catch (error) {
        // Log error for debugging
        console.error('Failed to create trip:', error);

        // Only show toast if component is still mounted
        if (isMountedRef.current) {
          toast.error(t('errors.saveFailed', 'Failed to save. Please try again.'));
        }

        // Re-throw to let TripForm handle its internal error state
        throw error;
      } finally {
        isSubmittingRef.current = false;
      }
    },
    [navigate, t],
  );

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
