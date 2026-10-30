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
import { advanceCursor, readCursor } from '@/lib/sync/cursors';
import * as outbox from '@/lib/sync/outbox';
import {
  ORIGIN_REMOTE,
  SupabaseYjsProvider,
  type SyncState,
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
  /** Lowest surviving log id, as compaction's pruning would leave it. */
  prunedBelow = 0;

  private writeGate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;

  insertCalls = 0;
  readCalls = 0;
  /** Snapshot publishes, as `publish_trip_snapshot` would receive them. */
  snapshotPublishes: { trip_id: string; state: string; through_id: number }[] = [];
  /** Set to fail the next N publishes. */
  failPublishes = 0;
  snapshotMarkerReads = 0;
  snapshotStateReads = 0;
  channelStatus: string | null = null;

  /** Every read and write, described with its table, columns and filters. */
  queries: string[] = [];
  /** Set to fail the next N log page reads only. */
  failLogReads = 0;
  /** Set to fail the next N snapshot state reads only (not the marker). */
  failStateReads = 0;
  /** The snapshot row vanishes between the marker read and the state read. */
  stateReadReturnsNull = false;
  /** Replaces what the state read says the snapshot folds through. */
  stateThroughIdOverride: unknown = undefined;
  /** Replaces the answer of the floor query, which asks for the oldest row. */
  floorOverride: { data: unknown; error: unknown } | null = null;
  /** Hides every row from reads, while inserts still land. */
  hideRows = false;
  /** Called on each log page read, before it answers. */
  onLogRead: (() => void) | null = null;
  /** Set to make the next N publishes throw rather than answer. */
  throwPublishes = 0;
  rpcCalls = 0;
  /** Channels opened, with their name and the arguments given. */
  channelCalls: { name: string; args: unknown[] }[] = [];
  /** `channel.on` registrations, as event and filter. */
  onCalls: { event: string; filter: unknown }[] = [];
  trackPayloads: unknown[] = [];
  removeChannelCalls = 0;
  /** Makes `presenceState()` throw. */
  presenceThrows = false;
  /** When false, `subscribe` reports nothing until the test says so. */
  autoSubscribe = true;
  /** Fails exactly the write with this number, counting every insert from 1. */
  failNthWrite: number | null = null;
  /** Holds log page reads open while set. */
  readGate: Promise<void> | null = null;

  private realtimeHandler: RealtimeHandler | null = null;
  private presenceHandler: (() => void) | null = null;
  private subscribeCallback: ((status: string) => void) | null = null;
  /** Presence keys currently on the channel, as Realtime would hold them. */
  private presence = new Map<string, unknown>();
  private presenceKey: string | null = null;

  /**
   * Holds every write open until the returned function is called.
   *
   * Widens a window that is real but narrow in production: the document emits
   * synchronously while the queue row is written asynchronously, so a flush can
   * be in flight at the moment an edit exists in the document and nowhere else.
   */
  gateWrites(): () => void {
    this.writeGate = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
    });
    return () => {
      this.writeGate = null;
      this.releaseGate?.();
      this.releaseGate = null;
    };
  }

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

  /** Delivers any payload at all, as a misbehaving channel might. */
  deliverRaw(payload: unknown): void {
    this.realtimeHandler?.(payload as { new: Record<string, unknown> });
  }

  /** Reports the channel as (re)subscribed. */
  reportSubscribed(): void {
    this.subscribeCallback?.('SUBSCRIBED');
  }

  /** Reports the channel as gone, the way a dropped socket does. */
  reportChannelStatus(status: string): void {
    this.subscribeCallback?.(status);
  }

  /** The presence key this provider joined under, if any. */
  get joinedPresenceKey(): string | null {
    return this.presenceKey;
  }

  /** Another device joins, as Realtime would report. */
  addPresence(key: string): void {
    this.presence.set(key, { joinedAt: Date.now() });
    this.presenceHandler?.();
  }

  /** Another device leaves. */
  removePresence(key: string): void {
    this.presence.delete(key);
    this.presenceHandler?.();
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
            // The provider reads `through_id` alone first, then the full state
            // only if the snapshot is ahead — the state can be megabytes.
            select: (columns: string) => ({
              eq: (column: string, value: unknown) => ({
                maybeSingle: async () => {
                  this.queries.push(
                    `${table}.select(${columns}).eq(${column}, ${String(value)}).maybeSingle()`,
                  );
                  if (this.failReads > 0) {
                    this.failReads -= 1;
                    return { data: null, error: { message: 'snapshot boom' } };
                  }
                  if (this.snapshot === null) {
                    return { data: null, error: null };
                  }
                  if (columns.trim() === 'through_id') {
                    this.snapshotMarkerReads += 1;
                    return {
                      data: { through_id: this.snapshot.through_id },
                      error: null,
                    };
                  }
                  this.snapshotStateReads += 1;
                  if (this.failStateReads > 0) {
                    this.failStateReads -= 1;
                    return { data: null, error: { message: 'state boom' } };
                  }
                  if (this.stateReadReturnsNull) {
                    return { data: null, error: null };
                  }
                  return {
                    data:
                      this.stateThroughIdOverride === undefined
                        ? this.snapshot
                        : { ...this.snapshot, through_id: this.stateThroughIdOverride },
                    error: null,
                  };
                },
              }),
            }),
          };
        }

        // trip_doc_updates
        const surviving = () =>
          this.hideRows
            ? []
            : this.rows
                .filter((row) => row.id > this.prunedBelow)
                .sort((left, right) => left.id - right.id);

        return {
          select: (columns: string) => ({
            eq: (column: string, value: unknown) => ({
              gt: (gtColumn: string, afterId: number) => ({
                order: (orderColumn: string, orderOptions: unknown) => ({
                  limit: async (count: number) => {
                    this.queries.push(
                      `${table}.select(${columns}).eq(${column}, ${String(value)})` +
                        `.gt(${gtColumn}, ${afterId}).order(${orderColumn}, ` +
                        `${JSON.stringify(orderOptions)}).limit(${count})`,
                    );
                    this.readCalls += 1;
                    this.onLogRead?.();
                    if (this.readGate) {
                      await this.readGate;
                    }
                    if (this.failReads > 0) {
                      this.failReads -= 1;
                      return { data: null, error: { message: 'read boom' } };
                    }
                    if (this.failLogReads > 0) {
                      this.failLogReads -= 1;
                      return { data: null, error: { message: 'log boom' } };
                    }
                    const page = surviving()
                      .filter((row) => row.id > afterId)
                      .slice(0, count);
                    return { data: page, error: null };
                  },
                }),
              }),

              // No `gt`: the floor query, asking for the oldest surviving row.
              // Used to tell an unreadable snapshot the log can still cover from
              // one hiding rows that compaction pruned.
              order: (orderColumn: string, orderOptions: unknown) => ({
                limit: async (count: number) => {
                  this.queries.push(
                    `${table}.select(${columns}).eq(${column}, ${String(value)})` +
                      `.order(${orderColumn}, ${JSON.stringify(orderOptions)}).limit(${count})`,
                  );
                  if (this.failReads > 0) {
                    this.failReads -= 1;
                    return { data: null, error: { message: 'floor boom' } };
                  }
                  if (this.floorOverride !== null) {
                    return this.floorOverride;
                  }
                  return { data: surviving().slice(0, count), error: null };
                },
              }),
            }),
          }),
          insert: async (values: { trip_id: string; update: string }) => {
            this.queries.push(`${table}.insert(trip_id=${values.trip_id})`);
            this.insertCalls += 1;
            const number = this.insertCalls;
            if (this.writeGate) {
              await this.writeGate;
            }
            if (this.failNthWrite === number) {
              return { error: { message: 'write boom' } };
            }
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

      channel: (...args: unknown[]) => {
        const [name, options] = args as [
          string,
          { config?: { presence?: { key?: string } } } | undefined,
        ];
        this.channelCalls.push({ name, args });
        // Captured so a test can assert two tabs of one account collapse to a
        // single presence key rather than counting twice.
        this.presenceKey = options?.config?.presence?.key ?? null;

        const channel = {
          /**
           * Dispatches by event name, which the previous version did not.
           *
           * It stored every handler in one slot, so adding a presence listener
           * silently replaced the postgres_changes one and row delivery stopped
           * working — a fake that quietly diverges from the real channel.
           */
          on: (
            event: string,
            filter: unknown,
            handler: RealtimeHandler | (() => void),
          ) => {
            this.onCalls.push({ event, filter });
            if (event === 'presence') {
              this.presenceHandler = handler as () => void;
            } else {
              this.realtimeHandler = handler as RealtimeHandler;
            }
            return channel;
          },
          subscribe: (callback?: (status: string) => void) => {
            if (callback) {
              this.subscribeCallback = callback;
            }
            this.channelStatus = 'SUBSCRIBED';
            if (this.autoSubscribe) {
              callback?.('SUBSCRIBED');
            }
            return channel;
          },
          track: async (payload: unknown) => {
            this.trackPayloads.push(payload);
            // Realtime keys by the configured presence key, falling back to a
            // per-connection one.
            this.presence.set(this.presenceKey ?? 'anon-connection', payload);
            this.presenceHandler?.();
            return 'ok';
          },
          untrack: async () => {
            this.presence.delete(this.presenceKey ?? 'anon-connection');
            this.presenceHandler?.();
            return 'ok';
          },
          presenceState: () => {
            if (this.presenceThrows) {
              throw new Error('presence boom');
            }
            return Object.fromEntries(this.presence);
          },
        };
        return channel;
      },

      removeChannel: async () => {
        this.removeChannelCalls += 1;
      },

      /**
       * `publish_trip_snapshot`, modelling the guards that matter to the client:
       * monotonic in `through_id`, and never past the log.
       */
      rpc: async (
        name: string,
        args: { p_trip_id: string; p_state: string; p_through_id: number },
      ) => {
        this.rpcCalls += 1;
        if (name !== 'publish_trip_snapshot') {
          return { data: null, error: { message: `no such rpc ${name}` } };
        }
        if (this.throwPublishes > 0) {
          this.throwPublishes -= 1;
          throw new Error('publish threw');
        }
        if (this.failPublishes > 0) {
          this.failPublishes -= 1;
          return { data: null, error: { message: 'publish boom' } };
        }

        const highest = this.rows.reduce((max, row) => Math.max(max, row.id), 0);
        if (args.p_through_id > highest) {
          return {
            data: null,
            error: { message: 'through_id is beyond the log' },
          };
        }
        if (this.snapshot !== null && args.p_through_id <= this.snapshot.through_id) {
          return { data: 0, error: null };
        }

        this.snapshotPublishes.push({
          trip_id: args.p_trip_id,
          state: args.p_state,
          through_id: args.p_through_id,
        });
        this.snapshot = { state: args.p_state, through_id: args.p_through_id };
        // Keeps a margin, as the migration does.
        this.rows = this.rows.filter((row) => row.id > args.p_through_id - 50);
        return { data: 1, error: null };
      },
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

const TRIP_ID = 'trip-local-1' as TripId;
const REMOTE_TRIP_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function makeProvider(
  server: FakeServer,
  doc: Y.Doc,
  userId?: string,
): SupabaseYjsProvider {
  return new SupabaseYjsProvider({
    // The fake implements exactly the surface the provider uses.
    client: server.client as never,
    doc,
    tripId: TRIP_ID,
    remoteTripId: REMOTE_TRIP_ID,
    ...(userId === undefined ? {} : { userId }),
  });
}

/**
 * Two tabs, one cursor.
 *
 * Every tab on a trip shares the Dexie cursor and holds its own document. A
 * tab that misses a Realtime row while another tab pulls it used to find the
 * cursor already past that row and never fetch it; its projection then
 * deleted the entity, and the trusted-mirror sync deleted it for everyone.
 */
describe('a tab that fell behind the shared cursor', () => {
  it('still fetches the rows another tab consumed', async () => {
    const server = new FakeServer();
    const seed = new Y.Doc();
    addGuest(seed, 'g1', 'Alice');
    server.append(Y.encodeStateAsUpdate(seed));

    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await settle();
    expect(guestNames(doc)).toEqual(['Alice']);
    expect((await readCursor(TRIP_ID)).lastSeenUpdateId).toBe(1);

    // Another tab receives row 2 and advances the shared cursor; this tab's
    // socket was asleep and never saw it.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    addGuest(other, 'g2', 'Bob');
    server.append(Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)));
    await advanceCursor(TRIP_ID, 2);

    await provider.syncNow();
    await settle();

    expect(guestNames(doc)).toEqual(['Alice', 'Bob']);
  });
});

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

  it('refuses to claim it is synced when an unreadable snapshot hides pruned rows', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();

    // Compaction folded rows 1..100 and pruned them, and the snapshot that
    // replaced them will not decode. Unlike the intact-log case above, the log
    // cannot reconstruct anything: rows 1..100 exist nowhere the client can
    // reach, so the document is permanently incomplete.
    server.snapshot = { state: 'not valid base64!!', through_id: 100 };
    server.prunedBelow = 100;
    server.rows.push({ id: 101, update: encodeUpdate(Y.encodeStateAsUpdate(new Y.Doc())) });
    server.nextId = 102;

    const provider = track(makeProvider(server, doc));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await provider.start();
    warn.mockRestore();

    // Reporting 'synced' here would tell the user their trip is up to date while
    // silently missing everything the snapshot swallowed.
    expect(provider.getState().status).toBe('offline');
    // And the cursor must not move past the gap, so a later retry still tries.
    expect((await readCursor(TRIP_ID)).lastSeenUpdateId).toBeLessThan(100);
  });

  it('keeps trying when it starts empty and the rows arrive afterwards', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();

    // A cold join that wins the race: the invitee's provider starts before the
    // owner's first upload has landed, so the first pull returns nothing.
    const provider = track(makeProvider(server, doc));
    await provider.start();
    expect(guestNames(doc)).toEqual([]);

    // The owner uploads now. No Realtime delivery — the socket is exactly what
    // cannot be relied on, and a blocked WebSocket is ordinary on the sort of
    // network this app gets used on.
    const seed = new Y.Doc();
    addGuest(seed, 'p1', 'Alice');
    server.append(Y.encodeStateAsUpdate(seed));

    // Without a retry the invitee sits on "Getting the trip…" until something
    // reloads the page.
    // 2 ms per attempt, so this allows a little over three seconds — enough for
    // the first hydration retry plus its backoff.
    await waitUntil(() => guestNames(doc).length === 1, 'Alice to arrive', 1_800);
    expect(guestNames(doc)).toEqual(['Alice']);
  });

  it('pages through a log longer than one request', async () => {
    const server = new FakeServer();
    const seed = new Y.Doc();

    // 1200 rows forces three pages at PULL_PAGE_SIZE 500. Each row carries just
    // the guest that `addGuest` added — its `Y.transact` emits one update — which
    // is what an append-only log holds anyway. Re-encoding the whole doc per row
    // is quadratic, and slow enough under coverage to blow the test timeout.
    seed.on('update', (update: Uint8Array) => {
      server.append(update);
    });
    for (let index = 0; index < 1200; index += 1) {
      addGuest(seed, `p${index}`, `Guest ${index}`);
    }

    const doc = new Y.Doc();
    await track(makeProvider(server, doc)).start();

    expect(doc.getMap('guestsById').size).toBe(1200);
    expect(await readCursor(TRIP_ID)).toMatchObject({ lastSeenUpdateId: 1200 });
  });

  it('applies a snapshot that is ahead of the cursor, after compaction pruned rows', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();

    // This device has read up to row 50.
    await advanceCursor(TRIP_ID, 50);

    // Compaction then folded rows 1..100 into a snapshot and deleted them, so
    // the guests only exist inside the snapshot now. Row 101 arrived after.
    const seed = new Y.Doc();
    addGuest(seed, 'p1', 'Folded Alice');
    addGuest(seed, 'p2', 'Folded Bob');
    server.snapshot = {
      state: encodeUpdate(Y.encodeStateAsUpdate(seed)),
      through_id: 100,
    };
    server.nextId = 101;
    addGuest(seed, 'p3', 'Later Carol');
    server.rows.push({ id: 101, update: encodeUpdate(Y.encodeStateAsUpdate(seed)) });
    server.nextId = 102;

    await track(makeProvider(server, doc)).start();

    // Without applying the snapshot, 51..100 would be lost forever — they exist
    // nowhere else. Pulling `id > 50` alone would return only row 101.
    expect(guestNames(doc)).toEqual(['Folded Alice', 'Folded Bob', 'Later Carol']);
    expect((await readCursor(TRIP_ID)).lastSeenUpdateId).toBe(101);
  });

  it('reads the snapshot marker without downloading state it does not need', async () => {
    const server = new FakeServer();
    const seed = new Y.Doc();
    addGuest(seed, 'p1', 'Alice');
    server.snapshot = {
      state: encodeUpdate(Y.encodeStateAsUpdate(seed)),
      through_id: 5,
    };
    server.nextId = 6;

    // Already past the snapshot.
    await advanceCursor(TRIP_ID, 10);

    await track(makeProvider(server, new Y.Doc())).start();

    // The marker is cheap; the state can be megabytes, so it must not be
    // fetched on every start once a device is caught up.
    expect(server.snapshotMarkerReads).toBeGreaterThan(0);
    expect(server.snapshotStateReads).toBe(0);
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

  it('sends an edit whose queue row was lost during a successful flush', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    await track(makeProvider(server, doc)).start();
    await settle();

    // A write is held open, so a flush is genuinely in flight.
    const release = server.gateWrites();
    addGuest(doc, 'p1', 'Alice');
    await settle(4);

    // While it is in flight, an edit the queue never records. In production this
    // is the document emitting synchronously while the Dexie write fails or the
    // tab dies before it lands — the window the gate is widening.
    const enqueue = vi
      .spyOn(outbox, 'enqueue')
      .mockRejectedValueOnce(new Error('storage evicted'));
    addGuest(doc, 'p2', 'Bob');
    await settle(4);
    enqueue.mockRestore();

    release();
    await settle(24);

    // The flush that completes here sends Alice and finds the queue empty, so
    // it would record the document's whole state vector as the server's —
    // including Bob, who exists only on this device. Reconciliation would then
    // compute an empty diff forever and Bob would never leave.
    const rebuilt = new Y.Doc();
    for (const row of server.rows) {
      Y.applyUpdate(rebuilt, Uint8Array.from(atob(row.update), (c) => c.charCodeAt(0)));
    }
    expect(guestNames(rebuilt)).toEqual(['Alice', 'Bob']);
  });

  it('keeps a queue row the reconcile diff did not cover', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');

    // A fresh provider reconciles on start: the diff is the whole document, and
    // a first upload over mobile takes seconds. Hold that write open.
    const release = server.gateWrites();
    const provider = track(makeProvider(server, doc));
    const started = provider.start();
    await settle(4);

    // Two edits arrive during that window. The first queues and starts its own
    // flush, which blocks on the same gate. The second queues and finds that
    // flush already running, so no flush of its own ever reads its row.
    addGuest(doc, 'p2', 'Bob');
    await settle(2);
    addGuest(doc, 'p3', 'Carol');
    await settle(2);

    release();
    await started;
    await settle(24);

    // Neither edit is in the diff that was sent — it was taken before they
    // existed. Clearing the whole outbox afterwards deleted Carol's row, and
    // the provider then reported `synced` with nothing pending while Carol
    // never reached another member for the rest of the session.
    const rebuilt = new Y.Doc();
    for (const row of server.rows) {
      Y.applyUpdate(rebuilt, Uint8Array.from(atob(row.update), (c) => c.charCodeAt(0)));
    }
    expect(guestNames(rebuilt)).toEqual(['Alice', 'Bob', 'Carol']);
    expect(await outbox.pendingCount(TRIP_ID)).toBe(0);
  });

  it('sends a row queued while another flush was running, whichever finishes last', async () => {
    // The test above, with the one ordering it left to chance pinned down.
    // There, reconciliation's closing `flush()` usually runs after Bob's flush
    // has finished, and it picks Carol up. Under load, CI saw the other order:
    // Bob's flush was still acknowledging its row, the closing `flush()` found
    // `flushing` set and returned, and Bob's flush then ended with Carol still
    // queued and nobody left to send her.
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');

    // Only a flush acknowledges a non-empty list here, since reconciliation's
    // own list is empty: nothing was queued when it read the queue. Slowing
    // that write keeps Bob's flush running past reconciliation's closing call.
    const acknowledge = outbox.acknowledge;
    const slowAcknowledge = vi.spyOn(outbox, 'acknowledge').mockImplementation(async (ids) => {
      if (ids.length > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
      }
      await acknowledge(ids);
    });

    const release = server.gateWrites();
    const provider = track(makeProvider(server, doc));
    const started = provider.start();
    await settle(4);

    addGuest(doc, 'p2', 'Bob');
    await settle(2);
    addGuest(doc, 'p3', 'Carol');
    await settle(2);

    release();
    await started;

    // Drained, and idle: a flush still finishing would write its cursor into
    // the next test's database after this one ends.
    await waitUntil(
      async () =>
        (await outbox.pendingCount(TRIP_ID)) === 0 && provider.getState().status !== 'syncing',
      'the queue to drain and the provider to go idle',
    );
    slowAcknowledge.mockRestore();

    const rebuilt = new Y.Doc();
    for (const row of server.rows) {
      Y.applyUpdate(rebuilt, Uint8Array.from(atob(row.update), (c) => c.charCodeAt(0)));
    }
    expect(guestNames(rebuilt)).toEqual(['Alice', 'Bob', 'Carol']);
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
// State churn
// ============================================================================

describe('state publication', () => {
  it('does not publish a change when nothing a consumer can see has changed', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const seen: SyncState[] = [];

    const provider = track(
      new SupabaseYjsProvider({
        client: server.client as never,
        doc,
        tripId: TRIP_ID,
        remoteTripId: REMOTE_TRIP_ID,
        onStateChange: (next) => {
          seen.push(next);
        },
      }),
    );

    await provider.start();
    await settle();
    const afterStart = seen.length;

    // Repeated pulls that find nothing. Each one used to publish a new state,
    // because `lastSyncedAt` moves every time — and this state feeds a context
    // wrapping the whole app, so every quiet pull re-rendered the entire tree.
    // With a document that is still empty the hydration retry does exactly this
    // on a timer, which is visible as flicker.
    await provider.syncNow();
    await provider.syncNow();
    await provider.syncNow();
    await settle();

    expect(seen.length).toBe(afterStart);
  });

  it('still publishes a change a consumer can see', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const seen: SyncState[] = [];

    const provider = track(
      new SupabaseYjsProvider({
        client: server.client as never,
        doc,
        tripId: TRIP_ID,
        remoteTripId: REMOTE_TRIP_ID,
        onStateChange: (next) => {
          seen.push(next);
        },
      }),
    );
    await provider.start();
    await settle();
    const afterStart = seen.length;

    // A failure is worth telling anyone about.
    server.failReads = 99;
    await provider.syncNow();
    await settle();

    expect(seen.length).toBeGreaterThan(afterStart);
    expect(provider.getState().status).toBe('offline');
  });
});

