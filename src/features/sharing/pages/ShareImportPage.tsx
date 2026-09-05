/**
 * @fileoverview Share Import Page — Welcome screen for guests arriving via shared link.
 * Loads trip data from a shareId URL parameter, detects returning guests, and
 * either redirects directly to the trip dashboard or shows the welcome CTA.
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
import { Calendar, MapPin, Palmtree, SearchX } from 'lucide-react';
import { toast } from 'sonner';

import { LoadingState } from '@/components/shared/LoadingState';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { onboardingSurface, statusVariants } from '@/components/ui/status.variants';

import { getTripByShareId, setCurrentTrip } from '@/lib/db';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { formatDateRange } from '@/lib/utils/date-format';
import type { ShareId, Trip } from '@/types';

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

/**
 * Shape of the guest identity stored in localStorage.
 */
interface StoredGuestIdentity {
  personId: string;
  tripId: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Returns the localStorage key used to persist guest identity across visits.
 *
 * @param shareId - The share ID from the URL
 * @returns The localStorage key string
 */
const getGuestStorageKey = (shareId: string): string =>
  `kikouchou_guest_${shareId}`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Type guard that validates a parsed JSON value matches StoredGuestIdentity.
 *
 * @param obj - The unknown value to validate
 * @returns True if the value is a valid StoredGuestIdentity
 */
function isValidStoredGuestIdentity(obj: unknown): obj is StoredGuestIdentity {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'personId' in obj &&
    'tripId' in obj &&
    typeof (obj as StoredGuestIdentity).personId === 'string' &&
    typeof (obj as StoredGuestIdentity).tripId === 'string'
  );
}

/**
 * Reads a stored guest identity from localStorage.
 * Returns undefined on parse failure or if nothing is stored.
 *
 * @param shareId - The share ID from the URL
 * @returns The stored guest identity or undefined
 */
function getStoredGuestIdentity(shareId: string): StoredGuestIdentity | undefined {
  try {
    const raw = localStorage.getItem(getGuestStorageKey(shareId));
    if (!raw) {return undefined;}
    const parsed: unknown = JSON.parse(raw);
    return isValidStoredGuestIdentity(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Welcome screen for guests arriving via a shared trip link.
 *
 * Features:
 * - Loads trip data from shareId URL parameter using repository functions directly (AR-10)
 * - Detects returning guests via localStorage and redirects to trip calendar
 * - Shows warm, vacation-themed welcome card with trip name, date range, and location
 * - "Get Started" CTA navigates to the onboarding wizard (Step 2: identity)
 * - Friendly not-found message with no technical jargon
 * - Uses isMountedRef + cancelled-flag pattern for async safety
 *
 * @returns The share import page element
 *
 * @example
 * ```tsx
 * // In router configuration
 * <Route path="/share/:shareId" element={<ShareImportPage />} />
 * ```
 */
export const ShareImportPage = memo(function ShareImportPage(): ReactElement {
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
   * Load trip data when shareId changes.
   * After loading, checks localStorage for a returning guest identity and
   * auto-redirects to the trip calendar if found.
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
          // Returning guest detection: check localStorage before rendering the CTA
          const storedIdentity = getStoredGuestIdentity(shareId);
          if (storedIdentity?.tripId === data.id) {
            // Returning guest — skip wizard and go straight to the trip calendar.
            // Do NOT set isLoading(false) here: trip is still null, which would
            // briefly flash the "not found" UI before navigation completes.
            try {
              await setCurrentTrip(data.id);
              if (!cancelled && isMountedRef.current) {
                navigate(`/trips/${data.id}/calendar`);
              }
            } catch (error) {
              console.error('Failed to redirect returning guest:', error);
              // Fall through: show welcome screen instead of crashing.
              // Only now is it safe to stop loading (trip is set first).
              if (!cancelled && isMountedRef.current) {
                setTrip(data);
                setNotFound(false);
                setIsLoading(false);
              }
            }
            return;
          }

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
  }, [shareId, navigate]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles the "Get Started" CTA — navigates to the identity wizard step.
   * Uses repository function directly to avoid context dependency issues (AR-10).
   */
  const handleGetStarted = useCallback(async (): Promise<void> => {
    if (!trip || isNavigating) {return;}

    setIsNavigating(true);

    try {
      // Set current trip so downstream wizard steps can access it
      await setCurrentTrip(trip.id);

      // Only navigate if component is still mounted
      if (isMountedRef.current) {
        navigate(`/share/${shareId}/identity`);
      }
    } catch (error) {
      console.error('Failed to start onboarding:', error);

      if (isMountedRef.current) {
        toast.error(
          t('sharing.viewError', 'Failed to open the trip. Please try again.'),
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsNavigating(false);
      }
    }
  }, [trip, isNavigating, navigate, shareId, t]);

  // ============================================================================
  // Render
  // ============================================================================

  // Loading state
  if (isLoading) {
    return <LoadingState variant="fullPage" />;
  }

  // Not found state — friendly message, no technical jargon
  if (notFound || !trip) {
    return (
      <div className={cn('flex min-h-svh items-center justify-center p-4', onboardingSurface)}>
        <Card className="w-full max-w-md border-warning-border text-center shadow-lg">
          <CardHeader className="pb-2 pt-8">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-warning/20">
              <SearchX className="size-8 text-warning-on-surface" aria-hidden="true" />
            </div>
            <CardTitle className="text-xl text-warning-on-surface">
              {t('sharing.notFoundWizard', 'This trip link doesn\'t seem to work')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-8">
            <p className="text-sm text-muted-foreground">
              {t(
                'sharing.notFoundWizardDescription',
                'The link may be incorrect or the trip may no longer exist.',
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state — warm welcome screen
  return (
    <div className={cn('flex min-h-svh items-center justify-center p-4', onboardingSurface)}>
      <Card className="w-full max-w-md border-warning-border shadow-lg">
        <CardHeader className="pb-4 pt-8 text-center">
          {/* Warm vacation icon */}
          <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-warning/20">
            <Palmtree className="size-10 text-warning-on-surface" aria-hidden="true" />
          </div>

          {/* Trip name — visually prominent */}
          <CardTitle className="text-2xl font-bold text-warning-on-surface">
            {t('sharing.welcome', { tripName: trip.name })}
          </CardTitle>

          <p className="mt-1 text-sm text-muted-foreground">
            {t('sharing.welcomeSubtitle', "You've been invited to join this trip")}
          </p>
        </CardHeader>

        <CardContent className="space-y-6 pb-8">
          {/* Trip details — scannable at a glance */}
          <div className={cn('space-y-3 rounded-xl p-4', statusVariants({ tone: 'warning', emphasis: 'surface' }))}>
            {/* Location (conditional) */}
            {trip.location && (
              <div className="flex items-center gap-3 text-sm text-foreground">
                <MapPin
                  className="size-4 shrink-0 text-warning-on-surface"
                  aria-hidden="true"
                />
                <span>{trip.location}</span>
              </div>
            )}

            {/* Date range */}
            <div className="flex items-center gap-3 text-sm text-foreground">
              <Calendar
                className="size-4 shrink-0 text-warning-on-surface"
                aria-hidden="true"
              />
              <span>{formattedDateRange}</span>
            </div>
          </div>

          {/* Get Started — primary CTA, min 44px touch target */}
          <Button
            className={cn('h-12 w-full text-base font-semibold', statusVariants({ tone: 'warning', emphasis: 'solid' }))}
            onClick={handleGetStarted}
            disabled={isNavigating}
          >
            {isNavigating
              ? t('common.loading', 'Loading...')
              : t('sharing.getStarted', 'Get Started')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
});
