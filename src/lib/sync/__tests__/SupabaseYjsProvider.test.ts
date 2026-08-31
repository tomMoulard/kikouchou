/**
 * SupabaseYjsProvider tests.
 *
 * Driven through a fake Supabase client that behaves like the real log: an
 * append-only table with monotonic ids, a snapshot row, and a Realtime channel
 * that can be made to deliver, drop or reorder. Faking at that seam is what lets
 * the awkward cases — a mid-pull failure, an out-of-order Realtime row, a lost
 * outbox — be tested at all.
 *
 * The properties being defended, in order of how much damage getting them wrong
 * would do:
 *
 * 1. Nothing is lost. A local edit reaches the server even if the queue row
 *    does not survive, because reconciliation diffs the document against the
 *    server's known state vector.
 * 2. The cursor never skips. It advances only on a completed pull, never on a
 *    Realtime payload.
 * 3. A remote update is never echoed back.
 *
 * @module lib/sync/__tests__/SupabaseYjsProvider.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { encodeUpdate } from '@/lib/sync/codec';
import { readCursor } from '@/lib/sync/cursors';
import * as outbox from '@/lib/sync/outbox';
import {
  ORIGIN_REMOTE,
  SupabaseYjsProvider,
} from '@/lib/sync/SupabaseYjsProvider';
import type { TripId } from '@/types';

// ============================================================================
// Fake server
// ============================================================================

interface FakeRow {
  id: number;
  update: string;
}

type RealtimeHandler = (payload: { new: Record<string, unknown> }) => void;

/**
 * Stands in for the log table, the snapshot table and the Realtime channel.
 *
 * Deliberately not a mock of `supabase-js` in general — only the four calls the
 * provider makes, so a change in shape shows up as a type error rather than a
 * silently passing test.
 */
class FakeServer {
  rows: FakeRow[] = [];
  snapshot: { state: string; through_id: number } | null = null;
  nextId = 1;

  /** Set to fail the next N writes, to exercise backoff and the queue. */
  failWrites = 0;
  /** Set to fail the next N reads. */
  failReads = 0;

  insertCalls = 0;
  readCalls = 0;
  channelStatus: string | null = null;

  private realtimeHandler: RealtimeHandler | null = null;
  private subscribeCallback: ((status: string) => void) | null = null;

  /** Appends the way the server does, assigning the next id. */
  append(update: Uint8Array): FakeRow {
    const row = { id: this.nextId, update: encodeUpdate(update) };
    this.nextId += 1;
    this.rows.push(row);
    return row;
  }

  /** Delivers a row over Realtime, as Postgres Changes would. */
  deliver(row: FakeRow): void {
    this.realtimeHandler?.({ new: { id: row.id, update: row.update } });
  }

  /** Reports the channel as (re)subscribed. */
  reportSubscribed(): void {
    this.subscribeCallback?.('SUBSCRIBED');
  }

  /**
   * The slice of `supabase-js` the provider actually uses.
   *
   * Arrow functions throughout so `this` stays the FakeServer without aliasing
   * it to a local.
   */
  get client() {
    return {
      from: (table: string) => {
        if (table === 'trip_doc_snapshots') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  if (this.failReads > 0) {
                    this.failReads -= 1;
                    return { data: null, error: { message: 'snapshot boom' } };
                  }
                  return { data: this.snapshot, error: null };
                },
              }),
            }),
          };
        }

        // trip_doc_updates
        return {
          select: () => ({
            eq: () => ({
              gt: (_column: string, afterId: number) => ({
                order: () => ({
                  limit: async (count: number) => {
                    this.readCalls += 1;
                    if (this.failReads > 0) {
                      this.failReads -= 1;
                      return { data: null, error: { message: 'read boom' } };
                    }
                    const page = this.rows
                      .filter((row) => row.id > afterId)
                      .sort((left, right) => left.id - right.id)
                      .slice(0, count);
                    return { data: page, error: null };
                  },
                }),
              }),
            }),
          }),
          insert: async (values: { update: string }) => {
            this.insertCalls += 1;
            if (this.failWrites > 0) {
              this.failWrites -= 1;
              return { error: { message: 'write boom' } };
            }
            this.rows.push({ id: this.nextId, update: values.update });
            this.nextId += 1;
            return { error: null };
          },
        };
      },

      channel: () => {
        const channel = {
          on: (_event: string, _filter: unknown, handler: RealtimeHandler) => {
            this.realtimeHandler = handler;
            return channel;
          },
          subscribe: (callback?: (status: string) => void) => {
            if (callback) {
              this.subscribeCallback = callback;
            }
            this.channelStatus = 'SUBSCRIBED';
            return channel;
          },
        };
        return channel;
      },

      removeChannel: async () => undefined,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

