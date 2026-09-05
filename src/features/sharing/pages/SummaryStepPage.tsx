/**
 * @fileoverview Summary Step — Step 5 (final) of the guest onboarding wizard.
 * Displays a summary of the guest's identity, room assignment, and transport
 * details, with the ability to go back and change each section. The "Enter trip"
 * action sets the current trip and navigates into the app.
 *
 * @module features/sharing/pages/SummaryStepPage
 *
 * Route: /share/:shareId/summary
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
import {
  Bed,
  ChevronRight,
  ClipboardCheck,
  SearchX,
  Train,
  User,
} from 'lucide-react';

import { LoadingState } from '@/components/shared/LoadingState';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { onboardingSurface, statusVariants } from '@/components/ui/status.variants';

import {
  getAssignmentsByPersonId,
  getPersonById,
  getRoomById,
  getTransportsByPersonId,
  getTripByShareId,
  setCurrentTrip,
} from '@/lib/db';
import { getGuestIdentityStorageKey } from '@/lib/sharing/guest-identity';
import { createBaselineForGuest } from '@/lib/sharing';
import { cn } from '@/lib/utils';
import type {
  Person,
  PersonId,
  Room,
  ShareId,
  Transport,
  Trip,
} from '@/types';
import { formatDatetime, getTransportIcon } from '../components/transport-display-helpers';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * URL parameters for the summary step route.
 */
type SummaryStepParams = {
  /** The share ID from the URL */
  shareId: string;
};

// ============================================================================
// Constants
// ============================================================================

/**
 * Returns the localStorage key for wizard completion flag.
 */
const getWizardCompleteKey = (shareId: string): string =>
  `kikouchou_wizard_complete_${shareId}`;

// ============================================================================
// Component
// ============================================================================

/**
 * Summary step for the guest onboarding wizard.
 *
 * Features:
 * - Guards against missing identity (redirects to identity step)
 * - Loads trip, guest, room assignment, and transports on mount
 * - Displays three tappable summary sections (identity, room, transport)
 * - Each section navigates back to its respective wizard step for editing
 * - "Enter trip" action: setCurrentTrip() + wizard-complete flag + navigate to calendar
 * - Uses repository-only data access (AR-10 — outside AppProviders)
 * - Uses isMountedRef + cancelled-flag pattern for async safety
 */
