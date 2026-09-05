/**
 * @fileoverview Room Selection Step — Step 3 of the guest onboarding wizard.
 * Allows guests to browse available rooms and claim one for the full trip duration.
 * Guards against skipping the identity step by reading stored guest identity.
 *
 * @module features/sharing/pages/RoomSelectionStepPage
 *
 * Route: /share/:shareId/room
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
import { BedDouble, Check, SearchX } from 'lucide-react';

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
  calculatePeakOccupancyByRoom,
  createHeadcountResolver,
  summarizeRoomOccupancy,
} from '@/features/rooms/utils/capacity-utils';
import {
  checkAssignmentConflict,
  createAssignment,
  getAssignmentsByTripId,
  getPersonsByTripId,
  getRoomsByTripId,
  getTripByShareId,
} from '@/lib/db';
import { getGuestIdentityStorageKey } from '@/lib/sharing/guest-identity';
import { cn } from '@/lib/utils';
import type {
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomId,
  ShareId,
  Trip,
  TripId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * URL parameters for the room selection step route.
 */
type RoomSelectionStepParams = {
  /** The share ID from the URL */
  shareId: string;
};

// ============================================================================
// Constants
// ============================================================================

// ============================================================================
// Component
// ============================================================================

/**
 * Room selection step for the guest onboarding wizard.
 *
 * Features:
 * - Guards against missing identity (redirects to identity step)
 * - Loads trip, rooms and assignments in parallel
 * - Displays each room with capacity indicator and visual progress bar
 * - Full rooms are dimmed with a "Full" badge and disabled button
 * - "Claim this room" checks for conflicts before creating assignment
 * - Shows inline conflict or error message without navigating away
 * - After claiming: card shows "Claimed ✓" and the "Next" button is enabled
 * - "Skip for now" navigates to transport step without claiming
 * - Uses repository-only data access (AR-10 — outside AppProviders)
 * - Uses isMountedRef + cancelled-flag pattern for async safety
 *
 * @returns The room selection step page element
 *
 * @example
 * ```tsx
 * // In router configuration
 * <Route path="/share/:shareId/room" element={<RoomSelectionStepPage />} />
 * ```
 */