// ============================================================================
// Compaction
// ============================================================================

describe('compaction', () => {
  /** Seeds a log long enough to cross COMPACT_AFTER_ROWS. */
  function seedLog(server: FakeServer, rows: number): void {
    const seed = new Y.Doc();
    for (let index = 0; index < rows; index += 1) {
      addGuest(seed, `p${index}`, `Guest ${index}`);
      server.append(Y.encodeStateAsUpdate(seed));
    }
  }

  it('publishes a snapshot once it has seen enough of the log', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    seedLog(server, 250);

    await track(makeProvider(server, doc)).start();
    await settle();

    expect(server.snapshotPublishes).toHaveLength(1);

    // The claim is this device's own cursor: only rows it has actually applied.
    const published = server.snapshotPublishes[0]!;
    expect(published.through_id).toBe((await readCursor(TRIP_ID)).lastSeenUpdateId);
    expect(published.trip_id).toBe(REMOTE_TRIP_ID);
  });

  it('publishes a snapshot the whole document can be rebuilt from', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    seedLog(server, 250);

    await track(makeProvider(server, doc)).start();
    await settle();

    const published = server.snapshotPublishes[0]!;
    const rebuilt = new Y.Doc();
    Y.applyUpdate(
      rebuilt,
      Uint8Array.from(atob(published.state), (char) => char.charCodeAt(0)),
    );

    // Pruning follows the snapshot, so anything missing here is lost outright.
    expect(rebuilt.getMap('guestsById').size).toBe(250);
  });

  it('leaves a short log alone', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    seedLog(server, 5);

    await track(makeProvider(server, doc)).start();
    await settle();

    // Compacting a five-row log costs a write and saves nothing.
    expect(server.snapshotPublishes).toHaveLength(0);
  });

  it('does not publish an empty snapshot over a log that has rows', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();

    // Rows that this document cannot read, so it stays empty while the pull
    // still advances the cursor past them.
    for (let index = 0; index < 250; index += 1) {
      server.rows.push({ id: index + 1, update: 'not valid base64!!' });
    }
    server.nextId = 251;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await track(makeProvider(server, doc)).start();
    await settle();
    warn.mockRestore();

    // This is the one move here that could destroy content.
    expect(server.snapshotPublishes).toHaveLength(0);
  });

  it('keeps working when a publish is refused', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    seedLog(server, 250);
    server.failPublishes = 99;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await settle();
    warn.mockRestore();

    // An uncompacted log is a growing table, not a broken trip.
    expect(server.snapshotPublishes).toHaveLength(0);
    expect(provider.getState().status).not.toBe('offline');
    expect(doc.getMap('guestsById').size).toBe(250);
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
  it('counts the people on the trip, this device included', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc, 'user-1'));
    await provider.start();
    await settle();

    // Just this device so far.
    expect(provider.getState().onlineCount).toBe(1);

    server.addPresence('someone-else');
    await settle(2);
    expect(provider.getState().onlineCount).toBe(2);

    server.removePresence('someone-else');
    await settle(2);
    expect(provider.getState().onlineCount).toBe(1);
  });

  it('keys presence per account and per trip, and carries nothing identifying', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    await track(makeProvider(server, doc, 'user-1')).start();
    await settle();

    const key = server.joinedPresenceKey;
    expect(key).not.toBeNull();

    // The channel is public: Postgres Changes payloads on it are filtered by
    // RLS but presence is not, so anyone with the publishable key who knows the
    // trip's uuid could read this. The account id must not be in it.
    expect(key).not.toContain('user-1');

    // Stable for the same account on the same trip, so two tabs count once...
    const secondDoc = new Y.Doc();
    const secondServer = new FakeServer();
    await track(makeProvider(secondServer, secondDoc, 'user-1')).start();
    await settle();
    expect(secondServer.joinedPresenceKey).toBe(key);
  });

  it('reports the head count as unknown rather than zero when the channel drops', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc, 'user-1'));
    await provider.start();
    await settle();
    expect(provider.getState().onlineCount).toBe(1);

    server.reportChannelStatus('CHANNEL_ERROR');
    await settle(2);

    // Nobody left the trip — we simply cannot see them any more. Saying zero
    // would be a claim about other people rather than about the connection.
    expect(provider.getState().onlineCount).toBeNull();
  });

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

