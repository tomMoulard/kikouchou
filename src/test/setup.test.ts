/**
 * @fileoverview The one effect of `setup.ts` a test can actually observe.
 *
 * This file used to hold twelve assertions about Vitest and jsdom — that
 * `describe` is a function, that `new ResizeObserver()` has an `observe`
 * method, that the identity `t` mock returns its key. Every one of them
 * restated a literal written a few lines above it in `setup.ts`, and none could
 * fail while the file ran at all.
 *
 * What is genuinely worth pinning is the *cross-test* guarantee: `setup.ts`
 * empties every Dexie table before each test, so no test can see rows written
 * by the one before it. That has broken twice — the hook's table list used to
 * be hand-maintained, and it silently missed `yjsUpdates` and then `activities`
 * when the schema grew, leaking rows into whichever file ran next. It is now
 * derived from `db.tables`, and this file is what holds that derivation in
 * place.
 *
 * The two tests below are deliberately order-dependent: the first fills every
 * table, the second asserts the tables it finds are empty. Nothing runs between
 * them except `setup.ts`'s `beforeEach`, so the second passes only if that hook
 * really cleared all of them.
 *
 * @module test/setup.test
 */

import { describe, expect, it } from 'vitest';
import type { Table } from 'dexie';

import { db } from '@/lib/db/database';

// ============================================================================
// Helpers
// ============================================================================

/** Normalises Dexie's `string | string[] | null` key paths to a list. */
function keyPathSegments(keyPath: string | string[] | null | undefined): string[] {
  if (keyPath === null || keyPath === undefined) return [];
  return Array.isArray(keyPath) ? keyPath : [keyPath];
}

/**
 * Builds the smallest row Dexie will accept into `table`.
 *
 * Derived from the table's own schema rather than hand-written per table, for
 * the same reason the hook under test derives its list from `db.tables`: a
 * literal here would go stale the next time the schema grows, and this file
 * would then stop covering the very table most likely to leak.
 */
function probeRow(table: Table): Record<string, unknown> {
  const row: Record<string, unknown> = {},
    { primKey, indexes } = table.schema,
    fields = [
      // An auto-incrementing key ("++id") must be left for Dexie to assign.
      ...(primKey.auto
        ? []
        : keyPathSegments(primKey.keyPath).map((path) => ({ path, multi: false }))),
      ...indexes.flatMap((index) =>
        keyPathSegments(index.keyPath).map((path) => ({ path, multi: index.multi === true })),
      ),
    ];

  for (const { path, multi } of fields) {
    // No nested key path exists in this schema; skip rather than invent one.
    if (path.includes('.')) continue;
    row[path] = multi ? ['isolation-probe'] : 'isolation-probe';
  }

  return row;
}

/** Names of the tables that currently hold at least one row. */
async function populatedTables(): Promise<string[]> {
  const counts = await Promise.all(db.tables.map((table) => table.count()));

  return db.tables.filter((_, index) => (counts[index] ?? 0) > 0).map((table) => table.name);
}

// ============================================================================
// Tests
// ============================================================================

describe('setup.ts database isolation', () => {
  it('fills every table in the schema', async () => {
    // Guards the pair: were `db.tables` ever empty — an unopened database, a
    // schema that failed to apply — the emptiness assertion below would pass
    // for the wrong reason.
    expect(db.tables.length).toBeGreaterThanOrEqual(11);
    expect(db.tables.map((table) => table.name)).toContain('activities');

    await Promise.all(db.tables.map((table) => table.add(probeRow(table))));

    expect(await populatedTables()).toEqual(db.tables.map((table) => table.name));
  });

  it('hands the next test every one of those tables empty', async () => {
    // Only `setup.ts`'s beforeEach runs between this test and the one above.
    expect(await populatedTables()).toEqual([]);
  });
});
