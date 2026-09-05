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
import { buildTripDayColumns, toDayKeys } from '@/lib/utils/trip-days';
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
  /** One Date per trip day */
  readonly tripDays: readonly Date[];
  /** Day keys matching `tripDays` (YYYY-MM-DD) */
  readonly dayKeys: readonly ISODateString[];
  /** Category rows, in the canonical category order, empty rows omitted */
  readonly rows: readonly ActivityTimelineRowModel[];
  /** Number of activities placed on the timeline */
  readonly visibleCount: number;
  /**
   * Number of activities that fall entirely outside the trip dates and are
   * therefore not drawn. Surfaced so the UI can explain the gap.
   */
  readonly hiddenCount: number;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Builds the activity timeline model for a trip.
 *
 * Activities that start before the trip or end after it are clamped to the
 * visible window; activities entirely outside it are counted in `hiddenCount`.
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
}): ActivityTimelineModel {
  const { trip, activities } = args;

  const tripDays = buildTripDayColumns(trip);
  // Local keys, matching `getActivityStartDayKey` — an activity has to land in
  // the column whose date the guest reads off their own clock.
  const dayKeys = toDayKeys(tripDays);

  if (dayKeys.length === 0) {
    return {
      tripDays,
      dayKeys,
      rows: [],
      visibleCount: 0,
      hiddenCount: activities.length,
    };
  }

  const firstKey = dayKeys[0]!;
  const lastKey = dayKeys[dayKeys.length - 1]!;

  const dayIndexByKey = new Map<ISODateString, number>();
  dayKeys.forEach((key, index) => {
    dayIndexByKey.set(key, index);
  });

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

    // Entirely before or after the trip window: nothing to draw.
    if (endKey < firstKey || startKey > lastKey) {
      hiddenCount += 1;
      continue;
    }

    const clampedStart = startKey < firstKey ? firstKey : startKey;
    const clampedEnd = endKey > lastKey ? lastKey : endKey;

    const startIndex = dayIndexByKey.get(clampedStart);
    const endIndex = dayIndexByKey.get(clampedEnd);

    if (startIndex === undefined || endIndex === undefined) {
      hiddenCount += 1;
      continue;
    }

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

  return { tripDays, dayKeys, rows, visibleCount, hiddenCount };
}
