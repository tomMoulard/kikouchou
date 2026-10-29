/**
 * Integration tests for the Meal and Shopping Item Repositories
 *
 * Covers CRUD, ownership validation, the sanitising the write path applies, and
 * what happens to the planner when a guest or the trip itself is deleted.
 *
 * @module lib/db/repositories/__tests__/meal-repository.test
 */
import { describe, expect, it } from 'vitest';

import { db } from '@/lib/db/database';
import {
  createMeal,
  deleteMealWithOwnershipCheck,
  getMealById,
  getMealCount,
  getMealsByTripId,
  updateMealWithOwnershipCheck,
} from '@/lib/db/repositories/meal-repository';
import {
  createPerson,
  deletePerson,
  deletePersonWithOwnershipCheck,
  updatePersonWithOwnershipCheck,
} from '@/lib/db/repositories/person-repository';
import {
  createShoppingItem,
  deleteCheckedShoppingItems,
  deleteShoppingItemWithOwnershipCheck,
  getShoppingItemById,
  getShoppingItemsByTripId,
  updateShoppingItemWithOwnershipCheck,
} from '@/lib/db/repositories/shopping-item-repository';
import { createTrip, deleteTrip } from '@/lib/db/repositories/trip-repository';
import { hexColor, isoDate } from '@/test/utils';
import { MAX_MEAL_HEADCOUNT_ADJUSTMENT, MAX_SHOPPING_ITEMS } from '@/types';
import type { MealFormData, MealId, PersonId, ShoppingItemId, TripId } from '@/types';

// ============================================================================
// Test Data Factories
// ============================================================================

async function createTestTrip(name = 'Test Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: isoDate('2026-07-15'),
    endDate: isoDate('2026-07-22'),
  });
  return trip.id;
}

async function createTestPerson(tripId: TripId, name = 'Marie'): Promise<PersonId> {
  const person = await createPerson(tripId, { name, color: hexColor('#ef4444') });
  return person.id;
}

function mealData(overrides: Partial<MealFormData> = {}): MealFormData {
  return {
    date: isoDate('2026-07-16'),
    slot: 'dinner',
    kind: 'home',
    organizerIds: [],
    ...overrides,
  };
}

// ============================================================================
// Meals
// ============================================================================

describe('meal repository', () => {
  it('creates a meal and reads it back by trip and by id', async () => {
    const tripId = await createTestTrip();
    const cook = await createTestPerson(tripId);

    const meal = await createMeal(
      tripId,
      mealData({ organizerIds: [cook], menu: '  Lasagne  ' }),
    );

    expect(meal.menu).toBe('Lasagne');
    expect(await getMealById(meal.id)).toEqual(meal);
    expect(await getMealsByTripId(tripId)).toEqual([meal]);
    expect(await getMealCount(tripId)).toBe(1);
  });

  it('stores no key for an empty optional field', async () => {
    const tripId = await createTestTrip();

    const meal = await createMeal(tripId, mealData({ menu: '   ', headcountAdjustment: 0 }));
    const stored = await getMealById(meal.id);

    expect(stored).not.toHaveProperty('menu');
    expect(stored).not.toHaveProperty('headcountAdjustment');
  });

  it('clamps the correction and keeps each organiser once', async () => {
    const tripId = await createTestTrip();
    const cook = await createTestPerson(tripId);

    const meal = await createMeal(
      tripId,
      mealData({ organizerIds: [cook, cook], headcountAdjustment: 500 }),
    );

    expect(meal.organizerIds).toEqual([cook]);
    expect(meal.headcountAdjustment).toBe(MAX_MEAL_HEADCOUNT_ADJUSTMENT);
  });

  it('updates the fields it is given and clears the ones passed as undefined', async () => {
    const tripId = await createTestTrip();
    const meal = await createMeal(tripId, mealData({ menu: 'Lasagne', headcountAdjustment: 2 }));

    await updateMealWithOwnershipCheck(meal.id, tripId, { kind: 'restaurant' });
    expect(await getMealById(meal.id)).toMatchObject({
      kind: 'restaurant',
      menu: 'Lasagne',
      headcountAdjustment: 2,
    });

    await updateMealWithOwnershipCheck(meal.id, tripId, {
      menu: undefined,
      headcountAdjustment: undefined,
    });
    const cleared = await getMealById(meal.id);
    expect(cleared?.menu).toBeUndefined();
    expect(cleared?.headcountAdjustment).toBeUndefined();
  });

  it('refuses to update or delete a meal of another trip', async () => {
    const tripId = await createTestTrip();
    const otherTripId = await createTestTrip('Other');
    const meal = await createMeal(tripId, mealData());

    await expect(
      updateMealWithOwnershipCheck(meal.id, otherTripId, { menu: 'x' }),
    ).rejects.toThrow('does not belong');
    await expect(deleteMealWithOwnershipCheck(meal.id, otherTripId)).rejects.toThrow(
      'does not belong',
    );
    await expect(
      updateMealWithOwnershipCheck('missing' as MealId, tripId, { menu: 'x' }),
    ).rejects.toThrow('not found');
    await expect(deleteMealWithOwnershipCheck('missing' as MealId, tripId)).rejects.toThrow(
      'not found',
    );
  });

  it('deletes a meal', async () => {
    const tripId = await createTestTrip();
    const meal = await createMeal(tripId, mealData());

    await deleteMealWithOwnershipCheck(meal.id, tripId);

    expect(await getMealById(meal.id)).toBeUndefined();
  });
});

