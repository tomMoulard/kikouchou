/**
 * @fileoverview "Count me in / count me out" for the guest holding this device.
 *
 * Signing yourself up used to mean opening the editor, ticking your own name
 * among everybody else's, and saving the whole activity. The agenda list had a
 * one-tap button; the timeline, the calendar and the editor did not. Every
 * screen that shows an activity now asks the same three questions here: who am
 * I, may I write to this trip, and what happens when I tap.
 *
 * @module features/activities/hooks/useActivityParticipation
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useActivityContext } from '@/contexts/ActivityContext';
import { useOfflineAwareNotify, useTripIdentity } from '@/hooks';
import { useTripAccess } from '@/hooks/useTripAccess';
import { reportFailure } from '@/lib/errors/report-failure';
import type { ActivityId, PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** What a view gets back when it offers the join/leave button. */
export interface UseActivityParticipationResult {
  /** The guest this device is, or undefined when nobody has said. */
  readonly myPersonId: PersonId | undefined;
  /**
   * True when the button may be shown: the device knows who it is and the trip
   * is not a viewer trip, which is read and never written.
   */
  readonly canToggle: boolean;
  /**
   * Adds or removes the current guest. Resolves to `true` once saved; a
   * failure is reported to the user here and resolves to `false`.
   */
  toggleParticipation: (activityId: ActivityId, joining: boolean) => Promise<boolean>;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Joins or leaves an activity as the guest holding this device.
 *
 * Must be used within `TripProvider`, `AuthProvider` and `ActivityProvider`.
 *
 * @returns The current guest, whether the button applies, and the toggle
 *
 * @example
 * ```tsx
 * const { myPersonId, canToggle, toggleParticipation } = useActivityParticipation();
 * {canToggle && myPersonId ? (
 *   <ActivityParticipationButton
 *     activity={activity}
 *     personId={myPersonId}
 *     onToggle={(id, joining) => void toggleParticipation(id, joining)}
 *   />
 * ) : null}
 * ```
 */
export function useActivityParticipation(): UseActivityParticipationResult {
  const { t } = useTranslation();
  const { notifySuccess } = useOfflineAwareNotify();
  const { setParticipation } = useActivityContext();
  const { myPersonId } = useTripIdentity();
  const { canEdit } = useTripAccess();

  const toggleParticipation = useCallback(
    async (activityId: ActivityId, joining: boolean): Promise<boolean> => {
      if (!myPersonId) {
        return false;
      }

      try {
        await setParticipation(activityId, myPersonId, joining);
        notifySuccess(joining ? t('activities.joined') : t('activities.left'));
        return true;
      } catch (error) {
        reportFailure(
          'useActivityParticipation.toggleParticipation',
          error,
          t('activities.errors.participationFailed'),
        );
        return false;
      }
    },
    [myPersonId, setParticipation, notifySuccess, t],
  );

  return {
    myPersonId,
    canToggle: canEdit && myPersonId !== undefined,
    toggleParticipation,
  };
}
