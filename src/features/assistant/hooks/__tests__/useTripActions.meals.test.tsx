/**
 * @fileoverview The meal planner's assistant actions: planMeal, removeMeal,
 * addShoppingItem, checkShoppingItem and removeShoppingItem, and the flag
 * that keeps all five off a device where the planner does not exist.
 *
 * @module features/assistant/hooks/__tests__/useTripActions.meals.test
 */

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { AppProviders } from '@/contexts/AppProviders';
import { useTripContext } from '@/contexts/TripContext';
import { FLAG_OVERRIDE_PREFIX } from '@/hooks/useFeatureFlag';
import { db } from '@/lib/db/database';
import { createMeal } from '@/lib/db/repositories/meal-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createShoppingItem } from '@/lib/db/repositories/shopping-item-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { MEAL_PLANNER_FLAG } from '@/lib/flags';
import { hexColor, installTestLocalStorage, isoDate, waitForTripDoc } from '@/test/utils';
import type { PersonId, TripId } from '@/types';

import { DESTRUCTIVE_ACTIONS, useTripActions, type ActionExecutionResult } from '../useTripActions';

// ============================================================================
// Test Helpers
// ============================================================================

function Wrapper({ children }: { children: ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}

function useCombined() {
  return { trip: useTripContext(), actions: useTripActions() };
}

function actionBlock(payload: unknown): string {
  return `Sure!\n\n\`\`\`action\n${JSON.stringify(payload)}\n\`\`\``;
}

function setMealPlannerFlag(value: 'on' | 'off'): void {
  window.localStorage.setItem(`${FLAG_OVERRIDE_PREFIX}${MEAL_PLANNER_FLAG}`, value);
}

async function seedTrip(): Promise<{ tripId: TripId; personId: PersonId }> {
  const trip = await createTrip({
    name: 'Test Trip',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-20'),
  });
  const person = await createPerson(trip.id, { name: 'Alice', color: hexColor('#ef4444') });
  return { tripId: trip.id, personId: person.id };
}

async function renderWithTrip(tripId: TripId) {
  const { result } = renderHook(() => useCombined(), { wrapper: Wrapper });

  await waitFor(() => {
    expect(result.current.trip.isLoading).toBe(false);
  });
  await act(async () => {
    await result.current.trip.setCurrentTrip(tripId);
  });
  await waitFor(() => {
    expect(result.current.trip.currentTrip?.id).toBe(tripId);
  });
  await waitForTripDoc(tripId);

  return result;
}

async function run(
  executeActions: (response: string) => Promise<ActionExecutionResult>,
  response: string,
): Promise<ActionExecutionResult> {
  let outcome: ActionExecutionResult = { count: 0, summaries: [] };
  await act(async () => {
    outcome = await executeActions(response);
  });
  return outcome;
}

beforeEach(() => {
  installTestLocalStorage();
});

// ============================================================================
// Tests
// ============================================================================

describe('useTripActions: meal planner', () => {
  it('asks before clearing a meal or removing a shopping line', () => {
    expect(DESTRUCTIVE_ACTIONS.has('removeMeal')).toBe(true);
    expect(DESTRUCTIVE_ACTIONS.has('removeShoppingItem')).toBe(true);
  });

  it('refuses every meal action while the flag is off', async () => {
    setMealPlannerFlag('off');
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'addShoppingItem', data: { name: 'Bread' } }),
    );

    expect(outcome.count).toBe(0);
    expect(await db.shoppingItems.count()).toBe(0);
  });

  it('plans a new meal, then edits the same slot instead of adding a second', async () => {
    setMealPlannerFlag('on');
    const { tripId, personId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const first = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'planMeal',
        data: {
          date: '2024-07-16',
          slot: 'dinner',
          organizerIds: [personId, 'not-a-guest'],
          menu: 'Lasagne',
          extra: 2,
        },
      }),
    );
    expect(first.count).toBe(1);
    expect(first.summaries).toHaveLength(1);

    const second = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'planMeal',
        data: { date: '2024-07-16', slot: 'dinner', kind: 'restaurant' },
      }),
    );
    expect(second.count).toBe(1);

    const meals = await db.meals.where('tripId').equals(tripId).toArray();
    expect(meals).toHaveLength(1);
    expect(meals[0]).toMatchObject({
      kind: 'restaurant',
      organizerIds: [personId],
      menu: 'Lasagne',
      headcountAdjustment: 2,
    });
  });

  it('refuses a meal on a day that is not a calendar day', async () => {
    setMealPlannerFlag('on');
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'planMeal', data: { date: 'tomorrow', slot: 'lunch' } }),
    );

    expect(outcome.count).toBe(0);
    expect(await db.meals.count()).toBe(0);
  });

  it('clears a meal of this trip, and refuses one of another trip', async () => {
    setMealPlannerFlag('on');
    const { tripId } = await seedTrip();
    const other = await seedTrip();
    const meal = await createMeal(tripId, {
      date: isoDate('2024-07-16'),
      slot: 'lunch',
      kind: 'home',
      organizerIds: [],
    });
    const foreign = await createMeal(other.tripId, {
      date: isoDate('2024-07-16'),
      slot: 'lunch',
      kind: 'home',
      organizerIds: [],
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      [
        actionBlock({ action: 'removeMeal', data: { mealId: meal.id } }),
        actionBlock({ action: 'removeMeal', data: { mealId: foreign.id } }),
      ].join('\n'),
    );

    expect(outcome.count).toBe(1);
    expect(await db.meals.get(meal.id)).toBeUndefined();
    expect(await db.meals.get(foreign.id)).toBeDefined();
  });

  it('adds, ticks and removes shopping lines', async () => {
    setMealPlannerFlag('on');
    const { tripId, personId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const added = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addShoppingItem',
        data: { name: 'Bread', quantity: '4', buyerId: personId },
      }),
    );
    expect(added.count).toBe(1);

    const [item] = await db.shoppingItems.where('tripId').equals(tripId).toArray();
    expect(item).toMatchObject({ name: 'Bread', quantity: '4', buyerId: personId, checked: false });

    const checked = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'checkShoppingItem', data: { itemId: item!.id } }),
    );
    expect(checked.count).toBe(1);
    expect((await db.shoppingItems.get(item!.id))?.checked).toBe(true);

    const removed = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'removeShoppingItem', data: { itemId: item!.id } }),
    );
    expect(removed.count).toBe(1);
    expect(await db.shoppingItems.get(item!.id)).toBeUndefined();
  });

  it('refuses a nameless line and a line of another trip', async () => {
    setMealPlannerFlag('on');
    const { tripId } = await seedTrip();
    const other = await seedTrip();
    const foreign = await createShoppingItem(other.tripId, { name: 'Eggs', checked: false });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      [
        actionBlock({ action: 'addShoppingItem', data: { name: '   ' } }),
        actionBlock({ action: 'checkShoppingItem', data: { itemId: foreign.id } }),
      ].join('\n'),
    );

    expect(outcome.count).toBe(0);
    expect(await db.shoppingItems.where('tripId').equals(tripId).count()).toBe(0);
    expect((await db.shoppingItems.get(foreign.id))?.checked).toBe(false);
  });
});
