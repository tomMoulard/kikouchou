/**
 * @fileoverview Share Import Page for viewing shared trips via public URL.
 * Loads trip data from a shareId URL parameter and allows viewing the trip.
 *
 * @module features/sharing/pages/ShareImportPage
 *
 * Route: /share/:shareId
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { format, isValid, parseISO } from 'date-fns';
import { type Locale, enUS, fr } from 'date-fns/locale';
import { Calendar, ExternalLink, MapPin, Share2 } from 'lucide-react';
import { toast } from 'sonner';

import { LoadingState } from '@/components/shared/LoadingState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { getTripByShareId, setCurrentTrip } from '@/lib/db';
import type { ISODateString, ShareId, Trip } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * URL parameters for the share import route.
 */
export type ShareImportParams = {
  /** The share ID from the URL */
  shareId: string;
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Returns the date-fns locale based on the current language.
 *
 * @param language - The current i18n language code
 * @returns The corresponding date-fns locale
 */
function getDateLocale(language: string): Locale {
  return language === 'fr' ? fr : enUS;
}

/**
 * Formats a date range for display.
 *
 * @param startDate - Start date in ISO format
 * @param endDate - End date in ISO format
 * @param locale - The date-fns locale for formatting
 * @returns Formatted date range string
 */
function formatDateRange(
  startDate: ISODateString,
  endDate: ISODateString,
  locale: Locale,
): string {
  const start = parseISO(startDate),
   end = parseISO(endDate);

  // Fallback to raw values if parsing fails
  if (!isValid(start) || !isValid(end)) {
    return `${startDate} - ${endDate}`;
  }

  const dateFormat = 'PP', // Localized date format (e.g., "Jan 15, 2024")
   startStr = format(start, dateFormat, { locale }),
   endStr = format(end, dateFormat, { locale });

  // Same day - show single date
  if (startDate === endDate) {
    return startStr;
  }

  return `${startStr} - ${endStr}`;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Page component for viewing a shared trip.
 *
 * Features:
 * - Loads trip data from shareId URL parameter
 * - Shows loading state during fetch
 * - Handles not found gracefully with user-friendly message
 * - Displays trip info: name, location (conditional), date range
 * - "View this trip" button sets current trip and navigates to calendar
 * - Uses isMountedRef pattern for async safety
 *
 * @returns The share import page element
 *
 * @example
 * ```tsx
 * // In router configuration
 * <Route path="/share/:shareId" element={<ShareImportPage />} />
 * ```
 */
function ShareImportPageComponent(): ReactElement {
  const navigate = useNavigate(),
   { t, i18n } = useTranslation(),
   { shareId } = useParams<ShareImportParams>(),

  // ============================================================================
  // State
  // ============================================================================

   [trip, setTrip] = useState<Trip | null>(null),
   [isLoading, setIsLoading] = useState(true),
   [notFound, setNotFound] = useState(false),
   [isNavigating, setIsNavigating] = useState(false),

  // ============================================================================
  // Refs for Async Operation Safety
  // ============================================================================

  /**
   * Tracks whether the component is still mounted.
   * Used to prevent state updates after unmount.
   */
   isMountedRef = useRef(true),

  // ============================================================================
  // Derived Values
  // ============================================================================

  /**
   * Date locale for formatting dates based on current language.
   */
   dateLocale = useMemo(
    () => getDateLocale(i18n.language),
    [i18n.language],
  ),

  /**
   * Formatted date range for display.
   */
   formattedDateRange = useMemo(() => {
    if (!trip) {return '';}
    return formatDateRange(trip.startDate, trip.endDate, dateLocale);
  }, [trip, dateLocale]);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Cleanup effect to track component unmount.
   */
  useEffect(() => () => {
      isMountedRef.current = false;
    }, []);

  /**
   * Load trip data when shareId changes.
   * Uses cancelled flag pattern to prevent stale updates.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadTrip(): Promise<void> {
      // Validate shareId presence
      if (!shareId) {
        if (!cancelled && isMountedRef.current) {
          setNotFound(true);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setNotFound(false);

      try {
        const data = await getTripByShareId(shareId as ShareId);

        // Check if request was cancelled (component unmounted or shareId changed)
        if (cancelled || !isMountedRef.current) {
          return;
        }

        if (!data) {
          setNotFound(true);
          setTrip(null);
        } else {
          setTrip(data);
          setNotFound(false);
        }
      } catch (error) {
        // Log error for debugging
        console.error('Failed to load shared trip:', error);

        // Only update state if not cancelled
        if (!cancelled && isMountedRef.current) {
          setNotFound(true);
          setTrip(null);
        }
      } finally {
        // Only update loading state if not cancelled
        if (!cancelled && isMountedRef.current) {
          setIsLoading(false);
        }
      }
    }

    void loadTrip();

    return () => {
      cancelled = true;
    };
  }, [shareId]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles viewing the trip by setting it as current and navigating to calendar.
   * Uses the repository function directly to avoid context dependency issues
   * and ensure the sharing route works even when mounted outside the main layout.
   */
  const handleViewTrip = useCallback(async (): Promise<void> => {
    if (!trip || isNavigating) {return;}

    setIsNavigating(true);

    try {
      // Use repository function directly to set current trip
      // This avoids TripContext dependency which may not be available on public routes
      await setCurrentTrip(trip.id);

      // Only navigate if component is still mounted
      if (isMountedRef.current) {
        navigate('/calendar');
      }
    } catch (error) {
      console.error('Failed to set current trip:', error);

      // Show user feedback on error
      if (isMountedRef.current) {
        toast.error(
          t('sharing.viewError', 'Failed to open the trip. Please try again.'),
        );
      }
    } finally {
      // Always reset navigating state if still mounted
      if (isMountedRef.current) {
        setIsNavigating(false);
      }
    }
  }, [trip, isNavigating, navigate, t]),

  /**
   * Handles navigation to trips list.
   */
   handleGoToTrips = useCallback(() => {
    navigate('/trips');
  }, [navigate]);

  // ============================================================================
  // Render
  // ============================================================================

  // Loading state
  if (isLoading) {
    return <LoadingState variant="fullPage" />;
  }

  // Not found state
  if (notFound || !trip) {
    return (
      <div className="container max-w-md py-12 md:py-16">
        <ErrorDisplay
          title={t('sharing.notFound', 'This shared trip could not be found')}
          onRetry={() => window.location.reload()}
          onBack={handleGoToTrips}
          showMessage={false}
        >
          <p className="text-sm text-muted-foreground text-center">
            {t(
              'sharing.notFoundDescription',
              'The link may have expired or the trip may have been deleted.',
            )}
          </p>
        </ErrorDisplay>
      </div>
    );
  }

  // Success state - show trip info
  return (
    <div className="container max-w-md py-12 md:py-16">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <Share2 className="size-6 text-primary" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">{trip.name}</CardTitle>
          <CardDescription>
            {t(
              'sharing.viewTripDescription',
              "You've been invited to view this trip",
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Trip details */}
          <div className="space-y-3 rounded-lg bg-muted/50 p-4">
            {/* Location (conditional) */}
            {trip.location && (
              <div className="flex items-center gap-3 text-sm">
                <MapPin
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>{trip.location}</span>
              </div>
            )}

            {/* Date range */}
            <div className="flex items-center gap-3 text-sm">
              <Calendar
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span>{formattedDateRange}</span>
            </div>
          </div>

          {/* View trip button */}
          <Button
            className="w-full"
            onClick={handleViewTrip}
            disabled={isNavigating}
          >
            {isNavigating ? (
              t('common.loading', 'Loading...')
            ) : (
              <>
                <ExternalLink className="mr-2 size-4" aria-hidden="true" />
                {t('sharing.viewTrip', 'View this trip')}
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Memoized Share Import Page component.
 */
export const ShareImportPage = memo(ShareImportPageComponent);
ShareImportPage.displayName = 'ShareImportPage';