const TRIP_ID = 'trip-local-1' as TripId;
const REMOTE_TRIP_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function makeProvider(server: FakeServer, doc: Y.Doc): SupabaseYjsProvider {
  return new SupabaseYjsProvider({
    // The fake implements exactly the surface the provider uses.
    client: server.client as never,
    doc,
    tripId: TRIP_ID,
    remoteTripId: REMOTE_TRIP_ID,
  });
}

/** Adds a guest the way doc-model does, so updates look realistic. */
function addGuest(doc: Y.Doc, id: string, name: string): void {
  Y.transact(doc, () => {
    const row = new Y.Map<unknown>();
    doc.getMap('guestsById').set(id, row);
    row.set('name', name);
  });
}

function guestNames(doc: Y.Doc): string[] {
  return [...doc.getMap('guestsById').entries()]
    .map(([, row]) => String((row as Y.Map<unknown>).get('name')))
    .sort();
}

/**
 * Lets the provider's fire-and-forget work finish.
 *
 * Microtask ticks are not enough: `doc.on('update')` kicks off Dexie writes, and
 * IndexedDB (fake-indexeddb included) completes on real event-loop turns. This
 * yields macrotasks instead.
 */
async function settle(turns = 12): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

/**
 * Waits for a condition, polling on macrotasks.
 *
 * Preferred over a fixed number of turns wherever the test knows what it is
 * waiting for — it fails with the actual state rather than flaking under load.
 */
async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  attempts = 60,
): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 2);
    });
  }
  throw new Error(`timed out waiting for: ${label}`);
}

let providers: SupabaseYjsProvider[] = [];

function track(provider: SupabaseYjsProvider): SupabaseYjsProvider {
  providers.push(provider);
  return provider;
}

beforeEach(() => {
  providers = [];
});

afterEach(() => {
  for (const provider of providers) {
    provider.destroy();
  }
  vi.useRealTimers();
});

// ============================================================================
// First upload
// ============================================================================

describe('start — a trip that has never synced', () => {
  it('uploads the whole document', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    addGuest(doc, 'p2', 'Bob');

    const provider = track(makeProvider(server, doc));
    await provider.start();

    // One insert carrying everything, not one per edit: the diff against an
    // absent state vector is the whole document.
    expect(server.insertCalls).toBe(1);

    const rebuilt = new Y.Doc();
    for (const row of server.rows) {
      Y.applyUpdate(rebuilt, Uint8Array.from(atob(row.update), (c) => c.charCodeAt(0)));
    }
    expect(guestNames(rebuilt)).toEqual(['Alice', 'Bob']);
  });

  it('records the server state so the next start sends nothing', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');

    await track(makeProvider(server, doc)).start();
    const after = server.insertCalls;

    // A second provider over the same document and cursor.
    await track(makeProvider(server, doc)).start();

    expect(server.insertCalls).toBe(after);
    const cursor = await readCursor(TRIP_ID);
    expect(cursor.serverStateVector).toBeDefined();
  });

  it('appends nothing for an empty document', async () => {
    const server = new FakeServer();
    const provider = track(makeProvider(server, new Y.Doc()));

    await provider.start();

    // A trip with nothing in it must not append a row to the log to say so.
    expect(server.insertCalls).toBe(0);
    // The state vector is still recorded, which is what stops the next start
    // recomputing and re-sending the same nothing.
    expect((await readCursor(TRIP_ID)).serverStateVector).toBeDefined();
  });
});

// ============================================================================
// Hydration
// ============================================================================