// ============================================================================
// After destroy, and back from offline
// ============================================================================

describe('a provider that has been destroyed', () => {
  it('does nothing when asked to sync', async () => {
    const server = new FakeServer();
    const provider = track(makeProvider(server, new Y.Doc()));
    await provider.start();
    provider.destroy();

    const readsBefore = server.readCalls;
    const writesBefore = server.insertCalls;

    await expect(provider.syncNow()).resolves.toBeUndefined();

    expect(server.readCalls).toBe(readsBefore);
    expect(server.insertCalls).toBe(writesBefore);
  });

  it('leaves its document alone once another device writes', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();
    provider.destroy();

    const otherDoc = new Y.Doc();
    const other = track(makeProvider(server, otherDoc));
    await other.start();
    addGuest(otherDoc, 'p-late', 'Too late');
    await settle();
    await other.syncNow();
    await settle();

    expect(guestNames(doc)).toEqual([]);
  });
});

describe('coming back online', () => {
  it('tries again as soon as the browser says the network is back', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();

    server.failWrites = 99;
    addGuest(doc, 'p1', 'Alice');
    await settle();
    await provider.syncNow();
    await settle();
    expect(provider.getState().status).toBe('offline');

    server.failWrites = 0;
    window.dispatchEvent(new Event('online'));

    await waitUntil(
      () => provider.getState().status !== 'offline',
      'the provider to retry once the network came back',
    );
    expect(server.rows.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Edges the mutation run found unpinned
// ============================================================================

/**
 * Lets IndexedDB finish while `setTimeout` is faked.
 *
 * fake-indexeddb schedules on `setImmediate`, which the fake timers below leave
 * alone, so turning it is what lets a Dexie write complete between two timer
 * advances.
 */
async function io(turns = 40): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** Fakes the timers the provider schedules, leaving IndexedDB's own alone. */
function fakeTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
}

/** Advances fake time in small steps, letting IndexedDB run between them. */
async function advance(ms: number, step = 50): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await vi.advanceTimersByTimeAsync(Math.min(step, ms - elapsed));
    await io(4);
  }
}

function recordingProvider(server: FakeServer, doc: Y.Doc, userId?: string) {
  const seen: SyncState[] = [];
  const provider = track(
    new SupabaseYjsProvider({
      client: server.client as never,
      doc,
      tripId: TRIP_ID,
      remoteTripId: REMOTE_TRIP_ID,
      ...(userId === undefined ? {} : { userId }),
      onStateChange: (next) => {
        seen.push(next);
      },
    }),
  );
  return { provider, seen };
}

function decode(update: string): Uint8Array {
  return Uint8Array.from(atob(update), (char) => char.charCodeAt(0));
}

describe('state, before and after start', () => {
  it('reads as local before it starts', () => {
    const provider = track(makeProvider(new FakeServer(), new Y.Doc()));

    expect(provider.getState()).toEqual({ status: 'local', pendingCount: 0, onlineCount: null });
  });

  it('announces syncing first, and settles on synced when there is nothing to send', async () => {
    const server = new FakeServer();
    const { provider, seen } = recordingProvider(server, new Y.Doc());

    await provider.start();
    await settle();

    expect(seen[0]?.status).toBe('syncing');
    expect(provider.getState().status).toBe('synced');
  });

  it('records when it last read the log', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(1_700_000_000_000));
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const provider = track(makeProvider(server, doc));

    await provider.start();

    expect(provider.getState().lastSyncedAt).toBe(1_700_000_000_000);
  });

  it('records when a flush emptied the queue', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(1_700_000_000_000));
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();

    vi.setSystemTime(new Date(1_700_000_005_000));
    addGuest(doc, 'p1', 'Alice');
    await waitUntil(async () => (await outbox.pendingCount(TRIP_ID)) === 0 && server.insertCalls > 0, 'the flush');
    await settle();

    expect(provider.getState().lastSyncedAt).toBe(1_700_000_005_000);
  });
});

