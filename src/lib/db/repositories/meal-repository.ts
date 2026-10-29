/**
 * Meal Repository
 *
 * Provides CRUD operations for Meal entities: the meal planner's lunches and
 * dinners. All operations use the Dexie.js database and branded types for type
 * safety.
 *
 * @module lib/db/repositories/meal-repository
 */

import { db } from '@/lib/db/database';
import { sanitizeMealData } from '@/lib/db/sanitize';
import { createMealId } from '@/lib/db/utils';
import type { Meal, MealFormData, MealId, TripId } from '@/types';
import { repositoryError } from '@/lib/db/repository-error';

// ============================================================================
// Constants
// ============================================================================

/**
 * Upper bound for a string component of a compound index range.
 * Matches the bound the other trip reads use, so the ranges select the same rows.
 */
const MAX_STRING_KEY = '￿';

// ============================================================================
// Create
// ============================================================================

/**
 * Creates a new meal in the database.
 *
 * @param tripId - The trip this meal belongs to
 * @param data - The meal form data
 * @returns The created Meal object
 *
 * @example
 * ```typescript
 * const meal = await createMeal(tripId, {
 *   date: '2024-07-16' as ISODateString,
 *   slot: 'dinner',
 *   kind: 'home',
 *   organizerIds: [personId],
 *   menu: 'Lasagne',
 * });
 * ```
 */
export async function createMeal(tripId: TripId, data: MealFormData): Promise<Meal> {
  const sanitizedData = sanitizeMealData(data);

  try {
    const meal: Meal = {
      id: createMealId(),
      tripId,
      ...withoutUndefined(sanitizedData),
      organizerIds: [...sanitizedData.organizerIds],
    };

    await db.meals.add(meal);
    return meal;
  } catch (error) {
    throw repositoryError(
      `Failed to create the ${data.slot} meal of ${data.date} for trip ${tripId}`,
      error,
    );
  }
}

// ============================================================================
// Read
// ============================================================================

/**
 * Retrieves every meal of a trip, oldest day first.
 *
 * Uses the compound index [tripId+date] for efficient querying.
 *
 * @param tripId - The trip ID to filter by
 * @returns Array of meals sorted by date ascending
 */
export async function getMealsByTripId(tripId: TripId): Promise<Meal[]> {
  return db.meals
    .where('[tripId+date]')
    .between([tripId, ''], [tripId, MAX_STRING_KEY])
    .toArray();
}

/**
 * Retrieves one meal by its unique ID.
 *
 * @param id - The meal's unique identifier
 * @returns The meal if found, undefined otherwise
 */
export async function getMealById(id: MealId): Promise<Meal | undefined> {
  return db.meals.get(id);
}

/**
 * Counts the meals of a trip.
 *
 * @param tripId - The trip ID to count meals for
 * @returns Number of meals in the trip
 */
export async function getMealCount(tripId: TripId): Promise<number> {
  return db.meals.where('tripId').equals(tripId).count();
}

// ============================================================================
// Transactional Operations with Ownership Validation
// ============================================================================

/**
 * Updates a meal with ownership validation in a single transaction.
 * Prevents a TOCTOU race by combining validation and mutation atomically.
 *
 * A field passed as `undefined` is cleared; a field left out stays as it is.
 *
 * @param id - The meal's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @param data - Partial meal form data to update
 * @throws {Error} If the meal is not found or belongs to another trip
 */
export async function updateMealWithOwnershipCheck(
  id: MealId,
  tripId: TripId,
  data: Partial<MealFormData>,
): Promise<void> {
  const sanitizedData = sanitizeMealPartial(data);

  await db.transaction('rw', db.meals, async () => {
    const meal = await db.meals.get(id);

    if (!meal) {
      throw new Error(`Meal with ID "${id}" not found`);
    }
    if (meal.tripId !== tripId) {
      throw new Error('Cannot update meal: meal does not belong to current trip');
    }

    await db.meals.update(id, sanitizedData);
  });
}

/**
 * Deletes a meal with ownership validation in a single transaction.
 *
 * @param id - The meal's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @throws {Error} If the meal is not found or belongs to another trip
 */
export async function deleteMealWithOwnershipCheck(
  id: MealId,
  tripId: TripId,
): Promise<void> {
  await db.transaction('rw', db.meals, async () => {
    const meal = await db.meals.get(id);

    if (!meal) {
      throw new Error(`Meal with ID "${id}" not found`);
    }
    if (meal.tripId !== tripId) {
      throw new Error('Cannot delete meal: meal does not belong to current trip');
    }

    await db.meals.delete(id);
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Drops the keys whose value is `undefined`, so a new row stores nothing for
 * an empty optional field rather than a key that the document would carry.
 */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

/**
 * Sanitizes the subset of meal fields present in a partial update.
 * Fields that are absent stay absent so Dexie does not clear them.
 */
function sanitizeMealPartial(data: Partial<MealFormData>): Partial<MealFormData> {
  const sanitized = sanitizeMealData({
    menu: data.menu,
    organizerIds: data.organizerIds ?? [],
    headcountAdjustment: data.headcountAdjustment,
  });

  const next: Partial<MealFormData> = { ...data };

  if ('menu' in data) {
    next.menu = sanitized.menu;
  }
  if (data.organizerIds !== undefined) {
    next.organizerIds = [...sanitized.organizerIds];
  }
  if ('headcountAdjustment' in data) {
    next.headcountAdjustment = sanitized.headcountAdjustment;
  }

  return next;
}
