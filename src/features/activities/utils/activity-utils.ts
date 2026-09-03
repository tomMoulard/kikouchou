/**
 * @fileoverview Shared helpers for the Activities feature.
 * Datetime formatting and date grouping used by the activity list, the
 * activity timeline and the calendar integration.
 *
 * @module features/activities/utils/activity-utils
 */

import { endOfDay, format, isValid, parseISO } from 'date-fns';
import type { Locale } from 'date-fns/locale';

import { toLocalISODateString } from '@/lib/db/utils';
import { formatFullDate } from '@/lib/utils/date-format';
import { localDayKeyOfInstant } from '@/lib/utils/trip-days';
import type { Activity, ISODateString, ISODateTimeString } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/** Matches a bare local calendar day, as produced by a `date` input. */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ============================================================================
// Storage Normalisation
// ============================================================================

/**
 * Normalises any parseable datetime into the single representation activities
 * are stored in: a UTC ISO instant.
 *
 * Every write path must go through this. Activity instants are ordered as
 * plain strings by the `[tripId+startDatetime]` index, so a naive
 * `2026-04-20T09:00:00` stored next to a `…Z` value silently breaks the
 * agenda's ordering.
 *
 * @param value - A datetime string, with or without an offset
 * @returns The UTC ISO instant, or undefined when the value is unparseable
 */
export function toActivityInstant(
  value: string,
): ISODateTimeString | undefined {
  const date = new Date(value);
  return isValid(date) ? (date.toISOString() as ISODateTimeString) : undefined;
}

/**
 * Snaps a value to the start or end of its **local** calendar day.
 *
 * All-day activities are stored as a real instant range so ordering, "is it
 * over?" checks and the timeline all work without a separate date-only path.
 * Accepts both a bare `yyyy-MM-dd` (from the form's `date` input) and a full
 * datetime (which an LLM action may carry), taking the local day of the latter.
 *
 * @param value - A `yyyy-MM-dd` day or a full datetime string
 * @param edge - Which end of the day to snap to
 * @returns The UTC ISO instant, or undefined when the value is unparseable
 */
export function toAllDayActivityInstant(
  value: string,
  edge: 'start' | 'end',
): ISODateTimeString | undefined {
  let dayKey = value;

  if (!DAY_KEY_PATTERN.test(value)) {
    const parsed = new Date(value);
    if (!isValid(parsed)) {
      return undefined;
    }
    dayKey = toLocalISODateString(parsed);
  }

  const [year, month, day] = dayKey.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const date =
    edge === 'start'
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);

  return isValid(date) ? (date.toISOString() as ISODateTimeString) : undefined;
}

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
  return localDayKeyOfInstant(activity.startDatetime) ?? undefined;
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
  return (
    localDayKeyOfInstant(getActivityEndInstant(activity)) ??
    getActivityStartDayKey(activity)
  );
}

/**
 * Whether an activity is already over relative to a reference instant.
 *
 * This is the **single** definition of "past" for activities: `ActivityContext`
 * partitions the agenda with it and every consumer reads that partition rather
 * than recomputing one. The comparison is a real instant comparison — an
 * activity that ended at 09:00 is over at 09:01, not at midnight — so callers
 * must pass a live `Date`, not the start of the day.
 *
 * An activity with **no end time** is open-ended, not instantaneous: the form
 * offers "leave empty for an activity with no set end", so a 19:00 apéro runs
 * until the end of its local day rather than being over at 19:01.
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
  const effectiveEnd = activity.endDatetime ? end : endOfDay(end);
  return effectiveEnd.getTime() < now.getTime();
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
      displayDate: formatFullDate(dateKey, locale),
      activities: groupActivities,
    }));
}