describe('presence keys', () => {
  it('is a fixed function of the account and the trip', async () => {
    const server = new FakeServer();
    await track(makeProvider(server, new Y.Doc(), 'user-1')).start();

    // FNV-1a of `user-1:<trip>`, pinned so a change in the hash is a decision.
    expect(server.joinedPresenceKey).toBe('c24a1b91');
  });

  it('pads a short hash to eight characters', async () => {
    const server = new FakeServer();
    await track(makeProvider(server, new Y.Doc(), 'user-9')).start();

    expect(server.joinedPresenceKey).toBe('0496be39');
  });

  it('differs between two accounts on one trip and one account on two trips', async () => {
    const first = new FakeServer();
    const second = new FakeServer();
    const third = new FakeServer();
    await track(makeProvider(first, new Y.Doc(), 'user-1')).start();
    await track(makeProvider(second, new Y.Doc(), 'user-2')).start();
    await track(
      new SupabaseYjsProvider({
        client: third.client as never,
        doc: new Y.Doc(),
        tripId: 'trip-local-3' as TripId,
        remoteTripId: 'bbbbbbbb-0000-0000-0000-000000000002',
        userId: 'user-1',
      }),
    ).start();

    expect(second.joinedPresenceKey).not.toBe(first.joinedPresenceKey);
    expect(third.joinedPresenceKey).not.toBe(first.joinedPresenceKey);
  });

  it('opens the channel with no presence key and no config when there is no account', async () => {
    const server = new FakeServer();

    await track(makeProvider(server, new Y.Doc())).start();

    expect(server.channelCalls).toEqual([{ name: `trip-doc:${REMOTE_TRIP_ID}`, args: [`trip-doc:${REMOTE_TRIP_ID}`] }]);
    expect(server.joinedPresenceKey).toBeNull();
  });
});

