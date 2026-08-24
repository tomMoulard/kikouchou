/**
 * @fileoverview Shared helpers for the Activities feature.
 * Datetime formatting and date grouping used by the activity list, the
 * activity timeline and the calendar integration.
 *
 * @module features/activities/utils/activity-utils
 */

import { format, isValid, parseISO } from 'date-fns';
import type { Locale } from 'date-fns/locale';

import { toLocalISODateString } from '@/lib/db/utils';
import type { Activity, ISODateString } from '@/types';

// ============================================================================
// Date & Time Helpers
// ============================================================================

/**
 * The instant an activity ends — its end when set, its start otherwise.
 *
 * @param activity - The activity
 * @returns An ISO datetime string
 */
export function getActivityEndInstant(activity: Activity): string {
  return activity.endDatetime ?? activity.startDatetime;
}

/**
 * Local calendar day an activity starts on (YYYY-MM-DD).
 *
 * Uses the viewer's timezone so an activity shows on the day they experience it,
 * matching how the calendar grid labels its cells.
 *
 * @param activity - The activity
 * @returns The local start day, or undefined when the datetime is unparseable
 */
export function getActivityStartDayKey(
  activity: Activity,
): ISODateString | undefined {
  const date = parseISO(activity.startDatetime);
  return isValid(date) ? toLocalISODateString(date) : undefined;
}

/**
 * Local calendar day an activity ends on (YYYY-MM-DD).
 * Falls back to the start day for open-ended activities.
 *
 * @param activity - The activity
 * @returns The local end day, or undefined when the datetime is unparseable
 */
export function getActivityEndDayKey(
  activity: Activity,
): ISODateString | undefined {
  const date = parseISO(getActivityEndInstant(activity));
  if (!isValid(date)) {
    return getActivityStartDayKey(activity);
  }
  return toLocalISODateString(date);
}

/**
 * Whether an activity is already over relative to a reference instant.
 *
 * @param activity - The activity
 * @param now - Reference instant (defaults to the current time)
 * @returns True when the activity ended before `now`
 */
export function isActivityPast(activity: Activity, now: Date = new Date()): boolean {
  const end = parseISO(getActivityEndInstant(activity));
  if (!isValid(end)) {
    return false;
  }
  return end.getTime() < now.getTime();
}

/**
 * Formats the time slot of an activity for display.
 *
 * All-day activities return an empty string — callers show the "all day" label
 * instead. Activities that span several days include both dates.
 *
 * @param activity - The activity to format
 * @param locale - date-fns locale used for formatting
 * @returns A human-readable time range, or an empty string for all-day activities
 *
 * @example
 * formatActivityTimeRange(activity, fr) // "09:00 – 12:00"
 */
export function formatActivityTimeRange(
  activity: Activity,
  locale: Locale,
): string {
  if (activity.allDay) {
    return '';
  }

  const start = parseISO(activity.startDatetime);
  if (!isValid(start)) {
    return '';
  }

  const startLabel = format(start, 'HH:mm', { locale });

  if (!activity.endDatetime) {
    return startLabel;
  }

  const end = parseISO(activity.endDatetime);
  if (!isValid(end)) {
    return startLabel;
  }

  const startDayKey = getActivityStartDayKey(activity);
  const endDayKey = getActivityEndDayKey(activity);

  // Multi-day slot: the end time alone would be ambiguous, so include its date.
  if (startDayKey !== endDayKey) {
    return `${startLabel} → ${format(end, 'd MMM HH:mm', { locale })}`;
  }

  return `${startLabel} – ${format(end, 'HH:mm', { locale })}`;
}

/**
 * Formats the day (or day range) an activity covers.
 *
 * @param activity - The activity to format
 * @param locale - date-fns locale used for formatting
 * @returns A human-readable day range
 */
export function formatActivityDayRange(
  activity: Activity,
  locale: Locale,
): string {
  const start = parseISO(activity.startDatetime);
  if (!isValid(start)) {
    return '';
  }

  const startLabel = format(start, 'EEE d MMM', { locale });
  const startDayKey = getActivityStartDayKey(activity);
  const endDayKey = getActivityEndDayKey(activity);

  if (startDayKey === endDayKey) {
    return startLabel;
  }

  const end = parseISO(getActivityEndInstant(activity));
  if (!isValid(end)) {
    return startLabel;
  }

  return `${startLabel} → ${format(end, 'EEE d MMM', { locale })}`;
}

// ============================================================================
// Grouping
// ============================================================================

/**
 * A group of activities starting on the same calendar day.
 */
export interface ActivityDateGroup {
  /** Local date key (YYYY-MM-DD) */
  readonly dateKey: ISODateString;
  /** Formatted date for the group header */
  readonly displayDate: string;
  /** Activities starting that day, sorted by start datetime */
  readonly activities: readonly Activity[];
}

/**
 * Groups activities by their local start day, chronologically.
 *
 * Multi-day activities appear once, under the day they start on — the timeline
 * is where their full span is shown.
 *
 * @param activities - Activities to group
 * @param locale - date-fns locale used for the header labels
 * @returns Date groups sorted by day ascending
 */
export function groupActivitiesByDate(
  activities: readonly Activity[],
  locale: Locale,
): ActivityDateGroup[] {
  const groupsMap = new Map<ISODateString, Activity[]>();

  for (const activity of activities) {
    const dateKey = getActivityStartDayKey(activity);
    if (!dateKey) {
      continue;
    }

    const existing = groupsMap.get(dateKey);
    if (existing) {
      existing.push(activity);
    } else {
      groupsMap.set(dateKey, [activity]);
    }
  }

  for (const group of groupsMap.values()) {
    group.sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));
  }

  return Array.from(groupsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, groupActivities]) => ({
      dateKey,
      displayDate: formatDayHeader(dateKey, locale),
      activities: groupActivities,
    }));
}

/**
 * Formats a local date key as a full date header.
 *
 * @param dateKey - Date key in YYYY-MM-DD format
 * @param locale - date-fns locale
 * @returns Formatted date string, or the raw key when unparseable
 */
export function formatDayHeader(dateKey: string, locale: Locale): string {
  const parsed = parseISO(dateKey);
  if (!isValid(parsed)) {
    return dateKey;
  }
  return format(parsed, 'EEEE, MMMM d, yyyy', { locale });
}
