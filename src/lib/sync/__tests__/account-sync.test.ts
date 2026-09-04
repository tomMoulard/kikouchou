/**
 * @fileoverview Tests for the account-wide sweep.
 *
 * The feature is "sign in on the phone and on the laptop and see the same
 * trips", so the two happy paths — a local trip going up, a server trip coming
 * down — are the least interesting thing here. What earns the tests is
 * everything the sweep must *refuse* to do now that it runs unattended over
 * every trip on the device rather than over the one trip somebody is sharing:
 *
 * - never re-create a server row it merely cannot see, which on a device with a
 *   second account signed in would fork the trip;
 * - never push the document of a trip it did not link, because a joined trip
 *   that has not been opened here holds a placeholder name that would overwrite
 *   the owner's real one for everybody;
 * - never let one trip's failure strand the rest.
 *
 * The double is a small PostgREST-shaped fake rather than a per-call `vi.fn`,
 * because the sweep's whole job is composing four modules that each speak that
 * shape — and a fake that models rows can also model the thing the assertions
 * are actually about: a row this account is not allowed to see.
 *
 * @module lib/sync/__tests__/account-sync.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { syncAccountTrips } from '@/lib/sync/account-sync';
import { isoDate } from '@/test/utils';
import type { Trip } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

const USER = 'user-1';
const OTHER_USER = 'user-2';

interface ServerTrip {
  id: string;
  local_id: string;
  owner_id: string;
  name: string;
  start_date: string;
  end_date: string;
}

/**
 * A PostgREST-shaped query that resolves like the real client does.
 *
 * Thenable rather than promise-returning per method, because the calls under
 * test end on four different links of the chain — `.limit(1)`, `.select('id')`,
 * `.maybeSingle()` and the bare `.select('id, name')` — and only a thenable
 * builder answers all four without the fake having to guess which one is last.
 */
class FakeQuery<Row> implements PromiseLike<{ data: Row[] | null; error: unknown }> {
  private readonly filters: [string, unknown][] = [];
  private readonly error: unknown;
  private readonly rows: Row[];

  constructor(rows: Row[], error: unknown = null) {
    this.rows = rows;
    this.error = error;
  }

  select(): this {
    return this;
  }

  order(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  private matches(): Row[] {
    return this.rows.filter((row) =>
      this.filters.every(
        ([column, value]) => (row as Record<string, unknown>)[column] === value,
      ),
    );
  }

  then<TResult1 = { data: Row[] | null; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[] | null; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const result = this.error
      ? { data: null, error: this.error }
      : { data: this.matches(), error: null };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }

  async maybeSingle(): Promise<{ data: Row | null; error: unknown }> {
    if (this.error) {
      return { data: null, error: this.error };
    }
    return { data: this.matches()[0] ?? null, error: null };
  }

  async single(): Promise<{ data: Row | null; error: unknown }> {
    return await this.maybeSingle();
  }
}

/**
 * Enough of the server to run the sweep against.
 *
 * Models the one rule the sweep's safety depends on: a `trips` row is visible
 * only to its owner and its members. Everything else — the log, the snapshot
 * table — is a list.
 */
class FakeServer {
  readonly trips: ServerTrip[] = [];
  readonly docUpdates: { trip_id: string; update: string }[] = [];
  /** Trip ids whose INSERT should fail, to strand one trip and not the rest. */
  readonly refuseInsertFor = new Set<string>();

  private nextId = 1;
  private readonly callerId: string;

  constructor(callerId: string) {
    this.callerId = callerId;
  }

  /** Trips this caller may see, which is what RLS narrows a SELECT to. */
  private visibleTrips(): ServerTrip[] {
    return this.trips.filter((trip) => trip.owner_id === this.callerId);
  }

  seedTrip(trip: Omit<ServerTrip, 'id'> & { id?: string }): ServerTrip {
    const row: ServerTrip = { ...trip, id: trip.id ?? `remote-${this.nextId++}` };
    this.trips.push(row);
    return row;
  }

