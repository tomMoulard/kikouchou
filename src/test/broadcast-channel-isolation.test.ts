/**
 * Pins that Dexie's change broadcasts stay inside one Vitest worker thread.
 *
 * Dexie posts every committed write on a `BroadcastChannel` named
 * `x-storagemutated-1`, so the tabs of one origin can refresh their live
 * queries. In Node that channel reaches every `worker_threads` worker of the
 * process, and Vitest runs four of them, each with its own fake IndexedDB but
 * the same database name. Another file clearing and writing `persons` then
 * re-ran a live query in this one: `reopen.test.ts` saw `['Alice']` 433
 * times in 5 seconds and failed in about half of the full coverage runs.
 *
 * @module test/broadcast-channel-isolation.test
 */
import Dexie from 'dexie';
import { Worker } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import type { Person, PersonId, TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

/** The channel Dexie 4 posts its change notifications on. */
const DEXIE_CHANNEL = 'x-storagemutated-1';

/**
 * Posts `parts` on Dexie's channel from a separate worker thread, the way
 * another Vitest worker's Dexie does, and resolves once that thread exited.
 */
function postFromAnotherThread(parts: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `const { BroadcastChannel, workerData } = require('node:worker_threads');
       const channel = new BroadcastChannel(workerData.name);
       channel.postMessage(workerData.parts);
       channel.close();`,
      { eval: true, workerData: { name: DEXIE_CHANNEL, parts } },
    );
    worker.once('error', reject);
    worker.once('exit', () => resolve());
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Dexie change broadcasts in the test suite', () => {
  it('keeps the writes of another worker thread out of this one', async () => {
    // The parts of a real write, so the message is what Dexie itself sends.
    let parts: unknown;
    const capture = (changed: unknown): void => {
      parts = changed;
    };
    Dexie.on('storagemutated', capture);
    await db.persons.add({
      id: 'person-broadcast' as PersonId,
      tripId: 'trip-broadcast' as TripId,
      name: 'Alice',
      color: '#ef4444' as Person['color'],
    });
    Dexie.on('storagemutated').unsubscribe(capture);
    expect(parts).toBeDefined();

    const received = vi.fn();
    Dexie.on('storagemutated', received);
    try {
      await postFromAnotherThread(parts);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(received).not.toHaveBeenCalled();
    } finally {
      Dexie.on('storagemutated').unsubscribe(received);
    }
  });
});
