/**
 * @fileoverview The notice a ride card shows when one passenger's own leg has
 * drifted away from the car the rest of them are still expecting.
 *
 * Alice was sharing Guillaume's car with Tom and Aurélia at 17:00 and moved her
 * train to 19:00. Three things could happen and only one of them is honest:
 *
 * 1. The car silently follows Alice. Tom and Aurélia turn up at 17:00 to an
 *    empty kerb, and nobody told them.
 * 2. Alice's leg silently falls out of the car. She finds out at 19:00, when
 *    there is nothing to be done about it.
 * 3. The ride keeps its time, the drift is *said out loud*, and the driver
 *    picks. That is this component.
 *
 * So nothing here is automatic. `resolveRides` flags the leg — see
 * `ride-model` — and the driver is offered exactly two moves: take the car to
 * Alice's new time, or take Alice out of the car. Both are spelled out before
 * they are taken, including what moving the car costs the people already in it:
 * `previewRideMove` (see `ride-move`) runs on render, so pushing Tom and
 * Aurélia out to fix Alice is named on the button rather than arriving as a
 * fresh warning once the change is already made.
 *
 * Dropping a passenger is not a cancellation. Their leg goes back to needing a
 * lift, which is a state the pickup panel already renders and somebody else can
 * still answer — the confirmation says so, because "drop" reads like "cancel"
 * and it is not.
 *
 * A legacy `driverId`-only journey can never appear here. Its single leg *is*
 * the journey's time, so it cannot disagree with it, and there is no `Ride` row
 * to move even if it could.
 *
 * @module features/transports/components/RideMismatchNotice
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
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, CalendarClock, UserMinus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { statusVariants } from '@/components/ui/status.variants';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { previewRideMove } from '@/features/transports/utils/ride-move';
import type {
  ResolvedLeg,
  ResolvedRide,
} from '@/features/transports/utils/ride-model';
import { useOfflineAwareToast } from '@/hooks';
import { useRideContext } from '@/contexts/RideContext';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { formatTransportDatetime } from '@/lib/utils/datetime-format';
import type { TransportId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** Props for the {@link RideMismatchNotice} component. */
export interface RideMismatchNoticeProps {
  /** The resolved journey whose legs may have drifted. */
  readonly journey: ResolvedRide;
  /** Optional className for additional styling. */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Announces the legs that no longer fit this ride, and offers the two ways out.
 *
 * Renders nothing for a journey with no drifted leg, and nothing for a legacy
 * `driverId`-only journey — that one has no ride row to move and cannot
 * disagree with itself about the time.
 *
 * @param props - Component props
 * @returns The notice, or `null` when there is nothing to say
 *
 * @example
 * ```tsx
 * <RideMismatchNotice journey={journey} className="mt-3" />
 * ```
 */
const RideMismatchNotice = memo(function RideMismatchNotice({
  journey,
  className,
}: RideMismatchNoticeProps): ReactElement | null {
  const { t, i18n } = useTranslation();
  const { updateRide, setTransportRide } = useRideContext();
  const { successToast } = useOfflineAwareToast();

  // Set on setup, not only in cleanup: StrictMode's mount → cleanup → mount
  // would otherwise latch this false forever and leave the buttons disabled.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [pendingLegId, setPendingLegId] = useState<TransportId | null>(null);
  const [legPendingDrop, setLegPendingDrop] = useState<ResolvedLeg | null>(null);

  const dateLocale = useMemo(() => getDateLocale(i18n.language), [i18n.language]);

  const rideId = journey.ride?.id;

  const mismatchedLegs = useMemo(
    () =>
      journey.isLegacy
        ? []
        : journey.legs.filter((leg) => leg.mismatch !== undefined),
    [journey.isLegacy, journey.legs],
  );

  const handleMove = useCallback(
    async (leg: ResolvedLeg): Promise<void> => {
      if (rideId === undefined) {
        return;
      }

      setPendingLegId(leg.transport.id);
      try {
        await updateRide(rideId, { meetDatetime: leg.transport.datetime });
        successToast(
          t('rides.mismatch.moveSuccess', {
            time: formatTransportDatetime(
              leg.transport.datetime,
              dateLocale,
              'dayAndTime',
            ),
          }),
        );
      } catch (error) {
        console.error('Failed to move ride to a passenger time:', error);
        toast.error(t('errors.saveFailed'));
      } finally {
        if (isMountedRef.current) {
          setPendingLegId(null);
        }
      }
    },
    [rideId, updateRide, successToast, t, dateLocale],
  );

  const handleDropConfirm = useCallback(async (): Promise<void> => {
    const leg = legPendingDrop;
    if (leg === null) {
      return;
    }

    setPendingLegId(leg.transport.id);
    try {
      await setTransportRide(leg.transport.id, undefined);
      successToast(
        t('rides.mismatch.dropSuccess', {
          name: leg.person?.name ?? t('common.unknown'),
        }),
      );
      // Nothing closes the dialog here: `ConfirmDialog` does it on a resolved
      // confirm, and that lands back through `handleDropDialogChange`.
    } catch (error) {
      console.error('Failed to drop a passenger from a ride:', error);
      toast.error(t('errors.saveFailed'));
      // Rethrown on purpose. `ConfirmDialog` closes on a resolved confirm and
      // stays open on a rejected one, so swallowing this would dismiss the
      // question over a write that never happened — leaving the driver certain
      // they had dropped a passenger who is still in the car.
      throw error;
    } finally {
      if (isMountedRef.current) {
        setPendingLegId(null);
      }
    }
  }, [legPendingDrop, setTransportRide, successToast, t]);

  const handleDropDialogChange = useCallback((open: boolean): void => {
    if (!open) {
      setLegPendingDrop(null);
    }
  }, []);

  if (mismatchedLegs.length === 0) {
    return null;
  }

  const dropName = legPendingDrop?.person?.name ?? t('common.unknown');

  return (
    <div
      role="alert"
      className={cn(
        statusVariants({ tone: 'warning', emphasis: 'soft' }),
        'rounded-lg p-3 text-sm',
        className,
      )}
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        {t('rides.mismatch.title')}
      </p>

      {/* Colour says "warning" to some readers and to no others, so the notice
          also says out loud that the ride has not moved by itself. */}
      <p className="mt-1 text-xs">{t('rides.mismatch.explanation')}</p>

      <ul className="mt-3 space-y-3">
        {mismatchedLegs.map((leg) => {
          const name = leg.person?.name ?? t('common.unknown'),
            // Already whole minutes: `minutesBetween` rounds, so nothing here
            // has to, and rounding twice would only invite the two to disagree.
            minutes = leg.mismatchMinutes,
            preview = previewRideMove(journey, leg.transport.datetime),
            targetTime = formatTransportDatetime(
              leg.transport.datetime,
              dateLocale,
              'dayAndTime',
            ),
            isPending = pendingLegId === leg.transport.id,
            canMove = rideId !== undefined && preview !== null;

          return (
            <li key={leg.transport.id} className="space-y-1.5">
              <p>
                {leg.mismatch === 'after'
                  ? t('rides.legMismatch.after', { name, minutes })
                  : t('rides.legMismatch.before', { name, minutes })}
              </p>

              {canMove ? (
                <p className="text-xs">
                  {preview.displaced.length === 0
                    ? t('rides.mismatch.moveCostNone')
                    : t('rides.mismatch.moveCost', {
                        count: preview.displaced.length,
                        names: preview.displaced
                          .map(
                            (other) =>
                              other.person?.name ?? t('common.unknown'),
                          )
                          .join(', '),
                      })}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {canMove ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => {
                      void handleMove(leg);
                    }}
                  >
                    <CalendarClock className="size-4" aria-hidden="true" />
                    {t('rides.mismatch.moveAction', { time: targetTime })}
                  </Button>
                ) : null}

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => {
                    setLegPendingDrop(leg);
                  }}
                >
                  <UserMinus className="size-4" aria-hidden="true" />
                  {t('rides.mismatch.dropAction', { name })}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={legPendingDrop !== null}
        onOpenChange={handleDropDialogChange}
        title={t('rides.mismatch.dropTitle', { name: dropName })}
        description={t('rides.mismatch.dropDescription', { name: dropName })}
        confirmLabel={t('rides.mismatch.dropConfirm')}
        onConfirm={handleDropConfirm}
      />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { RideMismatchNotice };
