/**
 * @fileoverview Pins how Dexie treats a `Uint8Array` column.
 *
 * Every persisted Yjs update is raw CRDT bytes in a `Uint8Array`. Two of the
 * write paths preserve that and one silently does not, which is a distinction
 * the type system cannot express: `Collection.modify` hands the mutator a clone
 * and stores the result, and the round trip loses the typed array — the value
 * comes back as a plain `{0: 1, 1: 2, …}` object. Nothing throws. The rows are
 * all still there. `Y.applyUpdate` simply can no longer read any of them, so a
 * device's entire local history is gone.
 *
 * This was a real bug in the schema 8 migration, found only because the
 * migration got a test. The behaviour is pinned here so a future migration
 * reaching for the obvious `modify` fails a test instead of destroying data.
 *
 * Asserted behaviourally rather than with `instanceof`: under `fake-indexeddb`
 * the restored array comes from another realm, so `instanceof Uint8Array` is
 * false for a perfectly good typed array. What Yjs actually requires is a
 * `byteLength` and indexable bytes, so that is what is checked.
 *
 * @module lib/db/__tests__/dexie-binary-rows.test
 */

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

const DB_NAME = 'kikouchou-binary-row-probe';

interface Row {
  id?: number;
  key?: string;
  update: Uint8Array;
}

/** Opens a one-table database shaped like `yjsUpdates`. */
async function open(): Promise<Dexie> {
  const db = new Dexie(DB_NAME);
  db.version(1).stores({ rows: '++id, key' });
  await db.open();
  return db;
}

/** Reads the single row, failing the test rather than returning undefined. */
async function readOne(db: Dexie): Promise<Row> {
  const rows = await db.table<Row>('rows').toArray();
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (row === undefined) {
    throw new Error('unreachable: length was just asserted');
  }
  return row;
}

/** True when Yjs could read this value as an update. */
function isReadableByYjs(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { byteLength?: unknown }).byteLength === 'number' &&
    (value as { byteLength: number }).byteLength > 0
  );
}

afterEach(async () => {
  await Dexie.delete(DB_NAME);
});

describe('Dexie and Uint8Array columns', () => {
  it('preserves the bytes through add and read', async () => {
    const db = await open();
    await db.table<Row>('rows').add({ key: 'a', update: new Uint8Array([1, 2, 3]) });

    const row = await readOne(db);
    expect(isReadableByYjs(row.update)).toBe(true);
    expect(Array.from(row.update)).toEqual([1, 2, 3]);
    db.close();
  });

  it('preserves the bytes through bulkAdd, which is what the migration uses', async () => {
    const db = await open();
    await db.table<Row>('rows').bulkAdd([
      { key: 'a', update: new Uint8Array([1, 2, 3]) },
      { key: 'b', update: new Uint8Array([4, 5, 6]) },
    ]);

    const rows = await db.table<Row>('rows').toArray();
    expect(rows.every((row) => isReadableByYjs(row.update))).toBe(true);
    expect(rows.map((row) => Array.from(row.update))).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    db.close();
  });

  it('LOSES the typed array through Collection.modify', async () => {
    const db = await open();
    await db.table<Row>('rows').add({ key: 'a', update: new Uint8Array([1, 2, 3]) });

    await db
      .table('rows')
      .toCollection()
      .modify((row: Record<string, unknown>) => {
        // Touching an unrelated property is enough; the clone is the damage.
        row.key = 'b';
      });

    const row = await readOne(db);

    // The trap, asserted so it cannot quietly change meaning: the row survives,
    // the property is present, and the bytes are unreachable.
    expect(isReadableByYjs(row.update)).toBe(false);
    expect(Array.from(row.update)).toEqual([]);
    expect({ ...row.update }).toEqual({ 0: 1, 1: 2, 2: 3 });

    db.close();
  });
});
