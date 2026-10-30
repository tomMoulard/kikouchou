/**
 * Unit tests for the day-by-day activity planning model.
 *
 * @module features/activities/utils/__tests__/activity-agenda-utils.test
 */
import { describe, it, expect } from 'vitest';
import { enUS, fr } from 'date-fns/locale';

import type { Activity, ActivityId, TripId } from '@/types';

import { MAX_AGENDA_SPAN_DAYS, buildActivityAgenda } from '../activity-agenda-utils';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Builds an activity from local wall-clock times, so the tests read the same
 * way the UI does regardless of the machine's timezone.
 */
function makeActivity(id: string, overrides: Partial<Activity> = {}): Activity {
  return {
    id: id as ActivityId,
    tripId: 'trip-1' as TripId,
    title: id,
    category: 'other',
    startDatetime: new Date(2024, 6, 16, 9, 0).toISOString(),
    allDay: false,
    participantIds: [],
    ...overrides,
  };
}

function at(day: number, hour: number, minute = 0): string {
  return new Date(2024, 6, day, hour, minute).toISOString();
}

function titlesByDay(activities: readonly Activity[]): Record<string, string[]> {
  return Object.fromEntries(
    buildActivityAgenda(activities, enUS).map((day) => [
      day.dateKey,
      day.entries.map((entry) => entry.activity.title),
    ]),
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('buildActivityAgenda', () => {
  it('returns no day for no activity', () => {
    expect(buildActivityAgenda([], enUS)).toEqual([]);
  });

  it('lists each day once, in order, with its activities by start time', () => {
    const activities = [
      makeActivity('raclette', { startDatetime: at(17, 19, 30) }),
      makeActivity('kayak', { startDatetime: at(16, 14) }),
      makeActivity('horse', { startDatetime: at(17, 9) }),
      makeActivity('dinner', { startDatetime: at(16, 20) }),
    ];

    expect(titlesByDay(activities)).toEqual({
      '2024-07-16': ['kayak', 'dinner'],
      '2024-07-17': ['horse', 'raclette'],
    });
  });

  it('puts a whole-day plan before the timed ones of its day', () => {
    const activities = [
      makeActivity('horse', { startDatetime: at(17, 9) }),
      makeActivity('boat', { startDatetime: at(17, 0), allDay: true }),
    ];

    expect(titlesByDay(activities)['2024-07-17']).toEqual(['boat', 'horse']);
  });

  it('lists a multi-day activity on every day it covers, first on the days after its start', () => {
    const activities = [
      makeActivity('trek', { startDatetime: at(16, 10), endDatetime: at(18, 16) }),
      makeActivity('breakfast', { startDatetime: at(17, 8) }),
    ];

    const days = buildActivityAgenda(activities, enUS);

    expect(days.map((day) => day.dateKey)).toEqual(['2024-07-16', '2024-07-17', '2024-07-18']);
    expect(days[1]!.entries.map((entry) => entry.activity.title)).toEqual(['trek', 'breakfast']);
    expect(days.map((day) => day.entries[0]!.dayNumber)).toEqual([1, 2, 3]);
    expect(days.every((day) => day.entries[0]!.dayCount === 3)).toBe(true);
  });

  it('gives each entry of a multi-day activity its own key', () => {
    const days = buildActivityAgenda(
      [makeActivity('trek', { startDatetime: at(16, 10), endDatetime: at(17, 16) })],
      enUS,
    );

    expect(days.map((day) => day.entries[0]!.id)).toEqual([
      'trek-2024-07-16',
      'trek-2024-07-17',
    ]);
  });

  it('keeps an activity that ends the day it starts on one day', () => {
    const [day] = buildActivityAgenda(
      [makeActivity('fair', { startDatetime: at(16, 9), endDatetime: at(16, 12) })],
      enUS,
    );

    expect(day!.entries[0]).toMatchObject({ dayNumber: 1, dayCount: 1 });
  });

  it('treats an end before the start as a one-day activity', () => {
    const days = buildActivityAgenda(
      [makeActivity('odd', { startDatetime: at(18, 9), endDatetime: at(16, 9) })],
      enUS,
    );

    expect(days).toHaveLength(1);
    expect(days[0]!.entries[0]).toMatchObject({ dayNumber: 1, dayCount: 1 });
  });

  it(`stops listing a long activity after ${MAX_AGENDA_SPAN_DAYS} days`, () => {
    const days = buildActivityAgenda(
      [
        makeActivity('forever', {
          startDatetime: at(1, 9),
          endDatetime: new Date(2030, 0, 1, 9).toISOString(),
        }),
      ],
      enUS,
    );

    expect(days).toHaveLength(MAX_AGENDA_SPAN_DAYS);
    expect(days.at(-1)!.entries[0]).toMatchObject({
      dayNumber: MAX_AGENDA_SPAN_DAYS,
      dayCount: MAX_AGENDA_SPAN_DAYS,
    });
  });

  it('leaves out an activity whose start does not parse', () => {
    expect(buildActivityAgenda([makeActivity('broken', { startDatetime: 'nope' })], enUS)).toEqual(
      [],
    );
  });

  it('breaks a tie on the start by title', () => {
    const activities = [
      makeActivity('b', { title: 'Yoga', startDatetime: at(16, 9) }),
      makeActivity('a', { title: 'Swim', startDatetime: at(16, 9) }),
    ];

    expect(titlesByDay(activities)['2024-07-16']).toEqual(['Swim', 'Yoga']);
  });

  it('heads each day with its full date in the given locale', () => {
    const [day] = buildActivityAgenda([makeActivity('fair')], fr);

    expect(day!.displayDate).toBe('mardi 16 juillet 2024');
  });
});
