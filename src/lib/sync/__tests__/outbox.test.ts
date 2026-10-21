/**
 * Outbox tests.
 *
 * The queue is per trip, ordered, and bounded. Those three properties are what
 * the provider's flush relies on, so each one is pinned here against the real
 * Dexie table rather than through the provider.
 *
 * @module lib/sync/__tests__/outbox.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import {
  acknowledge,
  clear,
  enqueue,
  pending,
  pendingCount,
} from '@/lib/sync/outbox';
import type { TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP = 'trip-outbox' as TripId;
const OTHER_TRIP = 'trip-other' as TripId;

/** The cap `outbox.ts` keeps per trip. */
const MAX_ROWS_PER_TRIP = 2000;

/** Fills a trip's queue directly, much faster than one `enqueue` per row. */
async function seedRows(tripId: TripId, count: number): Promise<void> {
  await db.yjsOutbox.bulkAdd(
    Array.from({ length: count }, (_, index) => ({
      tripId,
      update: new Uint8Array([index % 256]),
      queuedAt: index,
    })),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// enqueue
// ============================================================================

describe('enqueue', () => {
  it('stores the update for its trip with the time it was queued', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(1_700_000_000_000));

    await enqueue(TRIP, new Uint8Array([1, 2, 3]));

    const rows = await pending(TRIP);
    expect(rows).toHaveLength(1);
    expect(Array.from(rows[0]!.update)).toEqual([1, 2, 3]);
    expect(rows[0]!.queuedAt).toBe(1_700_000_000_000);
    expect(await pendingCount(TRIP)).toBe(1);
  });

  it('keeps every row and warns nothing below the cap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await enqueue(TRIP, new Uint8Array([1]));
    await enqueue(TRIP, new Uint8Array([2]));

    expect(await pendingCount(TRIP)).toBe(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps every row when the queue lands exactly on the cap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedRows(TRIP, MAX_ROWS_PER_TRIP - 1);

    await enqueue(TRIP, new Uint8Array([7]));

    expect(await pendingCount(TRIP)).toBe(MAX_ROWS_PER_TRIP);
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops the oldest rows, and only those, past the cap', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedRows(TRIP, MAX_ROWS_PER_TRIP);
    await seedRows(OTHER_TRIP, 3);
    const oldestId = (await pending(TRIP))[0]!.id;

    await enqueue(TRIP, new Uint8Array([9]));

    const rows = await pending(TRIP);
    expect(rows).toHaveLength(MAX_ROWS_PER_TRIP);
    // The first seeded row went, the newest one stayed.
    expect(rows.some((row) => row.id === oldestId)).toBe(false);
    expect(Array.from(rows.at(-1)!.update)).toEqual([9]);
    // Another trip's queue is not part of this trip's count.
    expect(await pendingCount(OTHER_TRIP)).toBe(3);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('exceeded'),
      TRIP,
      MAX_ROWS_PER_TRIP,
      1,
    );
  });

  it('does not trim a trip whose own queue is short when another trip is full', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedRows(OTHER_TRIP, MAX_ROWS_PER_TRIP);

    await enqueue(TRIP, new Uint8Array([1]));

    expect(await pendingCount(TRIP)).toBe(1);
    expect(await pendingCount(OTHER_TRIP)).toBe(MAX_ROWS_PER_TRIP);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ============================================================================
// acknowledge
// ============================================================================

describe('acknowledge', () => {
  it('removes exactly the acknowledged rows', async () => {
    await enqueue(TRIP, new Uint8Array([1]));
    await enqueue(TRIP, new Uint8Array([2]));
    await enqueue(TRIP, new Uint8Array([3]));
    const [first, second, third] = await pending(TRIP);

    await acknowledge([first!.id!, third!.id!]);

    const left = await pending(TRIP);
    expect(left.map((row) => row.id)).toEqual([second!.id]);
  });

  it('does not touch the table for an empty list', async () => {
    const bulkDelete = vi.spyOn(db.yjsOutbox, 'bulkDelete');

    await acknowledge([]);

    expect(bulkDelete).not.toHaveBeenCalled();
  });
});

// ============================================================================
// pending
// ============================================================================

describe('pending', () => {
  it('returns the rows of one trip, oldest first, whatever order the ids were written in', async () => {
    await db.yjsOutbox.add({ id: 30, tripId: TRIP, update: new Uint8Array([3]), queuedAt: 3 });
    await db.yjsOutbox.add({ id: 10, tripId: TRIP, update: new Uint8Array([1]), queuedAt: 1 });
    await db.yjsOutbox.add({ id: 20, tripId: TRIP, update: new Uint8Array([2]), queuedAt: 2 });
    await db.yjsOutbox.add({ id: 15, tripId: OTHER_TRIP, update: new Uint8Array([9]), queuedAt: 9 });

    const rows = await pending(TRIP);

    expect(rows.map((row) => row.id)).toEqual([10, 20, 30]);
  });

  it('is empty for a trip with nothing queued', async () => {
    expect(await pending(TRIP)).toEqual([]);
    expect(await pendingCount(TRIP)).toBe(0);
  });
});

// ============================================================================
// clear
// ============================================================================

describe('clear', () => {
  it("discards one trip's queue and leaves the others", async () => {
    await enqueue(TRIP, new Uint8Array([1]));
    await enqueue(TRIP, new Uint8Array([2]));
    await enqueue(OTHER_TRIP, new Uint8Array([3]));

    await clear(TRIP);

    expect(await pendingCount(TRIP)).toBe(0);
    expect(await pendingCount(OTHER_TRIP)).toBe(1);
  });
});