export const SummaryStepPage = memo(function SummaryStepPage(): ReactElement {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { shareId } = useParams<SummaryStepParams>();

  // ============================================================================
  // State
  // ============================================================================

  const [trip, setTrip] = useState<Trip | undefined>(undefined);
  const [guest, setGuest] = useState<Person | undefined>(undefined);
  const [claimedRoom, setClaimedRoom] = useState<Room | undefined>(undefined);
  const [transports, setTransports] = useState<Transport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  /** The personId of the guest retrieved from localStorage */
  const [guestPersonId, setGuestPersonId] = useState<PersonId | undefined>();
  /** The tripId from the stored identity for cross-validation */
  const storedTripIdRef = useRef<string | undefined>(undefined);

  /** Whether "Enter trip" is submitting */
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Error from "Enter trip" action */
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);

  // ============================================================================
  // Refs for Async Operation Safety
  // ============================================================================

  const isMountedRef = useRef(true);
  const isSubmittingRef = useRef(false);

  // ============================================================================
  // Effects
  // ============================================================================

  /** Cleanup effect to track component unmount. */
  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false
    // forever, silently turning every guarded setState into a no-op.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /** Guard: read guest identity from localStorage on mount. */
  useEffect(() => {
    if (!shareId) return;

    const stored = localStorage.getItem(getGuestIdentityStorageKey(shareId));
    if (!stored) {
      navigate(`/share/${shareId}/identity`, { replace: true });
      return;
    }
    try {
      const identity = JSON.parse(stored) as { personId: string; tripId: string };
      if (!identity.personId?.trim() || !identity.tripId?.trim()) {
        navigate(`/share/${shareId}/identity`, { replace: true });
        return;
      }
      setGuestPersonId(identity.personId.trim() as PersonId);
      storedTripIdRef.current = identity.tripId.trim();
    } catch {
      navigate(`/share/${shareId}/identity`, { replace: true });
    }
  }, [shareId, navigate]);

  /** Load all summary data when shareId and guestPersonId are available. */
  useEffect(() => {
    let cancelled = false;

    async function loadData(): Promise<void> {
      if (!shareId || !guestPersonId) {
        return;
      }

      setIsLoading(true);
      try {
        const tripData = await getTripByShareId(shareId as ShareId);
        if (cancelled || !isMountedRef.current) return;
        if (!tripData) {
          setNotFound(true);
          return;
        }

        // Cross-validate stored identity tripId
        if (storedTripIdRef.current !== undefined && storedTripIdRef.current !== tripData.id) {
          try { localStorage.removeItem(getGuestIdentityStorageKey(shareId)); } catch { /* non-fatal */ }
          navigate(`/share/${shareId}/identity`, { replace: true });
          return;
        }

        setTrip(tripData);

        // Load guest person
        const personData = await getPersonById(guestPersonId);
        if (cancelled || !isMountedRef.current) return;
        if (personData) setGuest(personData);

        // Load room assignment for this guest in this trip
        const assignments = await getAssignmentsByPersonId(guestPersonId);
        if (cancelled || !isMountedRef.current) return;
        const tripAssignment = assignments.find(a => a.tripId === tripData.id);
        if (tripAssignment) {
          const room = await getRoomById(tripAssignment.roomId);
          if (!cancelled && isMountedRef.current && room) setClaimedRoom(room);
        }

        // Load transports for this guest in this trip
        const allTransports = await getTransportsByPersonId(guestPersonId);
        if (!cancelled && isMountedRef.current) {
          setTransports(allTransports.filter(tr => tr.tripId === tripData.id));
        }
      } catch (error) {
        console.error('Failed to load summary data:', error);
        if (!cancelled && isMountedRef.current) setNotFound(true);
      } finally {
        if (!cancelled && isMountedRef.current) setIsLoading(false);
      }
    }

    void loadData();
    return () => { cancelled = true; };
  }, [shareId, guestPersonId, navigate]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /** Handles "Enter trip" action. */
  const handleEnterTrip = useCallback(async (): Promise<void> => {
    if (isSubmittingRef.current || !trip || !shareId || !guestPersonId) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(undefined);

    try {
      await setCurrentTrip(trip.id);
      if (!isMountedRef.current) return;

      // Save import baseline for future QR export (non-fatal if it fails)
      try { await createBaselineForGuest(trip.id, shareId, guestPersonId); } catch { /* non-fatal */ }

      // Mark wizard as completed for this share link (non-fatal if storage fails)
      try { localStorage.setItem(getWizardCompleteKey(shareId), 'true'); } catch { /* non-fatal */ }

      // Navigate INTO the context boundary
      navigate(`/trips/${trip.id}/calendar`);
    } catch (error) {
      console.error('Failed to enter trip:', error);
      if (isMountedRef.current) {
        setSubmitError(t('sharing.summaryEnterTripError', 'Failed to enter trip. Please try again.'));
      }
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) setIsSubmitting(false);
    }
  }, [trip, shareId, guestPersonId, navigate, t]);

  // ============================================================================
  // Render
  // ============================================================================

  // Loading state
  if (isLoading) {
    return <LoadingState variant="fullPage" />;
  }

  // Not found / error state
  if (notFound || trip === undefined) {
    return (
      <div className={cn('flex min-h-svh items-center justify-center p-4', onboardingSurface)}>
        <Card className="w-full max-w-md border-warning-border text-center shadow-lg">
          <CardHeader className="pb-2 pt-8">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-warning/20">
              <SearchX className="size-8 text-warning-on-surface" aria-hidden="true" />
            </div>
            <CardTitle className="text-xl text-warning-on-surface">
              {t('sharing.notFoundWizard', "This trip link doesn't seem to work")}
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

  return (
    <div className={cn('flex min-h-svh items-center justify-center p-4', onboardingSurface)}>
      <Card className="w-full max-w-md border-warning-border shadow-lg">
        <CardHeader className="pb-4 pt-8 text-center">
          {/* Warm checkmark icon */}
          <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-warning/20">
            <ClipboardCheck className="size-10 text-warning-on-surface" aria-hidden="true" />
          </div>

          <CardTitle className="text-2xl font-bold text-warning-on-surface">
            {t('sharing.summaryTitle', "You're all set!")}
          </CardTitle>

          <p className="mt-1 text-sm text-muted-foreground">
            {t('sharing.summarySubtitle', "Here's a summary of your trip setup")}
          </p>
        </CardHeader>

        <CardContent className="space-y-3 pb-8">
          {/* Identity section */}
          <button
            type="button"
            onClick={() => navigate(`/share/${shareId}/identity`)}
            className="flex min-h-[44px] w-full cursor-pointer items-center justify-between rounded-lg border border-warning-border bg-card p-4 text-left transition-colors hover:border-warning"
            aria-label={t('sharing.summaryChangeIdentity', 'Change identity')}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <User className="size-4 text-warning-on-surface" aria-hidden="true" />
                <span className="text-sm font-medium text-warning-on-surface">
                  {t('sharing.summaryIdentityLabel', 'Identity')}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                {guest?.color && (
                  <span
                    className="inline-block size-3 rounded-full"
                    style={{ backgroundColor: guest.color }}
                    aria-hidden="true"
                  />
                )}
                <span className="text-sm text-foreground">
                  {guest?.name ?? t('sharing.summaryUnknown', 'Unknown')}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-sm text-warning-on-surface">
              {t('sharing.summaryChange', 'Change')}
              <ChevronRight className="size-4" aria-hidden="true" />
            </div>
          </button>

          {/* Room section */}
          <button
            type="button"
            onClick={() => navigate(`/share/${shareId}/room`)}
            className="flex min-h-[44px] w-full cursor-pointer items-center justify-between rounded-lg border border-warning-border bg-card p-4 text-left transition-colors hover:border-warning"
            aria-label={t('sharing.summaryChangeRoom', 'Change room')}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Bed className="size-4 text-warning-on-surface" aria-hidden="true" />
                <span className="text-sm font-medium text-warning-on-surface">
                  {t('sharing.summaryRoomLabel', 'Room')}
                </span>
              </div>
              <div className="mt-1">
                {claimedRoom ? (
                  <span className="text-sm text-foreground">{claimedRoom.name}</span>
                ) : (
                  <span className="text-sm italic text-muted-foreground">
                    {t('sharing.summaryRoomEmpty', 'Not yet assigned')}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 text-sm text-warning-on-surface">
              {t('sharing.summaryChange', 'Change')}
              <ChevronRight className="size-4" aria-hidden="true" />
            </div>
          </button>

          {/* Transport section */}
          <button
            type="button"
            onClick={() => navigate(`/share/${shareId}/transport`)}
            className="flex min-h-[44px] w-full cursor-pointer items-center justify-between rounded-lg border border-warning-border bg-card p-4 text-left transition-colors hover:border-warning"
            aria-label={t('sharing.summaryChangeTransport', 'Change transport')}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Train className="size-4 text-warning-on-surface" aria-hidden="true" />
                <span className="text-sm font-medium text-warning-on-surface">
                  {t('sharing.summaryTransportLabel', 'Transport')}
                </span>
              </div>
              <div className="mt-1">
                {transports.length > 0 ? (
                  <div className="space-y-1">
                    {transports.map((tr) => (
                      <div key={tr.id} className="flex items-center gap-2 text-sm text-foreground">
                        {getTransportIcon(tr.transportMode, t)}
                        <span>
                          {tr.type === 'arrival'
                            ? t('sharing.transportArrival', 'Arrival')
                            : t('sharing.transportDeparture', 'Departure')}
                          : {formatDatetime(tr.datetime, i18n.language)}
                        </span>
                        {tr.location && (
                          <span className="text-muted-foreground">{tr.location}</span>
                        )}
                        {tr.needsPickup && (
                          <span className="rounded bg-warning-surface px-1.5 py-0.5 text-xs text-warning-on-surface">
                            {t('sharing.transportNeedsPickupBadge', 'Needs pickup')}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-sm italic text-muted-foreground">
                    {t('sharing.summaryTransportEmpty', 'None added')}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 text-sm text-warning-on-surface">
              {t('sharing.summaryChange', 'Change')}
              <ChevronRight className="size-4" aria-hidden="true" />
            </div>
          </button>

          {/* Enter trip button */}
          <Button
            type="button"
            onClick={() => { void handleEnterTrip(); }}
            disabled={isSubmitting}
            className={cn('mt-4 h-12 w-full text-base font-semibold', statusVariants({ tone: 'warning', emphasis: 'solid' }))}
            aria-describedby={submitError ? 'enter-trip-error' : undefined}
          >
            {isSubmitting
              ? t('sharing.summaryEntering', 'Entering...')
              : t('sharing.summaryEnterTrip', "Let's go!")}
          </Button>

          {/* Error message */}
          {submitError !== undefined && (
            <p id="enter-trip-error" role="alert" className="mt-2 text-center text-sm text-destructive">
              {submitError}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
});

export default SummaryStepPage;