describe('start — joining a trip that already exists', () => {
  it('applies the snapshot and the log after it', async () => {
    const server = new FakeServer();

    // The server holds a snapshot of Alice plus a later row adding Bob.
    const seed = new Y.Doc();
    addGuest(seed, 'p1', 'Alice');
    server.snapshot = { state: encodeUpdate(Y.encodeStateAsUpdate(seed)), through_id: 3 };
    server.nextId = 4;
    addGuest(seed, 'p2', 'Bob');
    server.rows.push({
      id: 4,
      update: encodeUpdate(Y.encodeStateAsUpdate(seed)),
    });
    server.nextId = 5;

    const doc = new Y.Doc();
    await track(makeProvider(server, doc)).start();

    expect(guestNames(doc)).toEqual(['Alice', 'Bob']);
    const cursor = await readCursor(TRIP_ID);
    expect(cursor.lastSeenUpdateId).toBe(4);
  });

  it('reconstructs from the log alone when the snapshot will not decode', async () => {
    const server = new FakeServer();
    const seed = new Y.Doc();
    addGuest(seed, 'p1', 'Alice');

    server.snapshot = { state: 'not valid base64!!', through_id: 1 };
    server.rows.push({ id: 1, update: encodeUpdate(Y.encodeStateAsUpdate(seed)) });
    server.nextId = 2;

    const doc = new Y.Doc();
    await track(makeProvider(server, doc)).start();

    // A snapshot is an optimisation; the log is the source of truth.
    expect(guestNames(doc)).toEqual(['Alice']);
  });

  it('pages through a log longer than one request', async () => {
    const server = new FakeServer();
    const seed = new Y.Doc();

    // 1200 rows forces three pages at PULL_PAGE_SIZE 500.
    for (let index = 0; index < 1200; index += 1) {
      addGuest(seed, `p${index}`, `Guest ${index}`);
      server.append(Y.encodeStateAsUpdate(seed));
    }

    const doc = new Y.Doc();
    await track(makeProvider(server, doc)).start();

    expect(doc.getMap('guestsById').size).toBe(1200);
    expect(await readCursor(TRIP_ID)).toMatchObject({ lastSeenUpdateId: 1200 });
  });

  it('skips a row that will not decode rather than failing the batch', async () => {
    const server = new FakeServer();
    const seed = new Y.Doc();
    addGuest(seed, 'p1', 'Alice');
    server.append(Y.encodeStateAsUpdate(seed));
    server.rows.push({ id: server.nextId, update: 'not valid base64!!' });
    server.nextId += 1;
    addGuest(seed, 'p2', 'Bob');
    server.append(Y.encodeStateAsUpdate(seed));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const doc = new Y.Doc();
    await track(makeProvider(server, doc)).start();

    expect(guestNames(doc)).toEqual(['Alice', 'Bob']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ============================================================================
// Local edits
// ============================================================================

describe('local edits', () => {
  it('pushes an edit made after start', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    await track(makeProvider(server, doc)).start();

    const before = server.insertCalls;
    addGuest(doc, 'p1', 'Alice');

    await waitUntil(() => server.insertCalls > before, 'the edit to be pushed');
    await waitUntil(
      async () => (await outbox.pendingCount(TRIP_ID)) === 0,
      'the queue to drain',
    );
  });

  it('never echoes a remote update back to the server', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    await track(makeProvider(server, doc)).start();
    const before = server.insertCalls;

    const remote = new Y.Doc();
    addGuest(remote, 'p9', 'Remote');
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), ORIGIN_REMOTE);
    await settle();

    // Echoing would loop the log: every peer would re-append what it received.
    expect(server.insertCalls).toBe(before);
  });

  it('keeps an edit queued while writes fail, and sends it on recovery', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();

    server.failWrites = 5;
    addGuest(doc, 'p1', 'Alice');

    // Nothing lost: it is still queued, and the state says so.
    await waitUntil(
      async () => (await outbox.pendingCount(TRIP_ID)) > 0,
      'the edit to be queued',
    );
    await waitUntil(
      () => provider.getState().status === 'offline',
      'the provider to report offline',
    );

    server.failWrites = 0;
    await provider.syncNow();
    await waitUntil(
      async () => (await outbox.pendingCount(TRIP_ID)) === 0,
      'the queue to drain after recovery',
    );
  });
});

// ============================================================================
// The property that makes the outbox non-critical
// ============================================================================

describe('reconciliation', () => {
  it('resends an edit whose queue row was lost', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const first = track(makeProvider(server, doc));
    await first.start();

    // An edit is made while writes fail, so it stays queued...
    server.failWrites = 99;
    addGuest(doc, 'p1', 'Alice');
    await settle();
    expect(await outbox.pendingCount(TRIP_ID)).toBeGreaterThan(0);

    // ...and then the queue is destroyed, simulating evicted storage or a tab
    // killed between persisting the edit and queueing it.
    await db.yjsOutbox.clear();
    first.destroy();

    server.failWrites = 0;
    await track(makeProvider(server, doc)).start();

    // The edit still reaches the server, because the diff is computed from the
    // document against the server's last known state vector — not from the queue.
    const rebuilt = new Y.Doc();
    for (const row of server.rows) {
      Y.applyUpdate(rebuilt, Uint8Array.from(atob(row.update), (c) => c.charCodeAt(0)));
    }
    expect(guestNames(rebuilt)).toContain('Alice');
  });

  it('does not record server state when the push failed', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');

    server.failWrites = 99;
    await track(makeProvider(server, doc)).start();

    // Recording it optimistically would mean these edits are never sent again.
    expect((await readCursor(TRIP_ID)).serverStateVector).toBeUndefined();
  });
});

// ============================================================================
// Realtime
// ============================================================================

