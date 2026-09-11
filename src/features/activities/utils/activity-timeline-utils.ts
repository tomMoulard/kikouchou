/**
 * @fileoverview Model builder for the horizontal activity timeline.
 *
 * Activities are laid out on the trip's day axis, grouped into one row per
 * category so the agenda reads as bands (garden outings, meals, hikes…).
 * Overlapping activities within a category are stacked into lanes.
 *
 * @module features/activities/utils/activity-timeline-utils
 */

import { allocateTimelineLanes } from '@/lib/utils/timeline-lanes';
import {
  type TimelineColumn,
  columnsFromDays,
  resolveColumnRange,
} from '@/lib/utils/timeline-scale';
import { buildDayColumnsCovering, parseLocalDayKey, toDayKeys } from '@/lib/utils/trip-days';
import { ACTIVITY_CATEGORIES } from '@/types';
import type { Activity, ActivityCategory, ISODateString, Trip } from '@/types';

import { getActivityEndDayKey, getActivityStartDayKey } from './activity-utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * One activity positioned on the trip day axis.
 */
export interface ActivityTimelineItem {
  /** Stable key for React lists */
  readonly id: string;
  /** The underlying activity */
  readonly activity: Activity;
  /** First trip day column the activity covers (inclusive) */
  readonly startIndex: number;
  /** Last trip day column the activity covers (inclusive) */
  readonly endIndex: number;
}

/**
 * An activity item with its stacking lane resolved.
 */
export type ActivityTimelineItemWithLane = ActivityTimelineItem & {
  readonly laneIndex: number;
};

/**
 * One category band of the activity timeline.
 */
export interface ActivityTimelineRowModel {
  /** The category this row groups */
  readonly category: ActivityCategory;
  /** Activities in this category, with lanes resolved */
  readonly items: readonly ActivityTimelineItemWithLane[];
  /** Number of stacked lanes needed by this row (at least 1) */
  readonly laneCount: number;
}

/**
 * The full activity timeline model.
 */
