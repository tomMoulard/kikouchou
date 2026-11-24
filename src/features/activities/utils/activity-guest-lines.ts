/**
 * @fileoverview Who an activity concerns, and what each guest answered.
 *
 * Read by `ActivityGuestList`.
 *
 * @module features/activities/utils/activity-guest-lines
 */

import type { Activity, Person, PersonId } from '@/types';

/** A guest's answer to an activity. */
export type ActivityAnswer = 'going' | 'invited' | 'declined';

/** One line of the list. */
export interface ActivityGuestLine {
  readonly person: Person;
  readonly answer: ActivityAnswer;
  readonly isOrganizer: boolean;
}

// ============================================================================
// Lines
// ============================================================================

const ORDER: Record<ActivityAnswer, number> = { going: 0, invited: 1, declined: 2 };

/**
 * Every guest the activity concerns, with their answer: going first, then
 * waiting, then can't come; within each, the trip's order.
 *
 * @param activity - The activity
 * @param guests - Every guest of the trip
 * @returns The lines, one per guest
 */
export function activityGuestLines(
  activity: Activity,
  guests: readonly Person[],
): ActivityGuestLine[] {
  const going = new Set<PersonId>(activity.participantIds ?? []);
  const declined = new Set<PersonId>(activity.declinedIds ?? []);
  const invited = new Set<PersonId>(activity.invitedIds ?? []);

  const lines: ActivityGuestLine[] = [];
  for (const person of guests) {
    const answer: ActivityAnswer | undefined = going.has(person.id)
      ? 'going'
      : declined.has(person.id)
        ? 'declined'
        : invited.has(person.id)
          ? 'invited'
          : undefined;
    if (answer !== undefined) {
      lines.push({ person, answer, isOrganizer: activity.organizerId === person.id });
    }
  }
  return lines.sort((a, b) => ORDER[a.answer] - ORDER[b.answer]);
}
