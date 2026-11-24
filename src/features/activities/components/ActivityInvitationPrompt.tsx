/**
 * @fileoverview "You're invited" when the trip opens.
 *
 * A guest invited to an activity is asked about it the next time this device
 * opens the trip, whoever's device sent it: the invitation travels in the
 * shared document. One invitation at a time, the earliest activity first.
 *
 * - "Join" joins, which settles the invitation (`setActivityParticipation`).
 * - "Not this time" declines for everybody to see.
 * - Closing the dialog only puts it away until the trip is opened again.
 *
 * Mounted in the trip layout, so it is there on every page of the trip.
 *
 * @module features/activities/components/ActivityInvitationPrompt
 */

import { type ReactElement, memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { useActivityInvitations } from '@/features/activities/hooks/useActivityInvitations';
import { useActivityParticipation } from '@/features/activities/hooks/useActivityParticipation';
import { formatActivityDayRange } from '@/features/activities/utils/activity-utils';

import { useActivityContext } from '@/contexts/ActivityContext';
import { usePersonContext } from '@/contexts/PersonContext';

import { getDateLocale } from '@/lib/i18n/date-locale';
import type { ActivityId } from '@/types';

/**
 * Asks this device's guest about their pending invitations, one at a time.
 *
 * @returns The dialog, or nothing when there is nothing to ask
 */
export const ActivityInvitationPrompt = memo(function ActivityInvitationPrompt(): ReactElement | null {
  const { t, i18n } = useTranslation();
  const { activities } = useActivityContext();
  const { getPersonById } = usePersonContext();
  const { myPersonId, canToggle, toggleParticipation } = useActivityParticipation();
  const { decline } = useActivityInvitations();
  // Put away for this visit: asked again the next time the trip opens.
  const [setAside, setSetAside] = useState<ReadonlySet<ActivityId>>(new Set());
  const [isAnswering, setIsAnswering] = useState(false);

  const pending = useMemo(() => {
    if (!myPersonId) {
      return undefined;
    }
    return [...activities]
      .filter(
        (activity) =>
          activity.invitedIds?.includes(myPersonId) &&
          !activity.participantIds?.includes(myPersonId) &&
          !setAside.has(activity.id),
      )
      .sort((a, b) => a.startDatetime.localeCompare(b.startDatetime))[0];
  }, [activities, myPersonId, setAside]);

  const putAway = useCallback((activityId: ActivityId) => {
    setSetAside((previous) => new Set(previous).add(activityId));
  }, []);

  const answer = useCallback(
    async (joining: boolean) => {
      if (!pending) {
        return;
      }
      setIsAnswering(true);
      const done = joining
        ? await toggleParticipation(pending.id, true)
        : await decline(pending.id);
      setIsAnswering(false);
      if (!done) {
        // A full activity, or a failed save: the error was said, and the
        // dialog steps aside rather than asking the same thing again at once.
        putAway(pending.id);
      }
    },
    [decline, pending, putAway, toggleParticipation],
  );

  if (!pending || !canToggle) {
    return null;
  }

  const inviter = pending.invitedBy ? getPersonById(pending.invitedBy) : undefined;
  const day = formatActivityDayRange(pending, getDateLocale(i18n.language));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          putAway(pending.id);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="size-5 shrink-0 text-primary" aria-hidden="true" />
            {t('activities.invitationPrompt.title', "You're invited")}
          </DialogTitle>
          <DialogDescription>
            {inviter
              ? t('activities.invitationPrompt.fromSomeone', {
                  name: inviter.name,
                  title: pending.title,
                  defaultValue: '{{name}} invites you to {{title}}.',
                })
              : t('activities.invitationPrompt.description', {
                  title: pending.title,
                  defaultValue: "You're invited to {{title}}.",
                })}
          </DialogDescription>
        </DialogHeader>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
          {day}
        </p>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void answer(false)}
            disabled={isAnswering}
          >
            {t('activities.invitationPrompt.decline', 'Not this time')}
          </Button>
          <Button type="button" onClick={() => void answer(true)} disabled={isAnswering}>
            {t('activities.invitationPrompt.join', 'Join')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
