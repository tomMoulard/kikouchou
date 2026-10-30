/**
 * @fileoverview The meal planner in the assistant's prompt: the meals, the
 * shopping list and the guests' diets where the flag is on, and none of it
 * where the flag is off.
 *
 * @module features/assistant/hooks/__tests__/useTripSystemPrompt.meals.test
 */

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { AppProviders } from '@/contexts/AppProviders';
import { useTripContext } from '@/contexts/TripContext';
import { FLAG_OVERRIDE_PREFIX } from '@/hooks/useFeatureFlag';
import { createMeal } from '@/lib/db/repositories/meal-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createShoppingItem } from '@/lib/db/repositories/shopping-item-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { MEAL_PLANNER_FLAG } from '@/lib/flags';
import { hexColor, installTestLocalStorage, isoDate, waitForTripDoc } from '@/test/utils';
import type { TripId } from '@/types';

import { useTripSystemPrompt } from '../useTripSystemPrompt';

// ============================================================================
// Test Helpers
// ============================================================================

function Wrapper({ children }: { children: ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}

function useCombined() {
  return { trip: useTripContext(), prompt: useTripSystemPrompt() };
}

async function seedTrip(): Promise<TripId> {
  const trip = await createTrip({
    name: 'Test Trip',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-20'),
  });
  const nora = await createPerson(trip.id, {
    name: 'Nora',
    color: hexColor('#ef4444'),
    dietaryTags: ['vegetarian'],
    dietaryNote: 'No mushrooms',
  });
  await createPerson(trip.id, { name: 'Hugo', color: hexColor('#3b82f6'), headcount: 2 });
  await createMeal(trip.id, {
    date: isoDate('2024-07-16'),
    slot: 'dinner',
    kind: 'home',
    organizerIds: [nora.id],
    menu: 'Lasagne',
    headcountAdjustment: 1,
  });
  await createShoppingItem(trip.id, { name: 'Bread', quantity: '4', checked: true });
  return trip.id;
}

/** The prompt once it names `marker`, which the last rows to load carry. */
async function promptFor(tripId: TripId, marker: string): Promise<string> {
  const { result } = renderHook(() => useCombined(), { wrapper: Wrapper });
  await waitFor(() => {
    expect(result.current.trip.isLoading).toBe(false);
  });
  await act(async () => {
    await result.current.trip.setCurrentTrip(tripId);
  });
  await waitForTripDoc(tripId);
  await waitFor(() => {
    expect(result.current.prompt.systemPrompt).toContain(marker);
  });
  return result.current.prompt.systemPrompt;
}

beforeEach(() => {
  installTestLocalStorage();
});

// ============================================================================
// Tests
// ============================================================================

describe('useTripSystemPrompt: meal planner', () => {
  it('lists the meals, the shopping list and the diets where the flag is on', async () => {
    window.localStorage.setItem(`${FLAG_OVERRIDE_PREFIX}${MEAL_PLANNER_FLAG}`, 'on');
    const tripId = await seedTrip();

    const prompt = await promptFor(tripId, '"Bread"');

    // Nora (1) and Hugo (2) are on site, plus one guest of the meal's own.
    expect(prompt).toMatch(/dinner on 2024-07-16 \(id: .+\) · home · by Nora · menu: Lasagne · 4 people/);
    expect(prompt).toMatch(/"Bread" \(id: .+\) · 4 · already bought/);
    expect(prompt).toContain('diet: vegetarian');
    expect(prompt).toContain('food: No mushrooms');
    expect(prompt).toContain('planMeal');
  });

  it('says nothing of the planner where the flag is off', async () => {
    const tripId = await seedTrip();

    const prompt = await promptFor(tripId, '"Hugo"');

    expect(prompt).not.toContain('## Meals');
    expect(prompt).not.toContain('## Shopping list');
    expect(prompt).not.toContain('diet: vegetarian');
    expect(prompt).not.toContain('planMeal');
  });
});