describe('the realtime channel', () => {
  it('listens to inserts into this trip’s log, and to presence', async () => {
    const server = new FakeServer();

    await track(makeProvider(server, new Y.Doc(), 'user-1')).start();

    expect(server.onCalls).toEqual([
      {
        event: 'postgres_changes',
        filter: {
          event: 'INSERT',
          schema: 'public',
          table: 'trip_doc_updates',
          filter: `trip_id=eq.${REMOTE_TRIP_ID}`,
        },
      },
      { event: 'presence', filter: { event: 'sync' } },
    ]);
    expect(server.trackPayloads).toEqual([{ joinedAt: expect.any(Number) }]);
  });

  it.each(['CLOSED', 'CHANNEL_ERROR', 'TIMED_OUT'])(
    'reports the head count as unknown when the channel says %s',
    async (status) => {
      const server = new FakeServer();
      const provider = track(makeProvider(server, new Y.Doc(), 'user-1'));
      await provider.start();
      await settle();
      expect(provider.getState().onlineCount).toBe(1);

      server.reportChannelStatus(status);

      expect(provider.getState().onlineCount).toBeNull();
    },
  );

  it('keeps the head count through a status that is not a failure', async () => {
    const server = new FakeServer();
    const provider = track(makeProvider(server, new Y.Doc(), 'user-1'));
    await provider.start();
    await settle();

    server.reportChannelStatus('JOINING');

    expect(provider.getState().onlineCount).toBe(1);
  });

  it('reads the head count as unknown when presence cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = new FakeServer();
    const provider = track(makeProvider(server, new Y.Doc(), 'user-1'));
    await provider.start();
    await settle();

    server.presenceThrows = true;
    server.addPresence('someone-else');

    expect(provider.getState().onlineCount).toBeNull();
    expect(warn).toHaveBeenCalledWith('[sync] could not read presence:', expect.any(Error));
  });

  it('pulls a debounced moment after it subscribes', async () => {
    fakeTimers();
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await io();
    const before = server.readCalls;

    server.reportSubscribed();
    await advance(700);
    expect(server.readCalls).toBe(before);
    await advance(100);

    expect(server.readCalls).toBe(before + 1);
  });

  it('pulls once for a burst of deliveries, after the last one', async () => {
    fakeTimers();
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await advance(800);
    const before = server.readCalls;

    server.deliver({ id: 900, update: 'not valid base64!!' });
    await advance(400);
    server.deliver({ id: 901, update: 'not valid base64!!' });
    await advance(500);
    // 900 ms after the first, 500 after the second: still waiting.
    expect(server.readCalls).toBe(before);

    await advance(300);
    expect(server.readCalls).toBe(before + 1);
  });

  it('ignores a payload with no row on it, and still pulls', async () => {
    fakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await advance(800);
    const before = server.readCalls;

    expect(() => server.deliverRaw({})).not.toThrow();
    await advance(800);

    expect(server.readCalls).toBe(before + 1);
    expect(warn).not.toHaveBeenCalledWith('[sync] realtime payload did not apply:', expect.anything());
  });

  it('warns about a payload that decodes and does not apply', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = new FakeServer();
    const provider = track(makeProvider(server, new Y.Doc()));
    await provider.start();

    server.deliver({ id: 900, update: encodeUpdate(new Uint8Array([255, 255, 255, 255])) });

    expect(warn).toHaveBeenCalledWith('[sync] realtime payload did not apply:', expect.anything());
  });

  it('says nothing about an undecodable payload beyond dropping it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = new FakeServer();
    const provider = track(makeProvider(server, new Y.Doc()));
    await provider.start();

    server.deliver({ id: 900, update: 'not valid base64!!' });

    expect(warn).not.toHaveBeenCalledWith('[sync] realtime payload did not apply:', expect.anything());
  });
});

describe('after destroy', () => {
  it('queues nothing for an edit made after destroy', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();

    provider.destroy();
    addGuest(doc, 'p1', 'After destroy');
    await settle();

    expect(await outbox.pendingCount(TRIP_ID)).toBe(0);
  });

  it('stops listening for the network coming back', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const provider = track(makeProvider(new FakeServer(), new Y.Doc()));
    await provider.start();

    provider.destroy();

    expect(remove).toHaveBeenCalledWith('online', expect.any(Function));
  });

  it('removes its channel once, and forgets the head count', async () => {
    const server = new FakeServer();
    const provider = track(makeProvider(server, new Y.Doc(), 'user-1'));
    await provider.start();
    await settle();
    expect(provider.getState().onlineCount).toBe(1);

    provider.destroy();
    provider.destroy();

    expect(server.removeChannelCalls).toBe(1);
    expect(provider.getState().onlineCount).toBeNull();
  });

  it('applies nothing delivered after destroy', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();
    provider.destroy();

    const remote = new Y.Doc();
    addGuest(remote, 'p1', 'Late');
    server.deliver(server.append(Y.encodeStateAsUpdate(remote)));

    expect(guestNames(doc)).toEqual([]);
  });

  it('counts nobody once destroyed, whatever presence says', async () => {
    const server = new FakeServer();
    const provider = track(makeProvider(server, new Y.Doc(), 'user-1'));
    await provider.start();
    await settle();
    provider.destroy();

    server.addPresence('someone-else');

    expect(provider.getState().onlineCount).toBeNull();
  });

  it('leaves no timer behind: a pending pull, a retry, or a hydration retry', async () => {
    fakeTimers();
    const server = new FakeServer();
    // Empty, so a hydration retry is scheduled; a refused read, so a retry is.
    server.failLogReads = 1;
    const provider = track(makeProvider(server, new Y.Doc()));
    await provider.start();
    await io();
    server.deliver({ id: 900, update: 'not valid base64!!' });
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(3);

    provider.destroy();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('schedules nothing for a channel that comes back after destroy', async () => {
    fakeTimers();
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await io();
    provider.destroy();

    server.reportSubscribed();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends nothing queued by an edit made just before destroy', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();
    const before = server.insertCalls;

    addGuest(doc, 'p1', 'Alice');
    provider.destroy();
    await settle();

    expect(server.insertCalls).toBe(before);
  });

  it('stops sending the rest of the queue when destroyed mid-flush', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await settle();

    const release = server.gateWrites();
    addGuest(doc, 'p1', 'Alice');
    addGuest(doc, 'p2', 'Bob');
    await waitUntil(() => server.insertCalls === 1, 'the first send to be in flight');
    provider.destroy();
    release();
    await settle();

    expect(server.insertCalls).toBe(1);
  });

  it('opens no channel and publishes no snapshot when destroyed during the first pull', async () => {
    const server = new FakeServer();
    const seed = new Y.Doc();
    for (let index = 0; index < 250; index += 1) {
      addGuest(seed, `p${index}`, `Guest ${index}`);
      server.append(Y.encodeStateAsUpdate(seed));
    }
    const provider = track(makeProvider(server, new Y.Doc()));
    server.onLogRead = () => {
      provider.destroy();
    };

    await provider.start();
    await settle();

    expect(server.channelCalls).toHaveLength(0);
    expect(server.rpcCalls).toBe(0);
  });

  it('reads no further page once destroyed between pages', async () => {
    const server = new FakeServer();
    const seed = new Y.Doc();
    seed.on('update', (update: Uint8Array) => {
      server.append(update);
    });
    for (let index = 0; index < 600; index += 1) {
      addGuest(seed, `p${index}`, `Guest ${index}`);
    }
    const provider = track(makeProvider(server, new Y.Doc()));
    server.onLogRead = () => {
      provider.destroy();
    };

    await provider.start();

    expect(server.readCalls).toBe(1);
  });
});

