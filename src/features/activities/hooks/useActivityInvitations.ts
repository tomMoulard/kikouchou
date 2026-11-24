/**
 * @fileoverview Inviting guests to an activity, and answering an invitation,
 * as the guest holding this device.
 *
 * The invitation is written to the activity (`inviteToActivity`), which the
 * shared document carries to every device of the trip. The invited guest is
 * asked when they next open the trip (`ActivityInvitationPrompt`), and their
 * devices are notified at once (`requestTripNotification`). Saying no is
 * recorded for everybody (`declineActivityInvitation`); saying yes is joining,
 * which `useActivityParticipation` already does and which settles the
 * invitation.
 *
 * @module features/activities/hooks/useActivityInvitations
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useOfflineAwareNotify, useTripIdentity } from '@/hooks';
import { useTripAccess } from '@/hooks/useTripAccess';

import { useTripContext } from '@/contexts/TripContext';

import { declineActivityInvitation, inviteToActivity } from '@/lib/db';
import { reportFailure } from '@/lib/errors/report-failure';
import { requestTripNotification } from '@/lib/notifications/trip-notify';
import type { ActivityId, PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** What a view gets back to invite guests and answer an invitation. */
export interface UseActivityInvitationsResult {
  /** The guest this device is, or undefined when nobody has said. */
  readonly myPersonId: PersonId | undefined;
  /** Whether this device may write to the trip at all: never on a viewer trip. */
  readonly canInvite: boolean;
  /**
   * Invites guests. Resolves to how many were newly invited; a failure is
   * reported to the user here and resolves to 0.
   */
  invite: (activityId: ActivityId, personIds: readonly PersonId[]) => Promise<number>;
  /** Declines, for everybody, an invitation to this device's guest. */
  decline: (activityId: ActivityId) => Promise<boolean>;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Invites and declines as the guest holding this device.
 *
 * Must be used within `TripProvider` and `AuthProvider`.
 *
 * @returns The current guest, whether inviting applies, and the two actions
 */
export function useActivityInvitations(): UseActivityInvitationsResult {
  const { t } = useTranslation();
  const { notifySuccess } = useOfflineAwareNotify();
  const { currentTrip } = useTripContext();
  const { myPersonId } = useTripIdentity();
  const { canEdit } = useTripAccess();

  const invite = useCallback(
    async (activityId: ActivityId, personIds: readonly PersonId[]): Promise<number> => {
      if (!currentTrip || personIds.length === 0) {
        return 0;
      }
      try {
        const added = await inviteToActivity(activityId, currentTrip.id, personIds, myPersonId);
        if (added.length > 0) {
          requestTripNotification(currentTrip, { kind: 'activity_invite', subjectId: activityId });
          notifySuccess(t('activities.invite.sent', { count: added.length }));
        }
        return added.length;
      } catch (error) {
        reportFailure('useActivityInvitations.invite', error, t('activities.invite.failed'));
        return 0;
      }
    },
    [currentTrip, myPersonId, notifySuccess, t],
  );

  const decline = useCallback(
    async (activityId: ActivityId): Promise<boolean> => {
      if (!currentTrip || !myPersonId) {
        return false;
      }
      try {
        await declineActivityInvitation(activityId, currentTrip.id, myPersonId);
        notifySuccess(t('activities.invite.declined'));
        return true;
      } catch (error) {
        reportFailure('useActivityInvitations.decline', error, t('activities.invite.failed'));
        return false;
      }
    },
    [currentTrip, myPersonId, notifySuccess, t],
  );

  return { myPersonId, canInvite: canEdit, invite, decline };
}
