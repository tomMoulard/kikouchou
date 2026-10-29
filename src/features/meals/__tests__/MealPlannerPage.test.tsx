/**
 * @fileoverview The meal planner page, through the real providers and a fake
 * IndexedDB: the flag that hides it, planning and clearing a meal, and the
 * shopping list.
 *
 * @module features/meals/__tests__/MealPlannerPage.test
 */

import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { MealPlannerPage } from '@/features/meals/pages/MealPlannerPage';
import { FLAG_OVERRIDE_PREFIX } from '@/hooks/useFeatureFlag';
import { db } from '@/lib/db/database';
import { createMeal } from '@/lib/db/repositories/meal-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createShoppingItem } from '@/lib/db/repositories/shopping-item-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { MEAL_PLANNER_FLAG } from '@/lib/flags';
import {
  hexColor,
  installTestLocalStorage,
  isoDate,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from '@/test/utils';
import type { PersonId, TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

function setMealPlannerFlag(value: 'on' | 'off'): void {
  window.localStorage.setItem(`${FLAG_OVERRIDE_PREFIX}${MEAL_PLANNER_FLAG}`, value);
}

async function seedTrip(): Promise<{ tripId: TripId; aliceId: PersonId }> {
  const trip = await createTrip({
    name: 'Provence',
    startDate: isoDate('2026-07-10'),
    endDate: isoDate('2026-07-11'),
  });
  const alice = await createPerson(trip.id, { name: 'Alice', color: hexColor('#ef4444') });
  await createPerson(trip.id, {
    name: 'Nora',
    color: hexColor('#22c55e'),
    dietaryTags: ['vegetarian'],
  });
  return { tripId: trip.id, aliceId: alice.id };
}

function renderPage(tripId: TripId, search = '') {
  return render(
    <Routes>
      <Route path="/trips/:tripId/meals" element={<MealPlannerPage />} />
      <Route path="/trips/:tripId/calendar" element={<p>calendar page</p>} />
    </Routes>,
    { initialEntries: [`/trips/${tripId}/meals${search}`] },
  );
}

beforeEach(() => {
  installTestLocalStorage();
});

// ============================================================================
// Tests
// ============================================================================

describe('MealPlannerPage', () => {
  it('sends a device without the flag to the calendar', async () => {
    setMealPlannerFlag('off');
    const { tripId } = await seedTrip();

    renderPage(tripId);

    expect(await screen.findByText('calendar page')).toBeInTheDocument();
  });

  it('shows a lunch and a dinner to plan for every day of the trip', async () => {
    setMealPlannerFlag('on');
    const { tripId } = await seedTrip();

    renderPage(tripId);

    const days = await screen.findAllByRole('listitem');
    expect(days.length).toBeGreaterThanOrEqual(2);
    expect(await screen.findAllByRole('button', { name: 'meals.plan' })).toHaveLength(4);
    // Nora's diet is counted on every meal she eats, once the guests are read.
    expect((await screen.findAllByText('diets.count')).length).toBeGreaterThan(0);
  });

  it('plans a meal from an empty slot', async () => {
    setMealPlannerFlag('on');
    const user = userEvent.setup();
    const { tripId, aliceId } = await seedTrip();
    renderPage(tripId);

    const [firstSlot] = await screen.findAllByRole('button', { name: 'meals.plan' });
    await user.click(firstSlot!);

    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: /Alice/ }));
    await user.type(within(dialog).getByLabelText('meals.menu.home'), 'Lasagne');
    await user.click(within(dialog).getByRole('button', { name: 'meals.increase' }));
    await user.click(within(dialog).getByRole('button', { name: 'common.save' }));

    await waitFor(async () => {
      const meals = await db.meals.where('tripId').equals(tripId).toArray();
      expect(meals).toHaveLength(1);
      expect(meals[0]).toMatchObject({
        date: '2026-07-10',
        slot: 'lunch',
        kind: 'home',
        organizerIds: [aliceId],
        menu: 'Lasagne',
        headcountAdjustment: 1,
      });
    });
    expect(await screen.findByText('Lasagne')).toBeInTheDocument();
  });

  it('clears a planned meal after asking', async () => {
    setMealPlannerFlag('on');
    const user = userEvent.setup();
    const { tripId } = await seedTrip();
    await createMeal(tripId, {
      date: isoDate('2026-07-10'),
      slot: 'dinner',
      kind: 'restaurant',
      organizerIds: [],
      menu: 'La Bastide',
    });
    renderPage(tripId);

    await user.click(await screen.findByRole('button', { name: 'meals.open' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'meals.clear' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'meals.clear' }));

    await waitFor(async () => {
      expect(await db.meals.where('tripId').equals(tripId).count()).toBe(0);
    });
  });

  it('adds to the shopping list, ticks a line off and clears the bought lines', async () => {
    setMealPlannerFlag('on');
    const user = userEvent.setup();
    const { tripId } = await seedTrip();
    await createShoppingItem(tripId, { name: 'Milk', checked: false });
    renderPage(tripId, '?view=shopping');

    await user.type(await screen.findByLabelText('meals.shopping.itemLabel'), 'Bread');
    await user.type(screen.getByLabelText('meals.shopping.quantityLabel'), '4');
    await user.click(screen.getByRole('button', { name: 'meals.shopping.add' }));

    expect(await screen.findByText('Bread')).toBeInTheDocument();
    const [bread] = await db.shoppingItems.where('tripId').equals(tripId).filter((item) => item.name === 'Bread').toArray();
    expect(bread).toMatchObject({ quantity: '4', checked: false });

    await user.click(screen.getAllByRole('checkbox', { name: 'meals.shopping.check' })[0]!);
    await waitFor(async () => {
      expect(await db.shoppingItems.where('tripId').equals(tripId).filter((item) => item.checked).count()).toBe(1);
    });

    await user.click(await screen.findByRole('button', { name: 'meals.shopping.clearChecked' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'meals.shopping.clearChecked' }));

    await waitFor(async () => {
      expect(await db.shoppingItems.where('tripId').equals(tripId).count()).toBe(1);
    });
  });

  it('removes one shopping line', async () => {
    setMealPlannerFlag('on');
    const user = userEvent.setup();
    const { tripId } = await seedTrip();
    await createShoppingItem(tripId, { name: 'Milk', checked: false });
    renderPage(tripId, '?view=shopping');

    await user.click(await screen.findByRole('button', { name: 'meals.shopping.remove' }));

    await waitFor(async () => {
      expect(await db.shoppingItems.where('tripId').equals(tripId).count()).toBe(0);
    });
  });
});