describe('hydration retries', () => {
  it('asks again on a bounded schedule while the document stays empty, then stops', async () => {
    fakeTimers();
    const server = new FakeServer();
    // No subscribe callback, so its debounced pull does not land on the same tick.
    server.autoSubscribe = false;
    const provider = track(makeProvider(server, new Y.Doc()));
    await provider.start();
    await io();
    expect(server.readCalls).toBe(1);

    await advance(700);
    expect(server.readCalls).toBe(1);
    await advance(100);
    expect(server.readCalls).toBe(2);

    // 1.5 s, 3 s, 6 s and 12 s after that, and then never again.
    await advance(1_500 + 3_000 + 6_000 + 12_000 + 100);
    expect(server.readCalls).toBe(6);
    await advance(30_000, 1_000);
    expect(server.readCalls).toBe(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not ask again for a document that already has content', async () => {
    fakeTimers();
    const server = new FakeServer();
    server.autoSubscribe = false;
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await io();
    const before = server.readCalls;

    await advance(30_000, 1_000);

    expect(server.readCalls).toBe(before);
  });
});

describe('pulling', () => {
  it('asks for the marker, then the log after the cursor, of this trip', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const provider = track(makeProvider(server, doc));
    await advanceCursor(TRIP_ID, 7);

    await provider.start();

    expect(server.queries.slice(0, 2)).toEqual([
      `trip_doc_snapshots.select(through_id).eq(trip_id, ${REMOTE_TRIP_ID}).maybeSingle()`,
      `trip_doc_updates.select(id, update).eq(trip_id, ${REMOTE_TRIP_ID})` +
        '.gt(id, 7).order(id, {"ascending":true}).limit(500)',
    ]);
    expect(server.queries).toContain(`trip_doc_updates.insert(trip_id=${REMOTE_TRIP_ID})`);
  });

  it('reads one page for a short log, and no empty page after it', async () => {
    const server = new FakeServer();
    const seed = new Y.Doc();
    addGuest(seed, 'p1', 'Alice');
    server.append(Y.encodeStateAsUpdate(seed));
    const provider = track(makeProvider(server, new Y.Doc()));

    await provider.start();

    expect(server.readCalls).toBe(1);
  });

  it('does not run two pulls at once', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const provider = track(makeProvider(server, doc));
    await provider.start();
    const before = server.readCalls;

    await Promise.all([provider.syncNow(), provider.syncNow()]);

    expect(server.readCalls).toBe(before + 1);
  });

  it('does not download a snapshot that ends exactly at the cursor', async () => {
    const server = new FakeServer();
    const seed = new Y.Doc();
    addGuest(seed, 'p1', 'Alice');
    server.snapshot = { state: encodeUpdate(Y.encodeStateAsUpdate(seed)), through_id: 5 };
    server.nextId = 6;
    await advanceCursor(TRIP_ID, 5);

    await track(makeProvider(server, new Y.Doc())).start();

    expect(server.snapshotStateReads).toBe(0);
  });

  it('ignores a marker that is not a number', async () => {
    const server = new FakeServer();
    server.snapshot = { state: 'AAAA', through_id: '5' as unknown as number };

    await track(makeProvider(server, new Y.Doc())).start();

    expect(server.snapshotStateReads).toBe(0);
  });

  it('downloads the snapshot state of this trip, and applies it', async () => {
    const server = new FakeServer();
    const snapshotDoc = new Y.Doc();
    addGuest(snapshotDoc, 'p1', 'Alice');
    server.snapshot = { state: encodeUpdate(Y.encodeStateAsUpdate(snapshotDoc)), through_id: 3 };
    // The row after it carries only Bob, so Alice can come from the snapshot alone.
    const before = Y.encodeStateVector(snapshotDoc);
    addGuest(snapshotDoc, 'p2', 'Bob');
    server.rows.push({ id: 4, update: encodeUpdate(Y.encodeStateAsUpdate(snapshotDoc, before)) });
    server.nextId = 5;
    const doc = new Y.Doc();

    await track(makeProvider(server, doc)).start();

    expect(guestNames(doc)).toEqual(['Alice', 'Bob']);
    expect(server.queries).toContain(
      `trip_doc_snapshots.select(state, through_id).eq(trip_id, ${REMOTE_TRIP_ID}).maybeSingle()`,
    );
  });

  it('moves the cursor to the snapshot’s marker when no row follows it', async () => {
    const server = new FakeServer();
    const seed = new Y.Doc();
    addGuest(seed, 'p1', 'Alice');
    server.snapshot = { state: encodeUpdate(Y.encodeStateAsUpdate(seed)), through_id: 100 };
    server.nextId = 101;

    await track(makeProvider(server, new Y.Doc())).start();

    expect((await readCursor(TRIP_ID)).lastSeenUpdateId).toBe(100);
  });

  it.each([
    ['the marker read', { failReads: 1 }, 'snapshot marker read failed: snapshot boom'],
    ['the state read', { failStateReads: 1 }, 'snapshot read failed: state boom'],
    ['a log page read', { failLogReads: 1 }, 'log read failed: log boom'],
  ])('reports offline, and why, when %s fails', async (_label, failure, message) => {
    const server = new FakeServer();
    const seed = new Y.Doc();
    addGuest(seed, 'p1', 'Alice');
    server.snapshot = { state: encodeUpdate(Y.encodeStateAsUpdate(seed)), through_id: 3 };
    server.nextId = 4;
    Object.assign(server, failure);
    const doc = new Y.Doc();
    addGuest(doc, 'p0', 'Local');
    const provider = track(makeProvider(server, doc));

    await provider.start();

    expect(provider.getState()).toMatchObject({ status: 'offline', lastError: message });
  });

  it('carries on when the snapshot vanished between the two reads', async () => {
    const server = new FakeServer();
    server.snapshot = { state: 'AAAA', through_id: 3 };
    server.stateReadReturnsNull = true;
    const doc = new Y.Doc();
    addGuest(doc, 'p0', 'Local');
    const provider = track(makeProvider(server, doc));

    await provider.start();

    expect(provider.getState().status).toBe('synced');
  });

  it('refuses an unreadable snapshot over an empty log', async () => {
    const server = new FakeServer();
    server.snapshot = { state: 'not valid base64!!', through_id: 3 };
    const doc = new Y.Doc();
    addGuest(doc, 'p0', 'Local');
    const provider = track(makeProvider(server, doc));

    await provider.start();

    expect(provider.getState().status).toBe('offline');
    expect(provider.getState().lastError).toContain(
      'did not decode and the log has been pruned past the gap',
    );
    expect(server.queries).toContain(
      `trip_doc_updates.select(id).eq(trip_id, ${REMOTE_TRIP_ID})` +
        '.order(id, {"ascending":true}).limit(1)',
    );
  });

  it('refuses an unreadable snapshot when the floor of the log is not a number', async () => {
    const server = new FakeServer();
    server.snapshot = { state: 'not valid base64!!', through_id: 3 };
    server.floorOverride = { data: [{ id: '1' }], error: null };
    const doc = new Y.Doc();
    addGuest(doc, 'p0', 'Local');
    const provider = track(makeProvider(server, doc));

    await provider.start();

    expect(provider.getState().status).toBe('offline');
  });

  it('reports a floor read that fails', async () => {
    const server = new FakeServer();
    server.snapshot = { state: 'not valid base64!!', through_id: 3 };
    server.floorOverride = { data: null, error: { message: 'floor denied' } };
    const doc = new Y.Doc();
    addGuest(doc, 'p0', 'Local');
    const provider = track(makeProvider(server, doc));

    await provider.start();

    expect(provider.getState().lastError).toBe('log floor read failed: floor denied');
  });

  it('says it falls back to the log for an unreadable snapshot the log covers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = new FakeServer();
    const seed = new Y.Doc();
    addGuest(seed, 'p1', 'Alice');
    server.snapshot = { state: 'not valid base64!!', through_id: 1 };
    server.rows.push({ id: 1, update: encodeUpdate(Y.encodeStateAsUpdate(seed)) });
    server.nextId = 2;

    await track(makeProvider(server, new Y.Doc())).start();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('did not decode; using the log'),
      TRIP_ID,
    );
  });

  it('names the row it skips, and the row that would not apply', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = new FakeServer();
    const seed = new Y.Doc();
    addGuest(seed, 'p1', 'Alice');
    server.rows.push({ id: 1, update: 'not valid base64!!' });
    server.rows.push({ id: 2, update: encodeUpdate(new Uint8Array([255, 255, 255, 255])) });
    server.rows.push({ id: 3, update: encodeUpdate(Y.encodeStateAsUpdate(seed)) });
    server.nextId = 4;
    const doc = new Y.Doc();

    await track(makeProvider(server, doc)).start();

    expect(guestNames(doc)).toEqual(['Alice']);
    expect(warn).toHaveBeenCalledWith('[sync] skipping undecodable log row %d', 1);
    expect(warn).not.toHaveBeenCalledWith('[sync] log row %d did not apply:', 1, expect.anything());
    expect(warn).toHaveBeenCalledWith('[sync] log row %d did not apply:', 2, expect.anything());
  });

  it('publishes synced after a pull that recovers, with nothing else to do', async () => {
    fakeTimers();
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await io();

    // A pull that fails, from the realtime path, which runs no flush after it.
    server.failLogReads = 1;
    server.deliver({ id: 900, update: 'not valid base64!!' });
    await advance(800);
    expect(provider.getState().status).toBe('offline');

    server.deliver({ id: 901, update: 'not valid base64!!' });
    await advance(800);

    expect(provider.getState().status).toBe('synced');
  });
});

