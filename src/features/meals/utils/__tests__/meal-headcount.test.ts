/**
 * @fileoverview Tests for who eats a given lunch or dinner.
 *
 * Transport instants are built from local wall-clock times, so every test
 * reads the same in Paris, Tokyo and at UTC, where CI runs.
 *
 * @module features/meals/utils/__tests__/meal-headcount.test
 */

import { describe, expect, it } from 'vitest';

import {
  isGuestAtMeal,
  MEAL_TIME_MINUTES,
} from '@/features/persons/utils/guest-presence';
import type {
  HexColor,
  ISODateString,
  ISODateTimeString,
  Person,
  PersonId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

import { buildMealAttendance, type MealPresenceSource } from '../meal-headcount';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;
const DAY = '2026-04-10' as ISODateString;
const TRIP_WINDOW = {
  startDate: '2026-04-09' as ISODateString,
  endDate: '2026-04-12' as ISODateString,
};

function makePerson(id: string, extra: Partial<Person> = {}): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name: id,
    color: '#3b82f6' as HexColor,
    ...extra,
  };
}

/** A transport at a local wall-clock time on 10 April 2026. */
function makeTransport(
  personId: string,
  type: Transport['type'],
  hours: number,
  minutes = 0,
): Transport {
  return {
    id: `${personId}-${type}` as TransportId,
    tripId: TRIP_ID,
    personId: personId as PersonId,
    type,
    datetime: new Date(2026, 3, 10, hours, minutes).toISOString() as ISODateTimeString,
    location: 'Station',
    needsPickup: false,
  } as Transport;
}

function sourceOf(
  persons: readonly Person[],
  transports: readonly Transport[] = [],
): MealPresenceSource {
  return {
    persons,
    arrivals: transports.filter((transport) => transport.type === 'arrival'),
    departures: transports.filter((transport) => transport.type === 'departure'),
    assignments: [],
    tripWindow: TRIP_WINDOW,
  };
}

// ============================================================================
// isGuestAtMeal
// ============================================================================

describe('isGuestAtMeal', () => {
  const query = (person: Person, transports: readonly Transport[], minutes: number) =>
    isGuestAtMeal({
      person,
      arrivals: transports.filter((transport) => transport.type === 'arrival'),
      departures: transports.filter((transport) => transport.type === 'departure'),
      assignments: [],
      tripWindow: TRIP_WINDOW,
      dateKey: DAY,
      minutes,
    });

  it('counts a guest with no transport that day for both meals', () => {
    const person = makePerson('alice');

    expect(query(person, [], MEAL_TIME_MINUTES.lunch)).toBe(true);
    expect(query(person, [], MEAL_TIME_MINUTES.dinner)).toBe(true);
  });

  it('leaves out a guest who arrives after lunch, and counts them for dinner', () => {
    const person = makePerson('alice');
    const transports = [makeTransport('alice', 'arrival', 15)];

    expect(query(person, transports, MEAL_TIME_MINUTES.lunch)).toBe(false);
    expect(query(person, transports, MEAL_TIME_MINUTES.dinner)).toBe(true);
  });

  it('counts a guest who arrives exactly at the meal', () => {
    const person = makePerson('alice');
    const transports = [makeTransport('alice', 'arrival', 12, 30)];

    expect(query(person, transports, MEAL_TIME_MINUTES.lunch)).toBe(true);
  });

  it('leaves out a guest who leaves before dinner, and counts them for lunch', () => {
    const person = makePerson('bob');
    const transports = [makeTransport('bob', 'departure', 16)];

    expect(query(person, transports, MEAL_TIME_MINUTES.lunch)).toBe(true);
    expect(query(person, transports, MEAL_TIME_MINUTES.dinner)).toBe(false);
  });

  it('leaves out a guest who leaves in the morning from both meals', () => {
    const person = makePerson('bob');
    const transports = [makeTransport('bob', 'departure', 9)];

    expect(query(person, transports, MEAL_TIME_MINUTES.lunch)).toBe(false);
    expect(query(person, transports, MEAL_TIME_MINUTES.dinner)).toBe(false);
  });

  it('ignores another guest’s transports', () => {
    const person = makePerson('alice');
    const transports = [makeTransport('bob', 'arrival', 21)];

    expect(query(person, transports, MEAL_TIME_MINUTES.dinner)).toBe(true);
  });

  it('never counts a guest who is not on site that day', () => {
    const person = makePerson('carol', {
      stayStartDate: '2026-04-11' as ISODateString,
      stayEndDate: '2026-04-12' as ISODateString,
    });

    expect(query(person, [], MEAL_TIME_MINUTES.lunch)).toBe(false);
  });
});

// ============================================================================
// buildMealAttendance
// ============================================================================

describe('buildMealAttendance', () => {
  it('counts people, not guest rows', () => {
    const persons = [makePerson('alice'), makePerson('family', { headcount: 3 })];

    const attendance = buildMealAttendance(sourceOf(persons), DAY, 'dinner');

    expect(attendance.guests).toHaveLength(2);
    expect(attendance.onSite).toBe(4);
    expect(attendance.people).toBe(4);
  });

  it('adds the meal’s correction, and never goes below zero', () => {
    const persons = [makePerson('alice')];

    expect(
      buildMealAttendance(sourceOf(persons), DAY, 'dinner', { headcountAdjustment: 2 }).people,
    ).toBe(3);
    expect(
      buildMealAttendance(sourceOf(persons), DAY, 'dinner', { headcountAdjustment: -5 }).people,
    ).toBe(0);
  });

  it('counts each diet once per person the row stands for', () => {
    const persons = [
      makePerson('nora', { dietaryTags: ['vegetarian'] }),
      makePerson('couple', { headcount: 2, dietaryTags: ['vegetarian', 'glutenFree'] }),
      makePerson('hugo'),
    ];

    const attendance = buildMealAttendance(sourceOf(persons), DAY, 'lunch');

    expect(attendance.diets.get('vegetarian')).toBe(3);
    expect(attendance.diets.get('glutenFree')).toBe(2);
    expect(attendance.diets.has('vegan')).toBe(false);
  });

  it('lists the food notes of the guests at the table only', () => {
    const persons = [
      makePerson('hugo', { dietaryNote: 'Nuts' }),
      makePerson('late', { dietaryNote: 'Shellfish' }),
    ];
    const transports = [makeTransport('late', 'arrival', 20)];

    const attendance = buildMealAttendance(sourceOf(persons, transports), DAY, 'lunch');

    expect(attendance.notes.map((entry) => entry.note)).toEqual(['Nuts']);
  });

  it('reads the time of day from the transports', () => {
    const persons = [makePerson('alice'), makePerson('bob')];
    const transports = [makeTransport('bob', 'arrival', 18)];

    expect(buildMealAttendance(sourceOf(persons, transports), DAY, 'lunch').onSite).toBe(1);
    expect(buildMealAttendance(sourceOf(persons, transports), DAY, 'dinner').onSite).toBe(2);
  });
});
