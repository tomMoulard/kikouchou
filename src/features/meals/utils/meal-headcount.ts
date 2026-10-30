/**
 * @fileoverview Who eats a given lunch or dinner, and what they eat.
 *
 * The count is never stored. It is read from the guests on site at the meal's
 * time (`isGuestAtMeal`), so a guest who changes trains changes every meal
 * they now miss or catch, with nothing to keep in step. A meal only stores the
 * correction the group typed on top (`Meal.headcountAdjustment`).
 *
 * People, not rows: a guest row can stand for a couple or a family
 * (`Person.headcount`), and every figure here sums the headcount.
 *
 * @module features/meals/utils/meal-headcount
 */

import {
  isGuestAtMeal,
  MEAL_TIME_MINUTES,
  type TripStayWindow,
} from '@/features/persons/utils/guest-presence';
import { getPersonHeadcount } from '@/types';
import type {
  DietaryTag,
  ISODateString,
  Meal,
  MealSlot,
  Person,
  RoomAssignment,
  Transport,
} from '@/types';

// ============================================================================
// Types
// ============================================================================

/** The records every meal question is asked of. */
export interface MealPresenceSource {
  readonly persons: readonly Person[];
  readonly arrivals: readonly Transport[];
  readonly departures: readonly Transport[];
  readonly assignments: readonly RoomAssignment[];
  /** The trip's dates, standing in for guests who have none of their own. */
  readonly tripWindow: TripStayWindow;
}

/** One guest's food note, for the cook. */
export interface MealDietaryNote {
  readonly person: Person;
  readonly note: string;
}

/** Who eats one meal. */
export interface MealAttendance {
  /** Guest rows at the table. */
  readonly guests: readonly Person[];
  /** People on site at that time: the sum of the guests' headcounts. */
  readonly onSite: number;
  /** People to cook for: {@link onSite} plus the meal's correction, never below 0. */
  readonly people: number;
  /** People per diet tag, only the tags present. Render in `DIETARY_TAGS` order. */
  readonly diets: ReadonlyMap<DietaryTag, number>;
  /** The free-text food notes of the guests at the table. */
  readonly notes: readonly MealDietaryNote[];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Who is at the table for the `slot` meal of `dateKey`.
 *
 * @param source - The trip's guests, transports, rooms and dates
 * @param dateKey - The local calendar day of the meal
 * @param slot - Lunch or dinner
 * @param meal - The stored meal, whose correction applies, when there is one
 * @returns The guests, the counts and the diets of that meal
 *
 * @example
 * ```typescript
 * const attendance = buildMealAttendance(source, isoDate('2026-04-10'), 'dinner', meal);
 * attendance.people; // 12
 * attendance.diets.get('vegetarian'); // 2
 * ```
 */
export function buildMealAttendance(
  source: MealPresenceSource,
  dateKey: ISODateString,
  slot: MealSlot,
  meal?: Pick<Meal, 'headcountAdjustment'>,
): MealAttendance {
  const { persons, arrivals, departures, assignments, tripWindow } = source;
  const minutes = MEAL_TIME_MINUTES[slot];

  const guests = persons.filter((person) =>
    isGuestAtMeal({ person, arrivals, departures, assignments, tripWindow, dateKey, minutes }),
  );

  let onSite = 0;
  const diets = new Map<DietaryTag, number>();
  const notes: MealDietaryNote[] = [];

  for (const guest of guests) {
    const people = getPersonHeadcount(guest);
    onSite += people;
    // Every person the row stands for is counted under its tags: the cook
    // who plans one vegetarian dish too many has lost nothing.
    for (const tag of guest.dietaryTags ?? []) {
      diets.set(tag, (diets.get(tag) ?? 0) + people);
    }
    if (guest.dietaryNote) {
      notes.push({ person: guest, note: guest.dietaryNote });
    }
  }

  return {
    guests,
    onSite,
    people: Math.max(0, onSite + (meal?.headcountAdjustment ?? 0)),
    diets,
    notes,
  };
}
