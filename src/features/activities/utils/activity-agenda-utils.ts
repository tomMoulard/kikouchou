/**
 * @fileoverview Model builder for the day-by-day activity planning.
 *
 * The planning reads like a paper itinerary: one section per day, and in each
 * day the activities in the order they happen. A multi-day activity is listed
 * on every day it covers, so a two-day boat trip does not leave its second day
 * looking free.
 *
 * @module features/activities/utils/activity-agenda-utils
 */

import { addDays, parseISO } from 'date-fns';
import type { Locale } from 'date-fns/locale';

import { toLocalISODateString } from '@/lib/db/utils';
import { formatFullDate } from '@/lib/utils/date-format';
import { parseLocalDayKey } from '@/lib/utils/trip-days';
import type { Activity, ISODateString } from '@/types';

import { getActivityEndDayKey, getActivityStartDayKey } from './activity-utils';

// ============================================================================
// Constants
// ============================================================================

/**
 * Most days one activity is listed on.
 *
 * An activity comes from sync as well as from the form, and an end date years
 * after its start would otherwise list it on every one of those days.
 */
export const MAX_AGENDA_SPAN_DAYS = 31;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * One activity, on one day of the planning.
 */
export interface ActivityAgendaEntry {
  /** Stable key for React lists: the activity id and the day */
  readonly id: string;
  /** The underlying activity */
  readonly activity: Activity;
  /** Which day of the activity this is, from 1 */
  readonly dayNumber: number;
  /** How many days the activity covers in the planning (at least 1) */
  readonly dayCount: number;
}

/**
 * One day of the planning.
 */
export interface ActivityAgendaDay {
  /** Local date key (YYYY-MM-DD) */
  readonly dateKey: ISODateString;
  /** Formatted date for the day header */
  readonly displayDate: string;
  /** What happens that day, in the order it happens */
  readonly entries: readonly ActivityAgendaEntry[];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Sort rank inside a day: an activity carried over from the day before comes
 * first, then whole-day plans, then timed ones by their start.
 */
function compareEntries(a: ActivityAgendaEntry, b: ActivityAgendaEntry): number {
  const rank = (entry: ActivityAgendaEntry): number =>
    entry.dayNumber > 1 ? 0 : entry.activity.allDay ? 1 : 2;

  const byRank = rank(a) - rank(b);
  if (byRank !== 0) {
    return byRank;
  }

  // Instants, not strings: two offsets can sort the wrong way as text.
  const byStart =
    parseISO(a.activity.startDatetime).getTime() - parseISO(b.activity.startDatetime).getTime();
  if (byStart !== 0 && !Number.isNaN(byStart)) {
    return byStart;
  }

  return a.activity.title.localeCompare(b.activity.title);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Builds the day-by-day planning for a set of activities.
 *
 * Days come from the viewer's own clock, like the list view and the calendar.
 * Only days with something on them are returned. An activity whose start does
 * not parse is left out.
 *
 * @param activities - Activities, in any order
 * @param locale - date-fns locale used for the day headers
 * @returns Days sorted ascending, each with its entries in order
 *
 * @example
 * ```typescript
 * const days = buildActivityAgenda(activities, fr);
 * days.forEach((day) => console.log(day.displayDate, day.entries.length));
 * ```
 */
export function buildActivityAgenda(
  activities: readonly Activity[],
  locale: Locale,
): ActivityAgendaDay[] {
  const entriesByDay = new Map<ISODateString, ActivityAgendaEntry[]>();

  for (const activity of activities) {
    const startKey = getActivityStartDayKey(activity);
    const start = startKey ? parseLocalDayKey(startKey) : null;
    if (!start) {
      continue;
    }

    const endKey = getActivityEndDayKey(activity) ?? startKey;
    const end = endKey ? parseLocalDayKey(endKey) : null;

    // Local midnights, so a difference in days is a whole number except across
    // a DST change, which `Math.round` absorbs.
    const span =
      end && end.getTime() > start.getTime()
        ? Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
        : 1;
    const dayCount = Math.min(span, MAX_AGENDA_SPAN_DAYS);

    for (let index = 0; index < dayCount; index += 1) {
      const dateKey = toLocalISODateString(addDays(start, index));
      const entry: ActivityAgendaEntry = {
        id: `${activity.id}-${dateKey}`,
        activity,
        dayNumber: index + 1,
        dayCount,
      };
      const existing = entriesByDay.get(dateKey);
      if (existing) {
        existing.push(entry);
      } else {
        entriesByDay.set(dateKey, [entry]);
      }
    }
  }

  return Array.from(entriesByDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, entries]) => ({
      dateKey,
      displayDate: formatFullDate(dateKey, locale),
      entries: entries.sort(compareEntries),
    }));
}
