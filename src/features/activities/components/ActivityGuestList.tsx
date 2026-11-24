/**
 * @fileoverview Who is asked to an activity, and what each answered.
 *
 * Like a calendar event's guest list: every guest the activity concerns, one
 * per line, with their answer beside their name.
 *
 * - Going: in `participantIds`.
 * - Invited: in `invitedIds`, no answer yet.
 * - Can't come: in `declinedIds`.
 *
 * A guest is in one list only (`setActivityParticipation` clears the
 * invitation on join, `declineActivityInvitation` moves it to declined), but a
 * document merged from two offline devices can disagree, so the strongest
 * answer wins: going, then can't come, then invited. The organizer is marked.
 *
 * @module features/activities/components/ActivityGuestList
 */

import { type ReactElement, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheck, CircleHelp, CircleX } from 'lucide-react';

import { PersonBadge } from '@/components/shared/PersonBadge';
import { cn } from '@/lib/utils';

import {
  type ActivityAnswer,
  activityGuestLines,
} from '@/features/activities/utils/activity-guest-lines';

import type { Activity, Person } from '@/types';

// ============================================================================
// Types
// ============================================================================

/** Props for {@link ActivityGuestList}. */
export interface ActivityGuestListProps {
  /** The activity. */
  readonly activity: Activity;
  /** Every guest of the trip. */
  readonly guests: readonly Person[];
}

// ============================================================================
// Component
// ============================================================================

const ANSWER_ICON = {
  going: CircleCheck,
  invited: CircleHelp,
  declined: CircleX,
} as const;

const ANSWER_TONE: Record<ActivityAnswer, string> = {
  going: 'text-success-on-surface',
  invited: 'text-muted-foreground',
  declined: 'text-destructive',
};

/**
 * The guest list, or nothing when nobody is in, asked or declined.
 *
 * @param props - See {@link ActivityGuestListProps}
 * @returns The list
 */
export const ActivityGuestList = memo(function ActivityGuestList({
  activity,
  guests,
}: ActivityGuestListProps): ReactElement | null {
  const { t } = useTranslation();
  const lines = useMemo(() => activityGuestLines(activity, guests), [activity, guests]);

  if (lines.length === 0) {
    return null;
  }

  const counts = { going: 0, invited: 0, declined: 0 };
  for (const line of lines) {
    counts[line.answer] += 1;
  }
  const label = (answer: ActivityAnswer): string =>
    answer === 'going'
      ? t('activities.rsvp.going', 'Going')
      : answer === 'invited'
        ? t('activities.rsvp.invited', 'Invited, no answer yet')
        : t('activities.rsvp.declined', "Can't come");

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {t('activities.rsvp.summary', {
          going: counts.going,
          invited: counts.invited,
          declined: counts.declined,
          defaultValue: '{{going}} going, {{invited}} waiting, {{declined}} can\'t come',
        })}
      </p>
      <ul className="space-y-1" aria-label={t('activities.rsvp.listLabel', 'Guests and their answers')}>
        {lines.map(({ person, answer, isOrganizer }) => {
          const Icon = ANSWER_ICON[answer];
          return (
            <li
              key={person.id}
              className="flex min-w-0 items-center justify-between gap-2"
              data-answer={answer}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <PersonBadge person={person} size="sm" />
                {isOrganizer && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('activities.rsvp.organizer', 'Organizer')}
                  </span>
                )}
              </span>
              <span className={cn('flex shrink-0 items-center gap-1 text-xs', ANSWER_TONE[answer])}>
                <Icon className="size-4" aria-hidden="true" />
                {label(answer)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
});