  get client(): never {
    // Arrow functions all the way down, so `this` stays the server rather than
    // the object literal being handed to the code under test.
    return {
      from: (table: string) => {
        if (table === 'trips') {
          return {
            select: () => new FakeQuery(this.visibleTrips()),
            insert: (values: Omit<ServerTrip, 'id'>) => {
              if (this.refuseInsertFor.has(values.local_id)) {
                return new FakeQuery<ServerTrip>([], { message: 'refused', code: '500' });
              }
              const duplicate = this.trips.find(
                (trip) =>
                  trip.owner_id === values.owner_id && trip.local_id === values.local_id,
              );
              if (duplicate) {
                return new FakeQuery<ServerTrip>([], {
                  message: 'duplicate key',
                  code: '23505',
                });
              }
              return new FakeQuery([this.seedTrip(values)]);
            },
            update: (values: Partial<ServerTrip>) => ({
              eq: (_column: string, id: unknown) => ({
                select: () => {
                  const row = this.visibleTrips().find((trip) => trip.id === id);
                  if (!row) {
                    return Promise.resolve({ data: [], error: null });
                  }
                  Object.assign(row, values);
                  return Promise.resolve({ data: [row], error: null });
                },
              }),
            }),
          };
        }

        if (table === 'trip_doc_updates') {
          return {
            select: () => new FakeQuery(this.docUpdates.map((_, index) => ({ id: index }))),
            insert: (values: { trip_id: string; update: string }) => {
              this.docUpdates.push(values);
              return Promise.resolve({ error: null });
            },
          };
        }

        // trip_doc_snapshots: nothing is ever compacted in these tests.
        return { select: () => new FakeQuery<{ through_id: number }>([]) };
      },
    } as never;
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function makeLocalTrip(name: string): Promise<Trip> {
  return await createTrip({
    name,
    startDate: isoDate('2026-07-15'),
    endDate: isoDate('2026-07-22'),
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('syncAccountTrips', () => {
  let server: FakeServer;

  beforeEach(() => {
    server = new FakeServer(USER);
    vi.restoreAllMocks();
  });

  describe('pushing this device to the account', () => {
    it('uploads a trip that has never been shared, and remembers its row', async () => {
      const trip = await makeLocalTrip('Brittany');

      const result = await syncAccountTrips(server.client, USER);

      expect(result.uploaded).toBe(1);
      expect(result.failed).toBe(0);

      // The row exists, owned by the account that signed in.
      const row = server.trips.find((candidate) => candidate.local_id === trip.id);
      expect(row).toMatchObject({ owner_id: USER, name: 'Brittany' });

      // And the device remembers it, which is what makes the sync provider mount
      // the next time the trip is opened.
      const stored = await db.trips.get(trip.id);
      expect(stored?.remoteTripId).toBe(row?.id);
    });

    it('uploads the document, not just the preview row', async () => {
      // A row with no document behind it is the failure the invitee sees as
      // "Getting the trip…" forever, and the sweep can open that gap in exactly
      // the same way sharing could.
      await makeLocalTrip('Brittany');

      await syncAccountTrips(server.client, USER);

      expect(server.docUpdates).toHaveLength(1);
      expect(server.docUpdates[0]?.update.length).toBeGreaterThan(0);
    });

    it('uploads every trip on the device, not only the open one', async () => {
      await makeLocalTrip('Brittany');
      await makeLocalTrip('Corsica');
      await makeLocalTrip('Ardèche');

      const result = await syncAccountTrips(server.client, USER);

      expect(result.uploaded).toBe(3);
      expect(server.trips).toHaveLength(3);
    });

    it('carries on when one trip cannot be uploaded', async () => {
      const doomed = await makeLocalTrip('Corsica');
      await makeLocalTrip('Brittany');
      server.refuseInsertFor.add(doomed.id);

      const result = await syncAccountTrips(server.client, USER);

      expect(result.failed).toBe(1);
      expect(result.uploaded).toBe(1);
      // The one that failed stays local-only, so the next sweep tries again.
      expect((await db.trips.get(doomed.id))?.remoteTripId).toBeUndefined();
    });

    it('re-links a trip whose row this account already has', async () => {
      // A reinstall, or a second device that lost its local pointer: the server
      // answers 23505 and the sweep must adopt the existing row rather than
      // treating the collision as a failure.
      const trip = await makeLocalTrip('Brittany');
      const existing = server.seedTrip({
        local_id: trip.id,
        owner_id: USER,
        name: 'Brittany',
        start_date: '2026-07-15',
        end_date: '2026-07-22',
      });
      await db.trips.update(trip.id, { remoteTripId: undefined });

      const result = await syncAccountTrips(server.client, USER);

      expect(result.failed).toBe(0);
      expect(server.trips).toHaveLength(1);
      expect((await db.trips.get(trip.id))?.remoteTripId).toBe(existing.id);
    });
  });

  describe('pulling the account onto this device', () => {
    it('materialises a trip that is on the account but not on this device', async () => {
      server.seedTrip({
        local_id: 'their-local-id',
        owner_id: USER,
        name: 'Corsica',
        start_date: '2026-08-01',
        end_date: '2026-08-08',
      });

      const result = await syncAccountTrips(server.client, USER);

      expect(result.downloaded).toBe(1);
      const local = await db.trips.toArray();
      expect(local).toHaveLength(1);
      expect(local[0]).toMatchObject({ name: 'Corsica', remoteTripId: 'remote-1' });
    });

    it('does not download a trip this device already has', async () => {
      const trip = await makeLocalTrip('Brittany');
      const row = server.seedTrip({
        local_id: trip.id,
        owner_id: USER,
        name: 'Brittany',
        start_date: '2026-07-15',
        end_date: '2026-07-22',
      });
      await db.trips.update(trip.id, { remoteTripId: row.id });

      const result = await syncAccountTrips(server.client, USER);

      expect(result.downloaded).toBe(0);
      expect(await db.trips.count()).toBe(1);
    });
  });

  describe('what it refuses to do', () => {
    it('leaves a trip belonging to another account exactly as it found it', async () => {
      // Two accounts on one device. The row is real, and invisible to this
      // session — which `ensureRemoteTrip` reads as "deleted, create a fresh
      // one". Doing that unattended would fork the trip and hand the copy to the
      // wrong owner, so the sweep must not go near a trip that already has a
      // server row.
      const trip = await makeLocalTrip('Brittany');
      const theirs = server.seedTrip({
        local_id: trip.id,
        owner_id: OTHER_USER,
        name: 'Brittany',
        start_date: '2026-07-15',
        end_date: '2026-07-22',
      });
      await db.trips.update(trip.id, { remoteTripId: theirs.id });

      const result = await syncAccountTrips(server.client, USER);

      expect(result.uploaded).toBe(0);
      expect(server.trips).toHaveLength(1);
      expect(server.trips[0]?.owner_id).toBe(OTHER_USER);
      expect((await db.trips.get(trip.id))?.remoteTripId).toBe(theirs.id);
    });

    it('never pushes the document of a trip it did not link', async () => {
      // A joined trip that has not been opened here yet holds a placeholder name
      // and no document. Uploading that as CRDT state would write the
      // placeholder over the owner's real name for every member.
      const trip = await makeLocalTrip('trips.untitled');
      await db.trips.update(trip.id, { remoteTripId: 'remote-owned-elsewhere' });

      await syncAccountTrips(server.client, USER);

      expect(server.docUpdates).toHaveLength(0);
    });

    it('does nothing at all when nobody is signed in', async () => {
      await makeLocalTrip('Brittany');

      const result = await syncAccountTrips(server.client, null);

      expect(result).toEqual({ uploaded: 0, downloaded: 0, failed: 0 });
      expect(server.trips).toHaveLength(0);
    });

    it('does nothing at all with no backend configured', async () => {
      await makeLocalTrip('Brittany');

      const result = await syncAccountTrips(null, USER);

      expect(result).toEqual({ uploaded: 0, downloaded: 0, failed: 0 });
    });
  });

  it('is idempotent: a second sweep moves nothing', async () => {
    await makeLocalTrip('Brittany');
    server.seedTrip({
      local_id: 'their-local-id',
      owner_id: USER,
      name: 'Corsica',
      start_date: '2026-08-01',
      end_date: '2026-08-08',
    });

    const first = await syncAccountTrips(server.client, USER);
    const second = await syncAccountTrips(server.client, USER);

    expect(first).toEqual({ uploaded: 1, downloaded: 1, failed: 0 });
    expect(second).toEqual({ uploaded: 0, downloaded: 0, failed: 0 });
    // Two trips, two rows: the sweep re-running must not litter either side.
    expect(await db.trips.count()).toBe(2);
    expect(server.trips).toHaveLength(2);
  });
});
