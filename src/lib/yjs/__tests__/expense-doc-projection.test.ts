/**
 * Money lines crossing the trust boundary.
 *
 * A line from a peer ends up in arithmetic the whole money page rests on: the
 * amount is multiplied by a share and summed into every balance. These pin what
 * the projection has to do with a line no local form ever checked.
 *
 * @module lib/yjs/__tests__/expense-doc-projection.test
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { computeBalances } from '@/features/money/lib/balances';
import { syncDocToDexie } from '@/lib/yjs/dexie-bridge';
import { DOC_SCHEMA_VERSION, upsertDocEntity } from '@/lib/yjs/doc-model';
import { isoDate } from '@/test/utils';
import { MAX_EXPENSE_AMOUNT, MAX_EXPENSE_SPLITS } from '@/types';
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

/**
 * Puts one money line into the document as a peer would, and projects it.
 */
async function project(
  tripId: TripId,
  expense: Record<string, unknown>,
): Promise<void> {
  const doc = makeDoc();
  upsertDocEntity(doc, 'expenses', { id: 'e1', ...expense });
  await syncDocToDexie(doc, tripId);
}

const VALID = {
  kind: 'expense',
  category: 'groceries',
  title: 'Courses',
  date: '2026-08-02',
  amount: 84.2,
  payerId: 'p1',
  splitMode: 'equal',
  splits: [{ personId: 'p1', value: 1 }],
};

// ============================================================================
// Tests
// ============================================================================

describe('expenses crossing the trust boundary', () => {
  it('projects an ordinary line unchanged', async () => {
    const tripId = await makeTrip();

    await project(tripId, VALID);

    const stored = await db.expenses.get('e1');
    expect(stored?.tripId).toBe(tripId);
    expect(stored?.amount).toBe(84.2);
    expect(stored?.splits).toEqual([{ personId: 'p1', value: 1 }]);
  });

  it('drops a line with no day, which no trip query could ever reach', async () => {
    const tripId = await makeTrip();

    await project(tripId, { ...VALID, date: 42 });

    expect(await db.expenses.get('e1')).toBeUndefined();
  });

  it('drops a line with no payer, which no balance could ever name', async () => {
    const tripId = await makeTrip();

    await project(tripId, { ...VALID, payerId: '' });

    expect(await db.expenses.get('e1')).toBeUndefined();
  });

  it('bounds an amount a peer never bounded', async () => {
    const tripId = await makeTrip();

    await project(tripId, { ...VALID, amount: 1e308 });

    expect((await db.expenses.get('e1'))?.amount).toBe(MAX_EXPENSE_AMOUNT);
  });

  it('reads an amount that is not a number as zero', async () => {
    const tripId = await makeTrip();

    await project(tripId, { ...VALID, amount: 'a lot' });

    expect((await db.expenses.get('e1'))?.amount).toBe(0);
  });

  it('keeps a hostile amount out of every balance', async () => {
    const tripId = await makeTrip();

    await project(tripId, { ...VALID, amount: Number.POSITIVE_INFINITY });

    const balances = computeBalances(await db.expenses.toArray());
    for (const row of balances) {
      expect(Number.isFinite(row.balance)).toBe(true);
    }
  });

  it('bounds a title a peer never bounded', async () => {
    const tripId = await makeTrip();

    await project(tripId, { ...VALID, title: 'x'.repeat(5000) });

    expect((await db.expenses.get('e1'))?.title).toHaveLength(MAX_LENGTHS.expenseTitle);
  });

  it('bounds a description a peer never bounded', async () => {
    const tripId = await makeTrip();

    await project(tripId, { ...VALID, description: 'x'.repeat(50000) });

    expect((await db.expenses.get('e1'))?.description).toHaveLength(
      MAX_LENGTHS.expenseDescription,
    );
  });

  it('falls back rather than storing a kind, category or rule it does not know', async () => {
    const tripId = await makeTrip();

    await project(tripId, {
      ...VALID,
      kind: 'refund',
      category: 'yacht',
      splitMode: 'by-horoscope',
    });

    const stored = await db.expenses.get('e1');
    expect(stored?.kind).toBe('expense');
    expect(stored?.category).toBe('other');
    expect(stored?.splitMode).toBe('equal');
  });

  it('bounds the share list and each share value', async () => {
    const tripId = await makeTrip();

    await project(tripId, {
      ...VALID,
      splitMode: 'shares',
      splits: Array.from({ length: MAX_EXPENSE_SPLITS + 50 }, (_, index) => ({
        personId: `p${index}`,
        value: 1e308,
      })),
    });

    const stored = await db.expenses.get('e1');
    expect(stored?.splits).toHaveLength(MAX_EXPENSE_SPLITS);
    for (const split of stored?.splits ?? []) {
      expect(Number.isFinite(split.value)).toBe(true);
    }
  });

  it('drops a share with no guest rather than the whole line', async () => {
    const tripId = await makeTrip();

    await project(tripId, {
      ...VALID,
      splits: [{ personId: 'p1', value: 1 }, { value: 3 }, { personId: 7, value: 1 }],
    });

    expect((await db.expenses.get('e1'))?.splits).toEqual([
      { personId: 'p1', value: 1 },
    ]);
  });

  it('reads a splits field that is not a list as no shares at all', async () => {
    const tripId = await makeTrip();

    await project(tripId, { ...VALID, splits: 'everyone' });

    expect((await db.expenses.get('e1'))?.splits).toEqual([]);
  });

  it('takes the currency from the document, normalised', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    doc.getMap('meta').set('currency', 'usd');

    await syncDocToDexie(doc, tripId);

    expect((await db.trips.get(tripId))?.currency).toBe('USD');
  });

  it('refuses a currency no formatter could read', async () => {
    // `Intl.NumberFormat` throws on a malformed code, so adopting one from a
    // peer would blank the money page rather than mislabel it.
    const tripId = await makeTrip();
    const doc = makeDoc();
    doc.getMap('meta').set('currency', '€€€');

    await syncDocToDexie(doc, tripId);

    expect((await db.trips.get(tripId))?.currency).toBe('EUR');
  });

  it('leaves a trip that never chose a currency without one', async () => {
    const tripId = await makeTrip();

    await syncDocToDexie(makeDoc(), tripId);

    expect((await db.trips.get(tripId))?.currency).toBeUndefined();
  });

  it('writes only to the trip the caller named, whatever the line says', async () => {
    const mine = await makeTrip();
    const theirs = await makeTrip();

    await project(mine, { ...VALID, tripId: theirs });

    expect((await db.expenses.get('e1'))?.tripId).toBe(mine);
    expect(await db.expenses.where('tripId').equals(theirs).count()).toBe(0);
  });
});