describe('realtime', () => {
  it('applies a delivered row immediately', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    await track(makeProvider(server, doc)).start();

    const remote = new Y.Doc();
    addGuest(remote, 'p5', 'Carol');
    const row = server.append(Y.encodeStateAsUpdate(remote));
    server.deliver(row);
    await settle();

    expect(guestNames(doc)).toContain('Carol');
  });

  it('does not advance the cursor on a delivered row', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    await track(makeProvider(server, doc)).start();
    const before = (await readCursor(TRIP_ID)).lastSeenUpdateId;

    // Deliver row 7 while 5 and 6 exist but have not been read. If the cursor
    // followed the payload it would jump to 7 and skip them forever.
    const remote = new Y.Doc();
    addGuest(remote, 'p5', 'Five');
    server.append(Y.encodeStateAsUpdate(remote));
    addGuest(remote, 'p6', 'Six');
    server.append(Y.encodeStateAsUpdate(remote));
    addGuest(remote, 'p7', 'Seven');
    const seventh = server.append(Y.encodeStateAsUpdate(remote));

    server.deliver(seventh);
    await settle();

    expect((await readCursor(TRIP_ID)).lastSeenUpdateId).toBe(before);
  });

  it('recovers rows missed while the socket was down, on resubscribe', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();

    // Rows appear with no delivery at all — the socket was down.
    const remote = new Y.Doc();
    addGuest(remote, 'p1', 'Missed');
    server.append(Y.encodeStateAsUpdate(remote));

    expect(guestNames(doc)).not.toContain('Missed');

    // Resubscribing triggers the reconciling pull.
    server.reportSubscribed();
    await provider.syncNow();

    expect(guestNames(doc)).toContain('Missed');
  });

  it('tolerates an undecodable realtime payload', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await track(makeProvider(server, doc)).start();

    server.deliver({ id: 99, update: 'not valid base64!!' });
    await settle();

    // Still alive and still syncing.
    expect(guestNames(doc)).toEqual([]);
    warn.mockRestore();
  });
});

// ============================================================================
// Failures
// ============================================================================

describe('failure handling', () => {
  it('reports offline on a read failure without throwing', async () => {
    const server = new FakeServer();
    server.failReads = 99;
    const provider = track(makeProvider(server, new Y.Doc()));

    // Unable to reach the server is an expected state, not an error: start()
    // must resolve so the app carries on working locally.
    await expect(provider.start()).resolves.toBeUndefined();

    // And a push that happens to succeed must not paper over the failed pull —
    // the document would look up to date while missing everything remote.
    expect(provider.getState().status).toBe('offline');
  });

  it('stops flushing at the first failure to keep the queue ordered', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();

    server.failWrites = 99;
    for (let index = 0; index < 5; index += 1) {
      addGuest(doc, `p${index}`, `Guest ${index}`);
    }
    await settle();

    server.failWrites = 1;
    const before = server.insertCalls;
    await provider.syncNow();
    await settle();

    // One attempt, then stop — not five attempts against a refusing server.
    expect(server.insertCalls).toBe(before + 1);
  });

  it('detaches everything on destroy', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();

    provider.destroy();
    const before = server.insertCalls;
    addGuest(doc, 'p1', 'After destroy');
    await settle();

    expect(server.insertCalls).toBe(before);
  });

  it('survives destroy being called twice', async () => {
    const provider = track(makeProvider(new FakeServer(), new Y.Doc()));
    await provider.start();

    provider.destroy();
    expect(() => provider.destroy()).not.toThrow();
  });
});

// ============================================================================
// Two devices
// ============================================================================

describe('two devices through one server', () => {
  it('converges, with each edit reaching the other', async () => {
    const server = new FakeServer();

    const hostDoc = new Y.Doc();
    const host = track(
      new SupabaseYjsProvider({
        client: server.client as never,
        doc: hostDoc,
        tripId: TRIP_ID,
        remoteTripId: REMOTE_TRIP_ID,
      }),
    );
    addGuest(hostDoc, 'p1', 'Alice');
    await host.start();

    // A second device with its own cursor.
    const guestDoc = new Y.Doc();
    const guest = track(
      new SupabaseYjsProvider({
        client: server.client as never,
        doc: guestDoc,
        tripId: 'trip-local-2' as TripId,
        remoteTripId: REMOTE_TRIP_ID,
      }),
    );
    await guest.start();

    expect(guestNames(guestDoc)).toEqual(['Alice']);

    // Each edits without seeing the other, then both sync.
    addGuest(hostDoc, 'p2', 'Bob');
    addGuest(guestDoc, 'p3', 'Carol');
    await settle();
    await host.syncNow();
    await guest.syncNow();
    await host.syncNow();
    await settle();

    expect(guestNames(hostDoc)).toEqual(['Alice', 'Bob', 'Carol']);
    expect(guestNames(guestDoc)).toEqual(['Alice', 'Bob', 'Carol']);
  });
});