export const RoomSelectionStepPage = memo(function RoomSelectionStepPage(): ReactElement {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { shareId } = useParams<RoomSelectionStepParams>();

  // ============================================================================
  // State
  // ============================================================================

  const [trip, setTrip] = useState<Trip | undefined>(undefined);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignments, setAssignments] = useState<RoomAssignment[]>([]);
  /** Guests of the trip, needed only to resolve each assignment's headcount. */
  const [persons, setPersons] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  /** True when data fetching failed for a reason other than trip not existing (recoverable). */
  const [loadError, setLoadError] = useState(false);

  /** The personId of the guest retrieved from localStorage */
  const [guestPersonId, setGuestPersonId] = useState<PersonId | undefined>();
  /**
   * The tripId from the stored identity, kept as a ref so the load effect
   * can cross-check it without re-running when it changes.
   */
  const storedTripIdRef = useRef<string | undefined>(undefined);

  /** Which room the guest has successfully claimed */
  const [claimedRoomId, setClaimedRoomId] = useState<RoomId | undefined>();

  /** Which room is currently being claimed (per-room loading state) */
  const [isClaimingRoomId, setIsClaimingRoomId] = useState<RoomId | undefined>();

  /** Inline claim error message */
  const [claimError, setClaimError] = useState<string | undefined>();

  // ============================================================================
  // Refs for Async Operation Safety
  // ============================================================================

  /**
   * Tracks whether the component is still mounted.
   * Used to prevent state updates after unmount.
   */
  const isMountedRef = useRef(true);

  /**
   * Prevents double-submission of the claim action.
   */
  const isSubmittingRef = useRef(false);

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
   * Guard: read guest identity from localStorage on mount.
   * If missing or malformed, redirect to the identity step.
   */
  useEffect(() => {
    if (!shareId) return;

    const stored = localStorage.getItem(getGuestIdentityStorageKey(shareId));
    if (!stored) {
      navigate(`/share/${shareId}/identity`, { replace: true });
      return;
    }
    try {
      const identity = JSON.parse(stored) as { personId: string; tripId: string };
      // Trim and validate — whitespace-only strings are treated as missing (R15)
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

  /**
   * Load trip, rooms and assignments when shareId changes.
   * Uses cancelled flag pattern to prevent stale updates.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadData(): Promise<void> {
      if (!shareId) {
        if (!cancelled && isMountedRef.current) {
          setNotFound(true);
          setIsLoading(false);
        }
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

        // R5: cross-validate stored identity tripId against the loaded trip.
        // A stale identity from a different trip must not be used here.
        if (storedTripIdRef.current !== undefined && storedTripIdRef.current !== tripData.id) {
          // Clear the stale identity and send the user back to identify themselves
          try { localStorage.removeItem(getGuestIdentityStorageKey(shareId)); } catch { /* non-fatal */ }
          navigate(`/share/${shareId}/identity`, { replace: true });
          return;
        }

        let roomsData: Room[];
        let assignmentsData: RoomAssignment[];
        let personsData: Person[];
        try {
          [roomsData, assignmentsData, personsData] = await Promise.all([
            getRoomsByTripId(tripData.id as TripId),
            getAssignmentsByTripId(tripData.id as TripId),
            getPersonsByTripId(tripData.id as TripId),
          ]);
        } catch (fetchError) {
          console.error('Failed to load rooms or assignments:', fetchError);
          if (!cancelled && isMountedRef.current) setLoadError(true);
          return;
        }
        if (cancelled || !isMountedRef.current) return;

        setTrip(tripData);
        setRooms(roomsData);
        setAssignments(assignmentsData);
        setPersons(personsData);
      } catch (error) {
        console.error('Failed to load room selection data:', error);
        if (!cancelled && isMountedRef.current) setNotFound(true);
      } finally {
        if (!cancelled && isMountedRef.current) setIsLoading(false);
      }
    }

    void loadData();
    return () => { cancelled = true; };
  }, [shareId, navigate]);

  // ============================================================================
  // Derived Values
  // ============================================================================

  /**
   * Peak occupancy per room, over the trip's nights.
   *
   * The same shared helper the organiser's room cards and occupancy timeline
   * use. This page used to count assignment *rows* with no date window at all,
   * so a couple assigned for two nights of a ten-night trip read as "1 of 2
   * spots taken" here and "2 of 2" on the organiser's card.
   */
  const peakOccupancyByRoom = useMemo(() => {
    if (!trip) {
      return new Map<RoomId, number>();
    }
    const headcountOf = createHeadcountResolver(persons);
    return calculatePeakOccupancyByRoom(
      assignments,
      trip.startDate,
      trip.endDate,
      headcountOf,
    );
  }, [assignments, persons, trip]);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Attempts to claim the given room for the guest.
   * Checks for assignment conflicts before creating the assignment.
   */
  const handleClaimRoom = useCallback(async (room: Room): Promise<void> => {
    if (isSubmittingRef.current || !trip) return;
    if (!guestPersonId) {
      // Identity missing mid-session (localStorage cleared or guard effect not yet run).
      // Navigate back to the identity step so the user can re-identify.
      if (shareId) navigate(`/share/${shareId}/identity`, { replace: true });
      return;
    }
    isSubmittingRef.current = true;
    setIsClaimingRoomId(room.id);
    setClaimError(undefined);

    try {
      // Check for conflicts first (AC-5)
      const hasConflict = await checkAssignmentConflict(
        trip.id,
        guestPersonId,
        trip.startDate,
        trip.endDate,
      );
      if (!isMountedRef.current) return;

      if (hasConflict) {
        setClaimError(t('sharing.roomConflict', "You're already assigned to a room for these dates"));
        return;
      }

      // Create assignment with trip full date range (AC-4)
      const newAssignment = await createAssignment(trip.id, {
        roomId: room.id,
        personId: guestPersonId,
        startDate: trip.startDate,   // already ISODateString — do not re-wrap
        endDate: trip.endDate,       // already ISODateString — do not re-wrap
      });
      if (!isMountedRef.current) return;

      // Update local state to reflect new occupancy
      setAssignments((prev) => [...prev, newAssignment]);
      setClaimedRoomId(room.id);
    } catch (error) {
      console.error('Failed to claim room:', error);
      if (isMountedRef.current) {
        setClaimError(t('sharing.roomClaimError', 'Failed to claim room. Please try again.'));
      }
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) setIsClaimingRoomId(undefined);
    }
  }, [trip, guestPersonId, shareId, navigate, t]);

  /**
   * Navigates to the transport step (for both "Next" and "Skip for now").
   */
  const handleNavigateToTransport = useCallback((): void => {
    if (!shareId) return;
    navigate(`/share/${shareId}/transport`);
  }, [shareId, navigate]);

  // ============================================================================
  // Render
  // ============================================================================

  // Loading state
  if (isLoading) {
    return <LoadingState variant="fullPage" />;
  }

  // Not found / error state — friendly message
  // Recoverable data-fetch error (trip found, but rooms/assignments failed to load)
  if (loadError) {
    return (
      <div className={cn('flex min-h-svh items-center justify-center p-4', onboardingSurface)}>
        <Card className="w-full max-w-md border-warning-border text-center shadow-lg">
          <CardHeader className="pb-2 pt-8">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-warning/20 text-3xl">
              ⚠️
            </div>
            <CardTitle className="text-xl text-warning-on-surface">
              {t('sharing.roomLoadError', 'Could not load rooms')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-8">
            <p className="text-sm text-muted-foreground">
              {t('sharing.roomLoadErrorDescription', 'Something went wrong loading the room list. Please go back and try again.')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Trip not found / link invalid
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

  const isEmpty = rooms.length === 0;

  return (
    <div className={cn('flex min-h-svh items-center justify-center p-4', onboardingSurface)}>
      <Card className="w-full max-w-md border-warning-border shadow-lg">
        <CardHeader className="pb-4 pt-8 text-center">
          {/* Warm room icon */}
          <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-warning/20">
            <BedDouble className="size-10 text-warning-on-surface" aria-hidden="true" />
          </div>

          <CardTitle className="text-2xl font-bold text-warning-on-surface">
            {t('sharing.roomTitle', 'Pick your room')}
          </CardTitle>

          <p className="mt-1 text-sm text-muted-foreground">
            {t('sharing.roomSubtitle', 'Choose a room for your stay')}
          </p>
        </CardHeader>

        <CardContent className="space-y-4 pb-8">
          {/* Inline claim error message */}
          {claimError !== undefined && (
            <p role="alert" className={cn('rounded-xl p-3 text-sm', statusVariants({ tone: 'danger' }))}>
              {claimError}
            </p>
          )}

          {/* Empty rooms state */}
          {isEmpty ? (
            <div className={cn('rounded-xl p-6 text-center', statusVariants({ tone: 'warning' }))}>
              <p className="text-sm font-medium text-warning-on-surface">
                {t('sharing.roomEmpty', 'No rooms available')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  'sharing.roomEmptyDescription',
                  "The organizer hasn't added any rooms yet. Check back later!",
                )}
              </p>
            </div>
          ) : (
            /* Room card list */
            <div className="space-y-3">
              {rooms.map((room) => {
                const occupancy = summarizeRoomOccupancy(
                  room.capacity,
                  peakOccupancyByRoom.get(room.id) ?? 0,
                );
                const occupied = occupancy.peakOccupancy;
                const full = occupancy.isFull;
                const isClaimed = claimedRoomId === room.id;
                const isClaiming = isClaimingRoomId === room.id;
                const occupancyPct = room.capacity > 0
                  ? Math.min(100, Math.round((occupied / room.capacity) * 100))
                  : 0;

                return (
                  <div
                    key={room.id}
                    className={cn(
                      isClaimed
                        ? statusVariants({ tone: 'success', emphasis: 'surface' })
                        : full
                          ? 'border-border bg-muted opacity-60'
                          : 'border-warning-border bg-card',
                      'rounded-xl border-2 p-4 transition-colors',
                    )}
                  >
                    {/* Room header */}
                    <div className="mb-3 flex items-center gap-3">
                      <BedDouble
                        className={cn(
                          'size-5 flex-shrink-0',
                          isClaimed
                            ? 'text-success-on-surface'
                            : full
                              ? 'text-muted-foreground'
                              : 'text-warning-on-surface',
                        )}
                        aria-hidden="true"
                      />
                      <span
                        className={cn(
                          'flex-1 font-medium',
                          isClaimed
                            ? 'text-success-on-surface'
                            : full
                              ? 'text-muted-foreground'
                              : 'text-foreground',
                        )}
                      >
                        {room.name}
                      </span>
                      {/* Full badge */}
                      {full && !isClaimed && (
                        <span
                          className={cn(
                            'rounded px-2 py-1 text-sm',
                            statusVariants({ tone: 'neutral', emphasis: 'outline' }),
                          )}
                        >
                          {t('sharing.roomFull', 'Full')}
                        </span>
                      )}
                    </div>

                    {/* Capacity indicator */}
                    <div className="mb-3 space-y-1">
                      <p
                        className={cn(
                          'text-sm',
                          isClaimed ? 'text-success-on-surface' : 'text-muted-foreground',
                        )}
                      >
                        {t('sharing.roomSpotsTaken', '{{occupied}} of {{capacity}} spots taken', {
                          occupied,
                          capacity: room.capacity,
                        })}
                      </p>
                      {/* Visual progress bar */}
                      <div
                        className="h-1 w-full overflow-hidden rounded-full bg-border"
                        role="progressbar"
                        aria-valuenow={occupancyPct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={t('sharing.roomSpotsTaken', '{{occupied}} of {{capacity}} spots taken', {
                          occupied,
                          capacity: room.capacity,
                        })}
                      >
                        <div
                          className={cn(
                            'h-1 rounded-full transition-all',
                            isClaimed ? 'bg-success' : full ? 'bg-muted-foreground' : 'bg-warning',
                          )}
                          style={{ width: `${occupancyPct}%` }}
                        />
                      </div>
                    </div>

                    {/* Action button */}
                    {isClaimed ? (
                      <div
                        className={cn(
                          'flex items-center gap-2 font-medium',
                          statusVariants({ tone: 'success', emphasis: 'text' }),
                        )}
                      >
                        <Check size={16} aria-hidden="true" />
                        <span>{t('sharing.roomClaimed', 'Claimed ✓')}</span>
                      </div>
                    ) : full ? null : (
                      <Button
                        type="button"
                        onClick={() => { void handleClaimRoom(room); }}
                        disabled={isClaiming || claimedRoomId !== undefined}
                        aria-label={t('sharing.roomClaimNamed', 'Claim {{name}}', { name: room.name })}
                        className={cn('h-11 min-h-[44px] w-full disabled:opacity-40', statusVariants({ tone: 'warning', emphasis: 'solid' }))}
                      >
                        {isClaiming
                          ? t('common.loading', 'Loading...')
                          : t('sharing.roomClaim', 'Claim this room')}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* "Next" button — only enabled after claiming (AC-4) */}
          <Button
            type="button"
            onClick={handleNavigateToTransport}
            disabled={claimedRoomId === undefined}
            className={cn('h-12 w-full text-base font-semibold disabled:opacity-40', statusVariants({ tone: 'warning', emphasis: 'solid' }))}
          >
            {t('sharing.roomNext', 'Next')}
          </Button>

          {/* "Skip for now" — always visible secondary action (AC-6).
               Disabled while a claim is in flight to prevent mid-write navigation. */}
          <Button
            type="button"
            variant="ghost"
            onClick={handleNavigateToTransport}
            disabled={isClaimingRoomId !== undefined}
            className="h-11 w-full text-warning-on-surface hover:bg-warning-surface hover:text-warning-on-surface dark:hover:bg-warning-surface dark:hover:text-warning-on-surface"
          >
            {t('sharing.roomSkip', 'Skip for now')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
});

export default RoomSelectionStepPage;