// ============================================================================
// Shopping items
// ============================================================================

describe('shopping item repository', () => {
  it('adds lines and lists them in the order they were added', async () => {
    const tripId = await createTestTrip();

    const bread = await createShoppingItem(tripId, { name: ' Bread ', checked: false });
    const milk = await createShoppingItem(tripId, {
      name: 'Milk',
      quantity: '2 L',
      checked: false,
    });

    // Two lines added in one millisecond tie on `createdAt`, so the times are
    // set apart here: the order under test is the one `createdAt` gives.
    await db.shoppingItems.update(bread.id, { createdAt: 1_000 });
    await db.shoppingItems.update(milk.id, { createdAt: 2_000 });

    expect(bread.name).toBe('Bread');
    expect(bread).not.toHaveProperty('quantity');
    expect((await getShoppingItemsByTripId(tripId)).map((item) => item.id)).toEqual([
      bread.id,
      milk.id,
    ]);
  });

  it('refuses a line past the size of the list', async () => {
    const tripId = await createTestTrip();
    await db.shoppingItems.bulkAdd(
      Array.from({ length: MAX_SHOPPING_ITEMS }, (_, index) => ({
        id: `item-${index}` as ShoppingItemId,
        tripId,
        name: `Item ${index}`,
        checked: false,
        createdAt: index,
      })),
    );

    await expect(createShoppingItem(tripId, { name: 'One more', checked: false })).rejects.toThrow();
  });

  it('ticks a line, names its buyer, then clears it', async () => {
    const tripId = await createTestTrip();
    const buyer = await createTestPerson(tripId);
    const item = await createShoppingItem(tripId, {
      name: 'Bread',
      quantity: '4',
      checked: false,
    });

    await updateShoppingItemWithOwnershipCheck(item.id, tripId, {
      checked: true,
      buyerId: buyer,
      name: '  Baguettes ',
    });
    expect(await getShoppingItemById(item.id)).toMatchObject({
      checked: true,
      buyerId: buyer,
      name: 'Baguettes',
      quantity: '4',
    });

    await updateShoppingItemWithOwnershipCheck(item.id, tripId, { quantity: '' });
    expect((await getShoppingItemById(item.id))?.quantity).toBeUndefined();
  });

  it('refuses to touch a line of another trip', async () => {
    const tripId = await createTestTrip();
    const otherTripId = await createTestTrip('Other');
    const item = await createShoppingItem(tripId, { name: 'Bread', checked: false });

    await expect(
      updateShoppingItemWithOwnershipCheck(item.id, otherTripId, { checked: true }),
    ).rejects.toThrow('does not belong');
    await expect(deleteShoppingItemWithOwnershipCheck(item.id, otherTripId)).rejects.toThrow(
      'does not belong',
    );
    await expect(
      updateShoppingItemWithOwnershipCheck('missing' as ShoppingItemId, tripId, {
        checked: true,
      }),
    ).rejects.toThrow('not found');
    await expect(
      deleteShoppingItemWithOwnershipCheck('missing' as ShoppingItemId, tripId),
    ).rejects.toThrow('not found');
  });

  it('clears the bought lines of one trip only', async () => {
    const tripId = await createTestTrip();
    const otherTripId = await createTestTrip('Other');
    const bought = await createShoppingItem(tripId, { name: 'Bread', checked: true });
    const toBuy = await createShoppingItem(tripId, { name: 'Milk', checked: false });
    const otherBought = await createShoppingItem(otherTripId, { name: 'Eggs', checked: true });

    expect(await deleteCheckedShoppingItems(tripId)).toBe(1);

    expect(await getShoppingItemById(bought.id)).toBeUndefined();
    expect(await getShoppingItemById(toBuy.id)).toBeDefined();
    expect(await getShoppingItemById(otherBought.id)).toBeDefined();
  });

  it('deletes a line', async () => {
    const tripId = await createTestTrip();
    const item = await createShoppingItem(tripId, { name: 'Bread', checked: false });

    await deleteShoppingItemWithOwnershipCheck(item.id, tripId);

    expect(await getShoppingItemById(item.id)).toBeUndefined();
  });
});