describe('retries', () => {
  it('backs off on a fixed schedule with jitter, and stays at a minute', async () => {
    fakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const server = new FakeServer();
    server.autoSubscribe = false;
    server.failLogReads = 99;
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    // Already on the server, so no successful push resets the count between.
    await recordServerStateFor(doc);
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await io();
    expect(server.readCalls).toBe(1);

    // base * 1.15 with a jitter of 0.5: 1150, 2300, 5750, 17250, 34500, 69000, 69000.
    let now = 0;
    let due = 0;
    for (const [index, delay] of [1_150, 2_300, 5_750, 17_250, 34_500, 69_000, 69_000].entries()) {
      due += delay;
      await advance(due - 30 - now, 1_000);
      now = due - 30;
      expect(server.readCalls).toBe(index + 1);
      await advance(60, 20);
      now += 60;
      expect(server.readCalls).toBe(index + 2);
    }
  });

  it('starts the backoff over once a pull succeeds and nothing is failing to send', async () => {
    fakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const server = new FakeServer();
    server.autoSubscribe = false;
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    await recordServerStateFor(doc);
    server.failLogReads = 1;
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await io();
    // Failed once; the retry a second later succeeds.
    await advance(1_100, 100);
    expect(server.readCalls).toBe(2);

    server.failLogReads = 1;
    await provider.syncNow();
    await io();
    const before = server.readCalls;

    // A first failure again, so a second, not two.
    await advance(1_100, 100);
    expect(server.readCalls).toBe(before + 1);
  });

  it('keeps backing off a failing push while pulls succeed', async () => {
    fakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const server = new FakeServer();
    server.autoSubscribe = false;
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    await recordServerStateFor(doc);
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await io();

    server.failWrites = 99;
    addGuest(doc, 'p2', 'Bob');
    await io();
    expect(server.insertCalls).toBe(1);

    // Retried after one second, then after two: a good pull in between does
    // not make the push look healthy again.
    await advance(1_100, 100);
    expect(server.insertCalls).toBe(2);
    await advance(1_500, 100);
    expect(server.insertCalls).toBe(2);
    await advance(600, 100);
    expect(server.insertCalls).toBe(3);
  });

  it('keeps one retry timer when both directions fail at once', async () => {
    fakeTimers();
    const server = new FakeServer();
    server.failLogReads = 99;
    server.failWrites = 99;
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const provider = track(makeProvider(server, doc));

    await provider.start();
    await io();

    // The channel's debounced pull is not scheduled on a fresh subscribe here:
    // count only what is left once that one has fired.
    await advance(800, 800);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('schedules no retry for a failure that lands after destroy', async () => {
    fakeTimers();
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const release = server.gateWrites();
    server.failWrites = 99;
    const provider = track(makeProvider(server, doc));
    const started = provider.start();
    await io();

    provider.destroy();
    release();
    await started;
    await io();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a failed push as offline, with its reason', async () => {
    const server = new FakeServer();
    server.failWrites = 99;
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const provider = track(makeProvider(server, doc));

    await provider.start();

    expect(provider.getState()).toMatchObject({
      status: 'offline',
      lastError: 'log write failed: write boom',
    });
  });

  it('reports a failed flush with its reason and what is still waiting', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();

    server.failWrites = 99;
    addGuest(doc, 'p1', 'Alice');
    await waitUntil(() => provider.getState().pendingCount === 1, 'the edit to be counted');
    await settle();

    expect(provider.getState()).toMatchObject({
      status: 'offline',
      pendingCount: 1,
      lastError: 'log write failed: write boom',
    });
  });

  it('does not try again in the same flush after a failure, even with more queued behind it', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await settle();

    const release = server.gateWrites();
    server.failWrites = 99;
    addGuest(doc, 'p1', 'Alice');
    await waitUntil(() => server.insertCalls === 1, 'the first send to be in flight');
    // Queued while that send is in flight, so the running flush is asked again.
    addGuest(doc, 'p2', 'Bob');
    await settle(6);
    release();
    await settle();

    expect(server.insertCalls).toBe(1);
  });
});

describe('the queue and the server state', () => {
  it('records the document as the server’s once an edit has gone up', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();

    addGuest(doc, 'p1', 'Alice');
    await waitUntil(async () => (await outbox.pendingCount(TRIP_ID)) === 0 && server.insertCalls === 1, 'the flush');
    await settle();

    const cursor = await readCursor(TRIP_ID);
    expect(Array.from(cursor.serverStateVector!)).toEqual(Array.from(Y.encodeStateVector(doc)));
  });

  it('records the document as the server’s after recovering an edit the queue lost', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();

    const enqueue = vi.spyOn(outbox, 'enqueue').mockRejectedValueOnce(new Error('storage evicted'));
    addGuest(doc, 'p1', 'Alice');
    await waitUntil(() => server.insertCalls === 1, 'the reconcile to send it');
    enqueue.mockRestore();
    await settle();

    // Then one more edit, sent the ordinary way.
    addGuest(doc, 'p2', 'Bob');
    await waitUntil(() => server.insertCalls === 2, 'the second edit');
    await settle();

    const cursor = await readCursor(TRIP_ID);
    expect(Array.from(cursor.serverStateVector!)).toEqual(Array.from(Y.encodeStateVector(doc)));
    expect(error).toHaveBeenCalledWith('[sync] failed to queue an update:', expect.any(Error));
  });

  it('retires the rows queued before start once the diff carried them', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    await outbox.enqueue(TRIP_ID, Y.encodeStateAsUpdate(doc));

    await track(makeProvider(server, doc)).start();
    await settle();

    expect(server.insertCalls).toBe(1);
    expect(await outbox.pendingCount(TRIP_ID)).toBe(0);
  });

  it('sends what is queued even when the server already holds the document', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    await recordServerStateFor(doc);
    await outbox.enqueue(TRIP_ID, Y.encodeStateAsUpdate(doc));

    await track(makeProvider(server, doc)).start();
    await settle();

    expect(server.insertCalls).toBe(1);
    expect(await outbox.pendingCount(TRIP_ID)).toBe(0);
  });

  it('does not send one row twice when two edits overlap a send', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await settle();

    const release = server.gateWrites();
    addGuest(doc, 'p1', 'Alice');
    await waitUntil(() => server.insertCalls === 1, 'the first send to be in flight');
    addGuest(doc, 'p2', 'Bob');
    await settle(6);
    release();
    await waitUntil(async () => (await outbox.pendingCount(TRIP_ID)) === 0, 'the queue to drain');
    await settle();

    expect(server.insertCalls).toBe(2);
  });

  it('runs one reconcile at a time', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const release = server.gateWrites();
    const provider = track(makeProvider(server, doc));
    const started = provider.start();
    await waitUntil(() => server.insertCalls === 1, 'the first upload to be in flight');

    // An edit whose queue row fails asks for a reconcile of its own.
    const enqueue = vi.spyOn(outbox, 'enqueue').mockRejectedValueOnce(new Error('storage evicted'));
    addGuest(doc, 'p2', 'Bob');
    await settle(6);
    enqueue.mockRestore();

    expect(server.insertCalls).toBe(1);
    release();
    await started;
    expect(error).toHaveBeenCalled();
  });

  it('says it is syncing while a send is in flight, whatever else finishes', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await settle();

    const release = server.gateWrites();
    addGuest(doc, 'p1', 'Alice');
    await waitUntil(() => server.insertCalls === 1, 'the send to be in flight');
    await provider.syncNow();

    expect(provider.getState().status).toBe('syncing');
    release();
    await settle();
  });

  it('publishes syncing when a flush starts sending', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const { provider, seen } = recordingProvider(server, doc);
    await provider.start();
    await settle();
    const before = seen.length;

    addGuest(doc, 'p1', 'Alice');
    await waitUntil(async () => (await outbox.pendingCount(TRIP_ID)) === 0 && server.insertCalls === 1, 'the flush');
    await settle();

    expect(seen.slice(before).map((state) => state.status)).toContain('syncing');
  });
});

describe('what a consumer is told', () => {
  it('is told when only the count of waiting edits changes', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const { provider, seen } = recordingProvider(server, doc);
    await provider.start();
    server.failWrites = 99;
    addGuest(doc, 'p1', 'Alice');
    await waitUntil(() => provider.getState().pendingCount === 1, 'one waiting');
    await settle();
    const before = seen.length;

    addGuest(doc, 'p2', 'Bob');
    await waitUntil(() => provider.getState().pendingCount === 2, 'two waiting');

    expect(seen.slice(before).some((state) => state.pendingCount === 2)).toBe(true);
  });

  it('is told when only the head count changes', async () => {
    const server = new FakeServer();
    const { provider, seen } = recordingProvider(server, new Y.Doc(), 'user-1');
    await provider.start();
    await settle();
    const before = seen.length;

    server.addPresence('someone-else');

    expect(seen.slice(before)).toEqual([expect.objectContaining({ onlineCount: 2 })]);
  });

  it('is told when only the reason for being offline changes', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    server.failLogReads = 1;
    const { provider, seen } = recordingProvider(server, doc);
    await provider.start();
    await settle();
    expect(provider.getState()).toMatchObject({ status: 'offline', lastError: 'log read failed: log boom' });
    const before = seen.length;

    server.failReads = 1;
    await provider.syncNow();

    expect(seen.slice(before)).toContainEqual(
      expect.objectContaining({ lastError: 'snapshot marker read failed: snapshot boom' }),
    );
  });
});

