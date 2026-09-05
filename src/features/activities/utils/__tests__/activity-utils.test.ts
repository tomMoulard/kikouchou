/**
 * Unit tests for the activity presentation helpers.
 *
 * @module features/activities/utils/__tests__/activity-utils.test
 */
import { describe, it, expect } from 'vitest';
import { enUS } from 'date-fns/locale';

import type { Activity, ActivityId, TripId } from '@/types';

import {
  formatActivityDayRange,
  formatActivityTimeRange,
  getActivityEndDayKey,
  getActivityEndInstant,
  getActivityStartDayKey,
  groupActivitiesByDate,
  isActivityPast,
} from '../activity-utils';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Builds an activity from local wall-clock times, so the tests read the same
 * way the UI does regardless of the machine's timezone.
 */
function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'activity-1' as ActivityId,
    tripId: 'trip-1' as TripId,
    title: 'Plant fair',
    category: 'horticulture',
    startDatetime: new Date(2024, 6, 16, 9, 0).toISOString(),
    endDatetime: new Date(2024, 6, 16, 12, 0).toISOString(),
    allDay: false,
    participantIds: [],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('activity-utils', () => {
  describe('getActivityEndInstant', () => {
    it('falls back to the start for open-ended activities', () => {
      const activity = makeActivity({ endDatetime: undefined });

      expect(getActivityEndInstant(activity)).toBe(activity.startDatetime);
    });
  });

  describe('day keys', () => {
    it('returns the local start and end days', () => {
      const activity = makeActivity();

      expect(getActivityStartDayKey(activity)).toBe('2024-07-16');
      expect(getActivityEndDayKey(activity)).toBe('2024-07-16');
    });

    it('spans several days when the end is later', () => {
      const activity = makeActivity({
        endDatetime: new Date(2024, 6, 18, 18, 0).toISOString(),
      });

      expect(getActivityStartDayKey(activity)).toBe('2024-07-16');
      expect(getActivityEndDayKey(activity)).toBe('2024-07-18');
    });

    it('returns undefined for an unparseable start', () => {
      const activity = makeActivity({ startDatetime: 'not-a-date' });

      expect(getActivityStartDayKey(activity)).toBeUndefined();
    });

    it('falls back to the start day when the end is unparseable', () => {
      const activity = makeActivity({ endDatetime: 'not-a-date' });

      expect(getActivityEndDayKey(activity)).toBe('2024-07-16');
    });
  });

  describe('isActivityPast', () => {
    it('is past once the end instant has gone by', () => {
      const activity = makeActivity();

      expect(isActivityPast(activity, new Date(2024, 6, 16, 13, 0))).toBe(true);
      expect(isActivityPast(activity, new Date(2024, 6, 16, 11, 0))).toBe(false);
    });

    it('keeps an open-ended activity current until the end of its day', () => {
      const activity = makeActivity({ endDatetime: undefined });

      // An activity with no end time is open-ended, not instantaneous: a 09:00
      // apéro must not fold itself into "past activities" at 09:01.
      expect(isActivityPast(activity, new Date(2024, 6, 16, 10, 0))).toBe(false);
      expect(isActivityPast(activity, new Date(2024, 6, 16, 23, 59))).toBe(false);
      expect(isActivityPast(activity, new Date(2024, 6, 17, 0, 1))).toBe(true);
    });

    it('is never past when the datetime is unparseable', () => {
      const activity = makeActivity({
        startDatetime: 'not-a-date',
        endDatetime: undefined,
      });

      expect(isActivityPast(activity, new Date(2030, 0, 1))).toBe(false);
    });
  });

  describe('formatActivityTimeRange', () => {
    it('returns an empty string for all-day activities', () => {
      const activity = makeActivity({ allDay: true });

      expect(formatActivityTimeRange(activity, enUS)).toBe('');
    });

    it('shows a start–end range on a single day', () => {
      expect(formatActivityTimeRange(makeActivity(), enUS)).toBe('09:00 – 12:00');
    });

    it('shows only the start when the activity is open-ended', () => {
      const activity = makeActivity({ endDatetime: undefined });

      expect(formatActivityTimeRange(activity, enUS)).toBe('09:00');
    });

    it('includes the end date when the slot crosses midnight', () => {
      const activity = makeActivity({
        endDatetime: new Date(2024, 6, 17, 2, 0).toISOString(),
      });

      expect(formatActivityTimeRange(activity, enUS)).toBe('09:00 → 17 Jul 02:00');
    });
  });

  describe('formatActivityDayRange', () => {
    it('shows a single day for a same-day activity', () => {
      expect(formatActivityDayRange(makeActivity(), enUS)).toBe('Tue 16 Jul');
    });

    it('shows both ends for a multi-day activity', () => {
      const activity = makeActivity({
        endDatetime: new Date(2024, 6, 18, 18, 0).toISOString(),
      });

      expect(formatActivityDayRange(activity, enUS)).toBe('Tue 16 Jul → Thu 18 Jul');
    });
  });

  describe('groupActivitiesByDate', () => {
    it('groups by local start day, chronologically', () => {
      const later = makeActivity({
        id: 'later' as ActivityId,
        startDatetime: new Date(2024, 6, 18, 9, 0).toISOString(),
        endDatetime: undefined,
      });
      const earlyMorning = makeActivity({
        id: 'early' as ActivityId,
        startDatetime: new Date(2024, 6, 16, 7, 0).toISOString(),
        endDatetime: undefined,
      });

      const groups = groupActivitiesByDate([later, makeActivity(), earlyMorning], enUS);

      expect(groups.map((group) => group.dateKey)).toEqual([
        '2024-07-16',
        '2024-07-18',
      ]);
      // Within a day, earliest first
      expect(groups[0]?.activities.map((activity) => activity.id)).toEqual([
        'early',
        'activity-1',
      ]);
    });

    it('skips activities with an unparseable start', () => {
      const broken = makeActivity({ startDatetime: 'not-a-date' });

      expect(groupActivitiesByDate([broken], enUS)).toEqual([]);
    });
  });
});