export interface ActivityTimelineModel {
  /** The axis the bands are laid out on, at whatever scale is being shown */
  readonly columns: readonly TimelineColumn[];
  /** One Date per column of the axis — day midnights on a day-per-column axis */
  readonly tripDays: readonly Date[];
  /** Keys of the columns that are exactly one calendar day, in axis order */
  readonly dayKeys: readonly ISODateString[];
  /** Category rows, in the canonical category order, empty rows omitted */
  readonly rows: readonly ActivityTimelineRowModel[];
  /** Number of activities placed on the timeline */
  readonly visibleCount: number;
  /**
   * Number of activities the axis could not reach and that are therefore not
   * drawn: an unreadable date, or a day so far outside the trip that stretching
   * the axis to it would cost hundreds of columns
   * (`TIMELINE_DAY_AXIS_MAX_EXTENSION_DAYS`). Surfaced so the UI can explain
   * the gap.
   */
  readonly hiddenCount: number;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * The day keys a set of activities needs columns for.
 *
 * Feed these to `buildDayColumnsCovering` so an activity that runs past the
 * trip's own dates still has a column to be drawn in.
 *
 * @param activities - Activities, in any order
 * @returns The first and last day key of each activity whose dates parse
 */
export function collectActivityDayKeys(
  activities: readonly Activity[],
): readonly ISODateString[] {
  const keys: ISODateString[] = [];
  for (const activity of activities) {
    const startKey = getActivityStartDayKey(activity);
    if (!startKey) {
      continue;
    }
    keys.push(startKey, getActivityEndDayKey(activity) ?? startKey);
  }
  return keys;
}

/**
 * Builds the activity timeline model for a trip.
 *
 * The day axis covers the trip and every activity on it, so an outing that
 * starts the day before the trip does gets a column of its own rather than
 * being clamped onto the first trip day. Only an activity the axis cannot
 * reach — an unreadable date, or one too far out to stretch to — is counted in
 * `hiddenCount`.
 *
 * @param args - The trip and its activities
 * @returns A timeline model ready to render
 *
 * @example
 * ```typescript
 * const model = buildActivityTimelineModel({ trip, activities });
 * model.rows.forEach((row) => console.log(row.category, row.items.length));
 * ```
 */
export function buildActivityTimelineModel(args: {
  readonly trip: Trip;
  readonly activities: readonly Activity[];
  /**
   * Extra day keys the axis must cover, on top of this model's own activities.
   *
   * The calendar timeline draws these bands under its guest rows on one shared
   * axis, so it hands this builder the guest half's keys and the guest builder
   * these ones. Both then span the same days and the two halves line up.
   *
   * Ignored when `columns` is given: an axis the caller built is already the
   * shared one.
   */
  readonly extraDayKeys?: readonly ISODateString[];
  /**
   * The axis to lay the bands out on, at whatever scale is being shown.
   *
   * Left out, the builder makes the day-per-column axis it always made: the
   * trip's days, widened to reach every activity on them.
   */
  readonly columns?: readonly TimelineColumn[];
}): ActivityTimelineModel {
  const { trip, activities } = args;

  const columns =
    args.columns ??
    (() => {
      const days = buildDayColumnsCovering({
        startKey: trip.startDate,
        endKey: trip.endDate,
        mustInclude: [...collectActivityDayKeys(activities), ...(args.extraDayKeys ?? [])],
      });
      // Local keys, matching `getActivityStartDayKey` — an activity has to land
      // in the column whose date the guest reads off their own clock.
      return columnsFromDays(days, toDayKeys(days));
    })();

  const tripDays = columns.map((column) => column.start);
  const dayKeys = columns
    .map((column) => column.dayKey)
    .filter((key): key is ISODateString => key !== undefined);

  if (columns.length === 0) {
    return {
      columns,
      tripDays,
      dayKeys,
      rows: [],
      visibleCount: 0,
      hiddenCount: activities.length,
    };
  }

  const itemsByCategory = new Map<ActivityCategory, ActivityTimelineItem[]>();
  let visibleCount = 0;
  let hiddenCount = 0;

  for (const activity of activities) {
    const startKey = getActivityStartDayKey(activity);
    const endKey = getActivityEndDayKey(activity) ?? startKey;

    if (!startKey || !endKey) {
      hiddenCount += 1;
      continue;
    }

    // An activity's last day is inclusive, so the half-open range it covers runs
    // to the start of the day after it.
    const from = parseLocalDayKey(startKey);
    const toInclusive = parseLocalDayKey(endKey);
    if (!from || !toInclusive) {
      hiddenCount += 1;
      continue;
    }

    const to = new Date(toInclusive);
    to.setDate(to.getDate() + 1);

    // Too far out for the axis to reach: nothing to draw.
    const range = resolveColumnRange(columns, from, to);
    if (range === undefined) {
      hiddenCount += 1;
      continue;
    }

    const { startIndex, endIndex } = range;

    const category = activity.category ?? 'other';
    const bucket = itemsByCategory.get(category);
    const item: ActivityTimelineItem = {
      id: activity.id,
      activity,
      startIndex,
      endIndex: Math.max(startIndex, endIndex),
    };

    if (bucket) {
      bucket.push(item);
    } else {
      itemsByCategory.set(category, [item]);
    }

    visibleCount += 1;
  }

  const rows: ActivityTimelineRowModel[] = [];

  for (const category of ACTIVITY_CATEGORIES) {
    const items = itemsByCategory.get(category);
    if (!items || items.length === 0) {
      continue;
    }

    const withLanes = allocateTimelineLanes(items) as readonly ActivityTimelineItemWithLane[];
    const laneCount = withLanes.reduce(
      (max, item) => Math.max(max, item.laneIndex + 1),
      1,
    );

    rows.push({ category, items: withLanes, laneCount });
  }

  return { columns, tripDays, dayKeys, rows, visibleCount, hiddenCount };
}