// ============================================================================
// Cascades
// ============================================================================

describe('meal planner cascades', () => {
  it('takes a deleted guest off the meals and the shopping list, keeping both', async () => {
    const tripId = await createTestTrip();
    const leaving = await createTestPerson(tripId, 'Leaving');
    const staying = await createTestPerson(tripId, 'Staying');
    const meal = await createMeal(tripId, mealData({ organizerIds: [leaving, staying] }));
    const item = await createShoppingItem(tripId, {
      name: 'Bread',
      buyerId: leaving,
      checked: false,
    });

    await deletePersonWithOwnershipCheck(leaving, tripId);

    expect((await getMealById(meal.id))?.organizerIds).toEqual([staying]);
    expect((await getShoppingItemById(item.id))?.buyerId).toBeUndefined();
  });

  it('does the same through the legacy delete', async () => {
    const tripId = await createTestTrip();
    const leaving = await createTestPerson(tripId, 'Leaving');
    const meal = await createMeal(tripId, mealData({ organizerIds: [leaving] }));

    await deletePerson(leaving);

    expect((await getMealById(meal.id))?.organizerIds).toEqual([]);
  });

  it('deletes every meal and line of a deleted trip', async () => {
    const tripId = await createTestTrip();
    await createMeal(tripId, mealData());
    await createShoppingItem(tripId, { name: 'Bread', checked: false });

    await deleteTrip(tripId);

    expect(await db.meals.where('tripId').equals(tripId).count()).toBe(0);
    expect(await db.shoppingItems.where('tripId').equals(tripId).count()).toBe(0);
  });
});

// ============================================================================
// Guest diet
// ============================================================================

describe('guest diet', () => {
  it('keeps known tags once, bounds the note, and clears both when emptied', async () => {
    const tripId = await createTestTrip();
    const personId = await createTestPerson(tripId);

    await updatePersonWithOwnershipCheck(personId, tripId, {
      dietaryTags: ['vegan', 'vegan', 'unknown' as 'vegan'],
      dietaryNote: `  ${'x'.repeat(500)}  `,
    });
    const person = await db.persons.get(personId);
    expect(person?.dietaryTags).toEqual(['vegan']);
    expect(person?.dietaryNote).toHaveLength(200);

    await updatePersonWithOwnershipCheck(personId, tripId, {
      dietaryTags: [],
      dietaryNote: '',
    });
    const cleared = await db.persons.get(personId);
    expect(cleared?.dietaryTags).toBeUndefined();
    expect(cleared?.dietaryNote).toBeUndefined();
  });
});