describe('compaction, at its edges', () => {
  function seedRows(server: FakeServer, rows: number, seed = new Y.Doc()): Y.Doc {
    for (let index = 0; index < rows; index += 1) {
      const before = Y.encodeStateVector(seed);
      addGuest(seed, `p${server.nextId}`, `Guest ${server.nextId}`);
      server.append(Y.encodeStateAsUpdate(seed, before));
    }
    return seed;
  }

  it('compacts at exactly two hundred rows', async () => {
    const server = new FakeServer();
    seedRows(server, 200);

    await track(makeProvider(server, new Y.Doc())).start();

    expect(server.snapshotPublishes).toHaveLength(1);
  });

  it('counts rows it sent towards the threshold', async () => {
    const server = new FakeServer();
    seedRows(server, 199);
    const doc = new Y.Doc();
    addGuest(doc, 'local', 'Local');
    const provider = track(makeProvider(server, doc));
    await provider.start();
    expect(server.snapshotPublishes).toHaveLength(0);

    await provider.syncNow();

    expect(server.snapshotPublishes).toHaveLength(1);
  });

  it('does not compact a log it has read nothing of', async () => {
    const server = new FakeServer();
    server.hideRows = true;
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();

    const release = server.gateWrites();
    for (let index = 0; index < 205; index += 1) {
      addGuest(doc, `p${index}`, `Guest ${index}`);
    }
    await settle(6);
    release();
    await waitUntil(async () => (await outbox.pendingCount(TRIP_ID)) === 0, 'the queue to drain', 3_000);
    await provider.syncNow();

    expect(server.rpcCalls).toBe(0);
  });

  it('tries again on the next pull after a refused publish, and only until one lands', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = new FakeServer();
    seedRows(server, 250);
    server.failPublishes = 1;
    const provider = track(makeProvider(server, new Y.Doc()));
    await provider.start();
    expect(server.snapshotPublishes).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith('[sync] could not publish a snapshot:', 'publish boom');

    await provider.syncNow();
    expect(server.snapshotPublishes).toHaveLength(1);
    const calls = server.rpcCalls;

    await provider.syncNow();
    expect(server.rpcCalls).toBe(calls);
  });

  it('survives a publish that throws, and tries again later', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = new FakeServer();
    seedRows(server, 250);
    server.throwPublishes = 1;
    const provider = track(makeProvider(server, new Y.Doc()));
    await provider.start();
    expect(warn).toHaveBeenCalledWith('[sync] snapshot publish threw:', expect.any(Error));

    await provider.syncNow();

    expect(server.snapshotPublishes).toHaveLength(1);
  });

  it('compacts again once it has seen enough more of the log', async () => {
    const server = new FakeServer();
    const seed = seedRows(server, 250);
    const provider = track(makeProvider(server, new Y.Doc()));
    await provider.start();
    expect(server.snapshotPublishes).toHaveLength(1);

    seedRows(server, 250, seed);
    await provider.syncNow();

    expect(server.snapshotPublishes).toHaveLength(2);
    expect(server.rpcCalls).toBe(2);
  });

  it('publishes the trip, its state and its cursor', async () => {
    const server = new FakeServer();
    seedRows(server, 200);
    const doc = new Y.Doc();

    await track(makeProvider(server, doc)).start();

    const published = server.snapshotPublishes[0]!;
    expect(published.trip_id).toBe(REMOTE_TRIP_ID);
    expect(published.through_id).toBe(200);
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, decode(published.state));
    expect(rebuilt.getMap('guestsById').size).toBe(200);
  });
});

describe('health after a partial send, and after recovery', () => {
  it('stays offline when one row went up and the next one did not', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await settle();

    // Both rows are read by one flush: the first send is held until both queue.
    const release = server.gateWrites();
    server.failNthWrite = 2;
    addGuest(doc, 'p1', 'Alice');
    addGuest(doc, 'p2', 'Bob');
    await waitUntil(async () => (await outbox.pendingCount(TRIP_ID)) === 2, 'both to queue');
    release();
    await waitUntil(() => server.insertCalls >= 2, 'the second send');
    await settle();

    expect(provider.getState()).toMatchObject({ status: 'offline', pendingCount: 1 });
  });

  it('reads as synced again once a retry sends what was waiting', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();
    server.failWrites = 1;
    addGuest(doc, 'p1', 'Alice');
    await waitUntil(() => provider.getState().status === 'offline', 'the failure');

    await provider.syncNow();
    await settle();

    expect(provider.getState()).toMatchObject({ status: 'synced', pendingCount: 0 });
  });

  it('does not claim an edit whose queue row is still being written was sent', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = new FakeServer();
    const doc = new Y.Doc();
    const provider = track(makeProvider(server, doc));
    await provider.start();
    await settle();

    // Alice queues at once; Bob's queue row fails, slowly, after Alice's
    // flush has finished and found the queue empty.
    const enqueue = outbox.enqueue;
    vi.spyOn(outbox, 'enqueue')
      .mockImplementationOnce(enqueue)
      .mockImplementationOnce(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 60);
        });
        throw new Error('storage evicted');
      });
    addGuest(doc, 'p1', 'Alice');
    addGuest(doc, 'p2', 'Bob');
    await waitUntil(() => error.mock.calls.length > 0, 'Bob to fail', 200);
    await waitUntil(() => server.rows.length >= 2, 'Bob to be sent by the backstop', 200);

    const rebuilt = new Y.Doc();
    for (const row of server.rows) {
      Y.applyUpdate(rebuilt, decode(row.update));
    }
    expect(guestNames(rebuilt)).toEqual(['Alice', 'Bob']);
  });

  it('tells a consumer about one more waiting edit while a send is in flight', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const { provider, seen } = recordingProvider(server, doc);
    await provider.start();
    await settle();

    const release = server.gateWrites();
    addGuest(doc, 'p1', 'Alice');
    await waitUntil(() => server.insertCalls === 1, 'the first send in flight');
    addGuest(doc, 'p2', 'Bob');
    await waitUntil(async () => (await outbox.pendingCount(TRIP_ID)) === 2, 'Bob to queue');
    await settle(4);

    expect(seen.some((state) => state.pendingCount === 2)).toBe(true);
    release();
    await settle();
  });

  it('says syncing while a failing pull is still running', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    addGuest(doc, 'p1', 'Alice');
    const { provider, seen } = recordingProvider(server, doc);
    await provider.start();
    await settle();
    expect(provider.getState().status).toBe('synced');
    const before = seen.length;

    server.failLogReads = 1;
    await provider.syncNow();

    expect(seen.slice(before).map((state) => state.status)).toContain('syncing');
  });

  it('publishes nothing about a flush that would start after destroy', async () => {
    const server = new FakeServer();
    const doc = new Y.Doc();
    const { provider, seen } = recordingProvider(server, doc);
    await provider.start();
    await settle();

    addGuest(doc, 'p1', 'Alice');
    provider.destroy();
    const before = seen.length;
    await settle();

    expect(seen.slice(before).map((state) => state.status)).not.toContain('syncing');
  });

  it('schedules no hydration retry for a pull that ends after destroy', async () => {
    fakeTimers();
    const server = new FakeServer();
    server.autoSubscribe = false;
    const provider = track(makeProvider(server, new Y.Doc()));
    await provider.start();
    await io();

    let release: () => void = () => {};
    server.readGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await advance(800);
    expect(server.readCalls).toBe(2);
    provider.destroy();
    server.readGate = null;
    release();
    await io();

    expect(vi.getTimerCount()).toBe(0);
  });
});

/** Records the document's own vector as what the server holds. */
async function recordServerStateFor(doc: Y.Doc): Promise<void> {
  const { recordServerState } = await import('@/lib/sync/cursors');
  await recordServerState(TRIP_ID, Y.encodeStateVector(doc));
}
