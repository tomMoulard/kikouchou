/**
 * Cursor tests.
 *
 * The two values a cursor holds move under different rules: the read position
 * only goes forward, and the server state vector is written only when told.
 * Both rules are pinned here against the real Dexie table.
 *
 * @module lib/sync/__tests__/cursors.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import { advanceCursor, readCursor, recordServerState } from '@/lib/sync/cursors';
import type { TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP = 'trip-cursor' as TripId;
const START = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(START));
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// readCursor
// ============================================================================

describe('readCursor', () => {
  it('defaults to nothing read and nothing pushed', async () => {
    expect(await readCursor(TRIP)).toEqual({ lastSeenUpdateId: 0 });
  });

  it('returns a stored row with its vector and time', async () => {
    await db.syncCursors.put({
      tripId: TRIP,
      lastSeenUpdateId: 12,
      serverStateVector: new Uint8Array([1, 2]),
      syncedAt: 99,
    });

    const cursor = await readCursor(TRIP);

    expect(cursor.lastSeenUpdateId).toBe(12);
    expect(Array.from(cursor.serverStateVector!)).toEqual([1, 2]);
    expect(cursor.syncedAt).toBe(99);
  });

  it.each([
    ['a negative id', -5],
    ['zero', 0],
    ['a string', '40'],
  ])('reads %s as the start of the log', async (_label, value) => {
    await db.syncCursors.put({
      tripId: TRIP,
      lastSeenUpdateId: value as number,
    });

    expect(await readCursor(TRIP)).toEqual({ lastSeenUpdateId: 0 });
  });
});

// ============================================================================
// advanceCursor
// ============================================================================

describe('advanceCursor', () => {
  it('writes the first position with the current time', async () => {
    await advanceCursor(TRIP, 5);

    expect(await readCursor(TRIP)).toEqual({ lastSeenUpdateId: 5, syncedAt: START });
  });

  it('moves forward and keeps the recorded server vector', async () => {
    await recordServerState(TRIP, new Uint8Array([4, 4]));
    await advanceCursor(TRIP, 5);
    vi.setSystemTime(new Date(START + 1000));

    await advanceCursor(TRIP, 9);

    const cursor = await readCursor(TRIP);
    expect(cursor.lastSeenUpdateId).toBe(9);
    expect(cursor.syncedAt).toBe(START + 1000);
    expect(Array.from(cursor.serverStateVector!)).toEqual([4, 4]);
  });

  it('ignores a lower id rather than walking backwards', async () => {
    await advanceCursor(TRIP, 9);

    await advanceCursor(TRIP, 4);

    expect((await readCursor(TRIP)).lastSeenUpdateId).toBe(9);
  });

  it('leaves the row alone when the same id comes again', async () => {
    await advanceCursor(TRIP, 9);
    vi.setSystemTime(new Date(START + 5000));

    await advanceCursor(TRIP, 9);

    expect(await readCursor(TRIP)).toEqual({ lastSeenUpdateId: 9, syncedAt: START });
  });
});

// ============================================================================
// recordServerState
// ============================================================================

describe('recordServerState', () => {
  it('stores the vector and starts the read position at zero', async () => {
    await recordServerState(TRIP, new Uint8Array([7]));

    const cursor = await readCursor(TRIP);
    expect(cursor.lastSeenUpdateId).toBe(0);
    expect(Array.from(cursor.serverStateVector!)).toEqual([7]);
    expect(cursor.syncedAt).toBe(START);
  });

  it('keeps the read position it found', async () => {
    await advanceCursor(TRIP, 33);

    await recordServerState(TRIP, new Uint8Array([8]));

    const cursor = await readCursor(TRIP);
    expect(cursor.lastSeenUpdateId).toBe(33);
    expect(Array.from(cursor.serverStateVector!)).toEqual([8]);
  });
});
