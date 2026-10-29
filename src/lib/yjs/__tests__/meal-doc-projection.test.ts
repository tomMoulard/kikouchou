/**
 * Meals, shopping lines and guest diets crossing the trust boundary.
 *
 * A meal's day is a key every meal read uses, its correction is added to a
 * count of people, and a diet tag is counted on every meal card. These pin
 * what the projection does with a value no local form ever checked, and that
 * a row written here travels to the document and back unchanged.
 *
 * @module lib/yjs/__tests__/meal-doc-projection.test
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { createMeal } from '@/lib/db/repositories/meal-repository';
import { createShoppingItem } from '@/lib/db/repositories/shopping-item-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { MAX_LENGTHS } from '@/lib/db/sanitize';
import {
  populateDocFromDexie,
  syncDexieToDoc,
  syncDocToDexie,
} from '@/lib/yjs/dexie-bridge';
import {
  DOC_SCHEMA_VERSION,
  readDocCollection,
  upsertDocEntity,
} from '@/lib/yjs/doc-model';
import { isoDate } from '@/test/utils';
import { MAX_MEAL_HEADCOUNT_ADJUSTMENT, MAX_MEAL_ORGANIZERS } from '@/types';
import type { TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('schema', DOC_SCHEMA_VERSION);
  return doc;
}

async function makeTrip(): Promise<TripId> {
  const trip = await createTrip({
    name: 'Shared trip',
    startDate: isoDate('2026-08-01'),
    endDate: isoDate('2026-08-05'),
  });
  return trip.id;
}

const MEAL = {
  date: '2026-08-02',
  slot: 'dinner',
  kind: 'home',
  organizerIds: ['p1'],
  menu: 'Lasagne',
};

async function projectMeal(tripId: TripId, meal: Record<string, unknown>): Promise<void> {
  const doc = makeDoc();
  upsertDocEntity(doc, 'meals', { id: 'm1', ...meal });
  await syncDocToDexie(doc, tripId);
}

async function projectItem(tripId: TripId, item: Record<string, unknown>): Promise<void> {
  const doc = makeDoc();
  upsertDocEntity(doc, 'shoppingItems', { id: 'i1', ...item });
  await syncDocToDexie(doc, tripId);
}

// ============================================================================
// Meals
// ============================================================================

describe('meals crossing the trust boundary', () => {
  it('projects an ordinary meal unchanged', async () => {
    const tripId = await makeTrip();

    await projectMeal(tripId, { ...MEAL, headcountAdjustment: 2 });

    expect(await db.meals.get('m1')).toEqual({
      id: 'm1',
      tripId,
      ...MEAL,
      headcountAdjustment: 2,
    });
  });

  it('drops a meal with no calendar day, which no meal read could reach', async () => {
    const tripId = await makeTrip();

    await projectMeal(tripId, { ...MEAL, date: 42 });

    expect(await db.meals.get('m1')).toBeUndefined();
  });

  it('drops a meal whose slot this build has no row for', async () => {
    const tripId = await makeTrip();

    await projectMeal(tripId, { ...MEAL, slot: 'brunch' });

    expect(await db.meals.get('m1')).toBeUndefined();
  });

  it('reads an unknown kind as a meal cooked at home', async () => {
    const tripId = await makeTrip();

    await projectMeal(tripId, { ...MEAL, kind: 'potluck' });

    expect((await db.meals.get('m1'))?.kind).toBe('home');
  });

  it('bounds the correction, the menu and the organisers', async () => {
    const tripId = await makeTrip();

    await projectMeal(tripId, {
      ...MEAL,
      headcountAdjustment: 1e9,
      menu: 'x'.repeat(5_000),
      organizerIds: [...Array.from({ length: 50 }, (_, index) => `p${index}`), 42, ''],
    });

    const stored = await db.meals.get('m1');
    expect(stored?.headcountAdjustment).toBe(MAX_MEAL_HEADCOUNT_ADJUSTMENT);
    expect(stored?.menu).toHaveLength(MAX_LENGTHS.mealMenu);
    expect(stored?.organizerIds).toHaveLength(MAX_MEAL_ORGANIZERS);
  });

  it('stores no key for a missing or zero correction', async () => {
    const tripId = await makeTrip();

    await projectMeal(tripId, { ...MEAL, headcountAdjustment: 'many', menu: 7 });

    const stored = await db.meals.get('m1');
    expect(stored).not.toHaveProperty('headcountAdjustment');
    expect(stored).not.toHaveProperty('menu');
  });
});

// ============================================================================
// Shopping items
// ============================================================================

describe('shopping lines crossing the trust boundary', () => {
  it('projects an ordinary line unchanged', async () => {
    const tripId = await makeTrip();
    const item = { name: 'Bread', quantity: '4', buyerId: 'p1', checked: true, createdAt: 10 };

    await projectItem(tripId, item);

    expect(await db.shoppingItems.get('i1')).toEqual({ id: 'i1', tripId, ...item });
  });

  it('drops a line with no name', async () => {
    const tripId = await makeTrip();

    await projectItem(tripId, { name: '   ', checked: false, createdAt: 1 });

    expect(await db.shoppingItems.get('i1')).toBeUndefined();
  });

  it('coerces what it can and drops what it cannot', async () => {
    const tripId = await makeTrip();

    await projectItem(tripId, {
      name: 'y'.repeat(500),
      quantity: 12,
      buyerId: 3,
      checked: 'yes',
      createdAt: 'yesterday',
    });

    const stored = await db.shoppingItems.get('i1');
    expect(stored?.name).toHaveLength(MAX_LENGTHS.shoppingItemName);
    expect(stored).not.toHaveProperty('quantity');
    expect(stored).not.toHaveProperty('buyerId');
    expect(stored?.checked).toBe(false);
    expect(stored?.createdAt).toBe(0);
  });
});

// ============================================================================
// Guest diet
// ============================================================================

describe('guest diet crossing the trust boundary', () => {
  it('keeps the known tags and bounds the note', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    upsertDocEntity(doc, 'guests', {
      id: 'p1',
      name: 'Nora',
      color: '#22c55e',
      dietaryTags: ['vegetarian', 'paleo', 7],
      dietaryNote: 'z'.repeat(1_000),
    });

    await syncDocToDexie(doc, tripId);

    const stored = await db.persons.get('p1');
    expect(stored?.dietaryTags).toEqual(['vegetarian']);
    expect(stored?.dietaryNote).toHaveLength(MAX_LENGTHS.personDietaryNote);
  });

  it('stores nothing when no tag survives', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    upsertDocEntity(doc, 'guests', {
      id: 'p1',
      name: 'Nora',
      color: '#22c55e',
      dietaryTags: ['paleo'],
    });

    await syncDocToDexie(doc, tripId);

    expect(await db.persons.get('p1')).not.toHaveProperty('dietaryTags');
  });
});

// ============================================================================
// Round trip
// ============================================================================

describe('the meal planner travels through the document', () => {
  it('seeds a new document with the meals and lines Dexie holds', async () => {
    const tripId = await makeTrip();
    const meal = await createMeal(tripId, {
      date: isoDate('2026-08-02'),
      slot: 'lunch',
      kind: 'picnic',
      organizerIds: [],
    });
    const item = await createShoppingItem(tripId, { name: 'Bread', checked: false });
    const doc = makeDoc();

    await populateDocFromDexie(doc, tripId);

    expect(readDocCollection(doc, 'meals').map((row) => row.id)).toEqual([meal.id]);
    expect(readDocCollection(doc, 'shoppingItems').map((row) => row.id)).toEqual([item.id]);
  });

  it('publishes a meal and projects it back unchanged on another device', async () => {
    const tripId = await makeTrip();
    const meal = await createMeal(tripId, {
      date: isoDate('2026-08-03'),
      slot: 'dinner',
      kind: 'restaurant',
      organizerIds: [],
      menu: 'La Bastide',
    });
    const doc = makeDoc();
    syncDexieToDoc(doc, 'meals', [{ ...meal, tripId: undefined }], { allowDeletions: false });
    await db.meals.clear();

    await syncDocToDexie(doc, tripId);

    expect(await db.meals.get(meal.id)).toEqual(meal);
  });
});
