/**
 * Unit tests for the activity timeline model builder.
 *
 * @module features/activities/utils/__tests__/activity-timeline-utils.test
 */
import { describe, it, expect } from 'vitest';

import { isoDate } from '@/test/utils';
import type { Activity, ActivityId, ShareId, Trip, TripId } from '@/types';

import { buildActivityTimelineModel } from '../activity-timeline-utils';

// ============================================================================
// Helpers
// ============================================================================

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1' as TripId,
    name: 'Summer',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-20'),
    shareId: 'share-1' as ShareId,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/**
 * Builds an activity from local wall-clock days so day keys resolve the same
 * way in every timezone.
 */
function makeActivity(
  id: string,
  startDay: number,
  endDay?: number,
  overrides: Partial<Activity> = {},
): Activity {
  return {
    id: id as ActivityId,
    tripId: 'trip-1' as TripId,
    title: id,
    category: 'horticulture',
    startDatetime: new Date(2024, 6, startDay, 10, 0).toISOString(),
    endDatetime:
      endDay === undefined ? undefined : new Date(2024, 6, endDay, 18, 0).toISOString(),
    allDay: false,
    participantIds: [],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('buildActivityTimelineModel', () => {
  it('builds one day column per trip day', () => {
    const model = buildActivityTimelineModel({ trip: makeTrip(), activities: [] });

    expect(model.dayKeys).toEqual([
      '2024-07-15',
      '2024-07-16',
      '2024-07-17',
      '2024-07-18',
      '2024-07-19',
      '2024-07-20',
    ]);
    expect(model.tripDays).toHaveLength(6);
  });

  it('places an activity on the right day column', () => {
    const model = buildActivityTimelineModel({
      trip: makeTrip(),
      activities: [makeActivity('a1', 17)],
    });

    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]?.items[0]?.startIndex).toBe(2);
    expect(model.rows[0]?.items[0]?.endIndex).toBe(2);
    expect(model.visibleCount).toBe(1);
  });

  it('spans a multi-day activity across its columns', () => {
    const model = buildActivityTimelineModel({
      trip: makeTrip(),
      activities: [makeActivity('a1', 16, 18)],
    });

    expect(model.rows[0]?.items[0]?.startIndex).toBe(1);
    expect(model.rows[0]?.items[0]?.endIndex).toBe(3);
  });

  it('groups activities into one row per category', () => {
    const model = buildActivityTimelineModel({
      trip: makeTrip(),
      activities: [
        makeActivity('garden', 16),
        makeActivity('lunch', 16, undefined, { category: 'meal' }),
      ],
    });

    expect(model.rows.map((row) => row.category)).toEqual(['horticulture', 'meal']);
    expect(model.rows.every((row) => row.items.length === 1)).toBe(true);
  });

  it('stacks overlapping activities of one category into lanes', () => {
    const model = buildActivityTimelineModel({
      trip: makeTrip(),
      activities: [makeActivity('a1', 16, 18), makeActivity('a2', 17, 19)],
    });

    expect(model.rows).toHaveLength(1);
    expect(model.rows[0]?.laneCount).toBe(2);
    expect(new Set(model.rows[0]?.items.map((item) => item.laneIndex)).size).toBe(2);
  });

  it('keeps sequential activities of one category in a single lane', () => {
    const model = buildActivityTimelineModel({
      trip: makeTrip(),
      activities: [makeActivity('a1', 15), makeActivity('a2', 18)],
    });

    expect(model.rows[0]?.laneCount).toBe(1);
  });

  it('clamps an activity that starts before the trip', () => {
    const model = buildActivityTimelineModel({
      trip: makeTrip(),
      activities: [makeActivity('a1', 12, 16)],
    });

    expect(model.rows[0]?.items[0]?.startIndex).toBe(0);
    expect(model.rows[0]?.items[0]?.endIndex).toBe(1);
  });

  it('clamps an activity that ends after the trip', () => {
    const model = buildActivityTimelineModel({
      trip: makeTrip(),
      activities: [makeActivity('a1', 19, 25)],
    });

    expect(model.rows[0]?.items[0]?.startIndex).toBe(4);
    expect(model.rows[0]?.items[0]?.endIndex).toBe(5);
  });

  it('counts activities entirely outside the trip as hidden', () => {
    const model = buildActivityTimelineModel({
      trip: makeTrip(),
      activities: [makeActivity('before', 1), makeActivity('after', 30)],
    });

    expect(model.rows).toHaveLength(0);
    expect(model.visibleCount).toBe(0);
    expect(model.hiddenCount).toBe(2);
  });

  it('counts activities with unparseable dates as hidden', () => {
    const broken = makeActivity('broken', 16, undefined, {
      startDatetime: 'not-a-date',
    });

    const model = buildActivityTimelineModel({
      trip: makeTrip(),
      activities: [broken],
    });

    expect(model.hiddenCount).toBe(1);
  });

  it('returns an empty model when the trip dates are invalid', () => {
    const model = buildActivityTimelineModel({
      trip: makeTrip({ startDate: 'nope' as Trip['startDate'] }),
      activities: [makeActivity('a1', 16)],
    });

    expect(model.tripDays).toEqual([]);
    expect(model.rows).toEqual([]);
    expect(model.hiddenCount).toBe(1);
  });
});
