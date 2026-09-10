/**
 * @fileoverview Reading a trip through its invite link, with no account.
 *
 * The properties under test are the ones the member path already defends,
 * applied to a stranger holding a token: the payload is bounded on the way in,
 * the local id is the only write key, opening the same link twice yields one
 * trip, and — new here — nothing a viewer holds is ever treated as something to
 * send. The last one is what the recorded server state vector is for.
 *
 * @module lib/sync/__tests__/viewer.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { encodeUpdate } from '@/lib/sync/codec';
import { readCursor } from '@/lib/sync/cursors';
import { redeemInvite } from '@/lib/sync/invites';
import { claimParticipant } from '@/lib/sync/join-trip';
import {
  materialiseViewerTrip,
  readSharedTrip,
  refreshViewerTrip,
  upgradeViewerTrip,
} from '@/lib/sync/viewer';
import { syncDexieToDoc, syncTripMetaToDoc } from '@/lib/yjs/dexie-bridge';
import { stampDocSchemaVersion } from '@/lib/yjs/doc-model';
import { getTripGuestPersonId } from '@/lib/sharing/guest-identity';
import type { PersonId, ShareId, Trip, TripId, UnixTimestamp } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/lib/sync/invites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sync/invites')>();
  return { ...actual, redeemInvite: vi.fn() };
});

vi.mock('@/lib/sync/join-trip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sync/join-trip')>();
  return { ...actual, claimParticipant: vi.fn() };
});

// The device-local identity lives in `localStorage`, which this node-side suite
// does not have; what matters here is only whether one exists.
vi.mock('@/lib/sharing/guest-identity', () => ({ getTripGuestPersonId: vi.fn() }));

const mockedRedeem = vi.mocked(redeemInvite);
const mockedClaim = vi.mocked(claimParticipant);
const mockedIdentity = vi.mocked(getTripGuestPersonId);

// ============================================================================
// Helpers
// ============================================================================

const REMOTE_TRIP_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const TOKEN = 'tokentokentoken1';

/** A server-side document with a name and two guests, as the owner would write it. */
function ownerDocument(guests: readonly string[] = ['Alice', 'Bob']): Y.Doc {
  const doc = new Y.Doc();
  stampDocSchemaVersion(doc);
  syncTripMetaToDoc(doc, {
    name: 'Brittany',
    startDate: '2026-07-15',
    endDate: '2026-07-22',
    updatedAt: 1,
  });
  syncDexieToDoc(
    doc,
    'guests',
    guests.map((name) => ({
      id: `person-${name.toLowerCase()}`,
      name,
      color: '#ff0000',
    })),
    { allowDeletions: false },
  );
  return doc;
}

interface PayloadOptions {
  readonly doc?: Y.Doc;
  readonly snapshotThroughId?: number;
  readonly updates?: readonly { id: number; update: string }[];
  readonly hasMore?: boolean;
}

/** What `read_shared_trip` returns for the document, wire-shaped. */
function payloadFor({
  doc = ownerDocument(),
  snapshotThroughId,
  updates,
  hasMore = false,
}: PayloadOptions = {}): Record<string, unknown> {
  const whole = encodeUpdate(Y.encodeStateAsUpdate(doc));
  return {
    trip: {
      id: REMOTE_TRIP_ID,
      name: 'Brittany',
      start_date: '2026-07-15',
      end_date: '2026-07-22',
    },
    snapshot:
      snapshotThroughId === undefined ? null : { state: whole, through_id: snapshotThroughId },
    updates: updates ?? (snapshotThroughId === undefined ? [{ id: 1, update: whole }] : []),
    has_more: hasMore,
  };
}

/** A client whose `read_shared_trip` answers with the given pages, in order. */
function clientAnswering(...answers: readonly ({ data: unknown } | { error: unknown })[]) {
  let call = 0;
  const rpc = vi.fn(async () => {
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (answer === undefined) {
      throw new Error('the test asked for more pages than it scripted');
    }
    return 'error' in answer
      ? { data: null, error: answer.error }
      : { data: answer.data, error: null };
  });
  return { client: { rpc } as never, rpc };
}

async function seedMemberTrip(): Promise<TripId> {
  const now = Date.now() as UnixTimestamp;
  const trip: Trip = {
    id: 'member-trip' as TripId,
    name: 'Already joined',
    startDate: '2026-07-15' as Trip['startDate'],
    endDate: '2026-07-22' as Trip['endDate'],
    shareId: 'member1234' as ShareId,
    createdAt: now,
    updatedAt: now,
    remoteTripId: REMOTE_TRIP_ID,
  };
  await db.trips.add(trip);
  return trip.id;
}

beforeEach(() => {
  mockedRedeem.mockReset();
  mockedClaim.mockReset();
  mockedIdentity.mockReset();
  mockedIdentity.mockReturnValue(undefined);
});

// ============================================================================
// readSharedTrip
// ============================================================================

describe('readSharedTrip', () => {
  it('passes the token and the cursor to the function', async () => {
    const { client, rpc } = clientAnswering({ data: payloadFor() });

    await readSharedTrip(client, TOKEN, 42);

    expect(rpc).toHaveBeenCalledWith('read_shared_trip', {
      invite_token: TOKEN,
      after_id: 42,
    });
  });

  it.each([
    ['invite_not_found', 'not-found'],
    ['invite_revoked', 'revoked'],
    ['invite_expired', 'expired'],
    ['invite_exhausted', 'exhausted'],
  ])('maps the hint %s to %s, as redeem does', async (hint, status) => {
    const { client } = clientAnswering({ error: { message: 'no', hint } });

    // The same four reasons through both doors, so the person holding a dead
    // link reads the same explanation whichever way they came in.
    expect(await readSharedTrip(client, TOKEN)).toEqual({ status });
  });

  it('drops a malformed row on its own rather than failing the page', async () => {
    const good = encodeUpdate(Y.encodeStateAsUpdate(ownerDocument()));
    const { client } = clientAnswering({
      data: {
        trip: { id: REMOTE_TRIP_ID, name: 'Brittany', start_date: '2026-07-15', end_date: '2026-07-22' },
        snapshot: null,
        updates: [
          { id: 1, update: good },
          { id: 'two', update: good },
          { id: 3 },
          null,
          { id: -4, update: good },
        ],
        has_more: 'yes',
      },
    });

    const result = await readSharedTrip(client, TOKEN);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.payload.updates).toEqual([{ id: 1, update: good }]);
    // Anything but a literal true is "no more": a truthy string is not a page.
    expect(result.payload.hasMore).toBe(false);
  });

  it('refuses a payload with no usable trip in it', async () => {
    const { client } = clientAnswering({ data: { trip: { id: '' }, updates: [] } });

    expect(await readSharedTrip(client, TOKEN)).toMatchObject({ status: 'error' });
  });

  it('bounds the preview like the join path does', async () => {
    const { client } = clientAnswering({
      data: {
        trip: { id: REMOTE_TRIP_ID, name: 'x'.repeat(500), start_date: 'nope', end_date: 42 },
        snapshot: null,
        updates: [],
        has_more: false,
      },
    });

    const result = await readSharedTrip(client, TOKEN);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.payload.trip.name).toHaveLength(200);
    expect(result.payload.trip.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ============================================================================
// materialiseViewerTrip
// ============================================================================

describe('materialiseViewerTrip', () => {
  it('puts the trip on the device, read-only, with its guests', async () => {
    const { client } = clientAnswering({ data: payloadFor() });

    const result = await materialiseViewerTrip(client, TOKEN);

    expect(result.status).toBe('viewing');
    const tripId = (result as { tripId: TripId }).tripId;
    const trip = await db.trips.get(tripId);
    expect(trip).toMatchObject({
      name: 'Brittany',
      startDate: '2026-07-15',
      remoteTripId: REMOTE_TRIP_ID,
      viewerToken: TOKEN,
    });
    // The document was projected, so every page renders it like any other trip.
    const guests = await db.persons.where('tripId').equals(tripId).toArray();
    expect(guests.map((guest) => guest.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('records what the server holds, so nothing is ever pushed back', async () => {
    const { client } = clientAnswering({ data: payloadFor() });

    const result = await materialiseViewerTrip(client, TOKEN);
    const tripId = (result as { tripId: TripId }).tripId;

    const cursor = await readCursor(tripId);
    // The cursor is where the log was read up to; the vector is the document
    // as the server holds it. With the vector recorded, the provider that mounts
    // after a sign-in diffs against it and finds nothing to send — which is the
    // whole read-only guarantee expressed to the sync layer.
    expect(cursor.lastSeenUpdateId).toBe(1);
    expect(cursor.serverStateVector).toBeDefined();
    // And the updates are persisted, so the trip survives a reload offline.
    expect(await db.yjsUpdates.where('tripId').equals(tripId).count()).toBe(1);
  });

  it('opens the same link twice onto one trip', async () => {
    const { client } = clientAnswering({ data: payloadFor() });

    const first = await materialiseViewerTrip(client, TOKEN);
    const second = await materialiseViewerTrip(client, TOKEN);

    expect(second).toEqual(first);
    expect(await db.trips.where('remoteTripId').equals(REMOTE_TRIP_ID).count()).toBe(1);
    // Re-reading the whole document persists nothing new.
    expect(
      await db.yjsUpdates.where('tripId').equals((first as { tripId: TripId }).tripId).count(),
    ).toBe(1);
  });

  it('leaves a trip this device joined with an account exactly as it is', async () => {
    const memberTripId = await seedMemberTrip();
    const { client, rpc } = clientAnswering({ data: payloadFor() });

    const result = await materialiseViewerTrip(client, TOKEN);

    expect(result).toEqual({ status: 'member', tripId: memberTripId });
    // The account that joined outranks the link: no token is written onto it.
    expect((await db.trips.get(memberTripId))?.viewerToken).toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('applies the snapshot and reads the log after it', async () => {
    // One history: the snapshot is what compaction folded of this document, and
    // the row after it continues the same lineage. A row from an unrelated
    // document would sit pending in Yjs forever, waiting for structs that
    // never come — which is not a case the server can produce.
    const doc = ownerDocument(['Alice']);
    const snapshotDoc = new Y.Doc();
    Y.applyUpdate(snapshotDoc, Y.encodeStateAsUpdate(doc));
    const before = Y.encodeStateVector(doc);
    syncDexieToDoc(doc, 'guests', [
      { id: 'person-alice', name: 'Alice', color: '#ff0000' },
      { id: 'person-carol', name: 'Carol', color: '#00ff00' },
    ], { allowDeletions: false });
    const afterSnapshot = encodeUpdate(Y.encodeStateAsUpdate(doc, before));

    const { client } = clientAnswering({
      data: payloadFor({
        doc: snapshotDoc,
        snapshotThroughId: 10,
        updates: [{ id: 11, update: afterSnapshot }],
      }),
    });

    const result = await materialiseViewerTrip(client, TOKEN);
    const tripId = (result as { tripId: TripId }).tripId;

    const guests = await db.persons.where('tripId').equals(tripId).toArray();
    expect(guests.map((guest) => guest.name).sort()).toEqual(['Alice', 'Carol']);
    expect((await readCursor(tripId)).lastSeenUpdateId).toBe(11);
  });

  it('keeps asking while the server says there is more', async () => {
    const doc = ownerDocument();
    const whole = encodeUpdate(Y.encodeStateAsUpdate(doc));
    const { client, rpc } = clientAnswering(
      { data: payloadFor({ doc, updates: [{ id: 1, update: whole }], hasMore: true }) },
      { data: payloadFor({ doc, updates: [{ id: 2, update: whole }], hasMore: false }) },
    );

    const result = await materialiseViewerTrip(client, TOKEN);

    expect(result.status).toBe('viewing');
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('read_shared_trip', {
      invite_token: TOKEN,
      after_id: 1,
    });
  });

  it('reports a dead link without creating anything', async () => {
    const { client } = clientAnswering({ error: { message: 'no', hint: 'invite_expired' } });

    expect(await materialiseViewerTrip(client, TOKEN)).toEqual({ status: 'expired' });
    expect(await db.trips.count()).toBe(0);
  });
});

// ============================================================================
// refreshViewerTrip
// ============================================================================

describe('refreshViewerTrip', () => {
  it("applies the members' later edits into the live document and Dexie", async () => {
    const serverDoc = ownerDocument();
    const { client } = clientAnswering({ data: payloadFor({ doc: serverDoc }) });
    const opened = await materialiseViewerTrip(client, TOKEN);
    const tripId = (opened as { tripId: TripId }).tripId;

    // The live document, as `useTripDoc` would rebuild it from what was persisted.
    const live = new Y.Doc();
    for (const row of await db.yjsUpdates.where('tripId').equals(tripId).toArray()) {
      Y.applyUpdate(live, row.update);
    }

    // A member renames Bob after the viewer opened the trip.
    const before = Y.encodeStateVector(serverDoc);
    syncDexieToDoc(serverDoc, 'guests', [
      { id: 'person-alice', name: 'Alice', color: '#ff0000' },
      { id: 'person-bob', name: 'Bobby', color: '#ff0000' },
    ], { allowDeletions: false });
    const rename = encodeUpdate(Y.encodeStateAsUpdate(serverDoc, before));
    const { client: later } = clientAnswering({
      data: payloadFor({ doc: serverDoc, updates: [{ id: 2, update: rename }] }),
    });

    const result = await refreshViewerTrip(later, live, tripId, TOKEN);

    expect(result).toEqual({ status: 'updated' });
    const bob = await db.persons.get('person-bob' as never);
    expect(bob?.name).toBe('Bobby');
    expect((await readCursor(tripId)).lastSeenUpdateId).toBe(2);
  });

  it('says the copy is current when nothing arrived', async () => {
    const serverDoc = ownerDocument();
    const { client } = clientAnswering({ data: payloadFor({ doc: serverDoc }) });
    const opened = await materialiseViewerTrip(client, TOKEN);
    const tripId = (opened as { tripId: TripId }).tripId;
    const live = new Y.Doc();
    Y.applyUpdate(live, Y.encodeStateAsUpdate(serverDoc));

    const { client: quiet } = clientAnswering({
      data: payloadFor({ doc: serverDoc, updates: [] }),
    });

    expect(await refreshViewerTrip(quiet, live, tripId, TOKEN)).toEqual({ status: 'current' });
  });

  it('overwrites a row a viewer somehow wrote locally', async () => {
    const serverDoc = ownerDocument();
    const { client } = clientAnswering({ data: payloadFor({ doc: serverDoc }) });
    const opened = await materialiseViewerTrip(client, TOKEN);
    const tripId = (opened as { tripId: TripId }).tripId;
    const live = new Y.Doc();
    Y.applyUpdate(live, Y.encodeStateAsUpdate(serverDoc));

    // A stray local write on a read-only trip — a missed control, a bug.
    await db.persons.add({
      id: 'person-stray' as never,
      tripId,
      name: 'Stray',
      color: '#000000' as never,
    });

    const { client: quiet } = clientAnswering({
      data: payloadFor({ doc: serverDoc, updates: [] }),
    });
    await refreshViewerTrip(quiet, live, tripId, TOKEN);

    // The server's view of the trip is the only view: the row is gone, and it
    // never reached the document to be pushed anywhere.
    expect(await db.persons.get('person-stray' as never)).toBeUndefined();
    expect(live.getMap('guestsById').has('person-stray')).toBe(false);
  });

  it('reports a link that died since the trip was opened', async () => {
    const serverDoc = ownerDocument();
    const { client } = clientAnswering({ data: payloadFor({ doc: serverDoc }) });
    const opened = await materialiseViewerTrip(client, TOKEN);
    const tripId = (opened as { tripId: TripId }).tripId;
    const live = new Y.Doc();

    const { client: dead } = clientAnswering({ error: { message: 'no', hint: 'invite_revoked' } });

    // The local copy stays readable; only the refresh stops.
    expect(await refreshViewerTrip(dead, live, tripId, TOKEN)).toEqual({ status: 'revoked' });
    expect(await db.trips.get(tripId)).toBeDefined();
  });
});

// ============================================================================
// upgradeViewerTrip
// ============================================================================

describe('upgradeViewerTrip', () => {
  async function viewerTrip(): Promise<Trip> {
    const { client } = clientAnswering({ data: payloadFor() });
    const opened = await materialiseViewerTrip(client, TOKEN);
    const trip = await db.trips.get((opened as { tripId: TripId }).tripId);
    if (!trip) {
      throw new Error('viewer trip was not created');
    }
    return trip;
  }

  it('redeems the token and turns the trip into a member trip', async () => {
    const trip = await viewerTrip();
    mockedRedeem.mockResolvedValue({ status: 'joined', remoteTripId: REMOTE_TRIP_ID });

    const result = await upgradeViewerTrip({} as never, 'user-1', trip);

    expect(result).toEqual({ status: 'upgraded' });
    expect(mockedRedeem).toHaveBeenCalledWith(expect.anything(), TOKEN);
    const after = await db.trips.get(trip.id);
    // The same row, the same document: only the way it is held changes.
    expect(after?.viewerToken).toBeUndefined();
    expect(after?.remoteTripId).toBe(REMOTE_TRIP_ID);
  });

  it('carries the identity chosen while signed out onto the roster', async () => {
    const trip = await viewerTrip();
    mockedIdentity.mockReturnValue('person-alice' as PersonId);
    mockedRedeem.mockResolvedValue({ status: 'joined', remoteTripId: REMOTE_TRIP_ID });
    mockedClaim.mockResolvedValue({ status: 'claimed' });

    await upgradeViewerTrip({} as never, 'user-1', trip);

    expect(mockedClaim).toHaveBeenCalledWith(
      expect.anything(),
      REMOTE_TRIP_ID,
      'user-1',
      'person-alice',
    );
    expect(await db.tripMembers.get([trip.id, 'user-1'])).toMatchObject({
      personId: 'person-alice',
    });
  });

  it('leaves a name somebody else took unclaimed, and still upgrades', async () => {
    const trip = await viewerTrip();
    mockedIdentity.mockReturnValue('person-alice' as PersonId);
    mockedRedeem.mockResolvedValue({ status: 'joined', remoteTripId: REMOTE_TRIP_ID });
    mockedClaim.mockResolvedValue({ status: 'taken' });

    const result = await upgradeViewerTrip({} as never, 'user-1', trip);

    expect(result).toEqual({ status: 'upgraded' });
    expect(await db.tripMembers.get([trip.id, 'user-1'])).toBeUndefined();
  });

  it('keeps the trip read-only when the token is dead', async () => {
    const trip = await viewerTrip();
    mockedRedeem.mockResolvedValue({ status: 'expired' });

    const result = await upgradeViewerTrip({} as never, 'user-1', trip);

    expect(result).toEqual({ status: 'expired' });
    expect((await db.trips.get(trip.id))?.viewerToken).toBe(TOKEN);
  });

  it('does nothing to a member trip', async () => {
    const memberTripId = await seedMemberTrip();
    const trip = await db.trips.get(memberTripId);

    expect(await upgradeViewerTrip({} as never, 'user-1', trip!)).toEqual({
      status: 'already-member',
    });
    expect(mockedRedeem).not.toHaveBeenCalled();
  });

  it('refuses to relink a trip to a token that opens another one', async () => {
    const trip = await viewerTrip();
    mockedRedeem.mockResolvedValue({
      status: 'joined',
      remoteTripId: 'bbbbbbbb-0000-0000-0000-000000000002',
    });

    const result = await upgradeViewerTrip({} as never, 'user-1', trip);

    expect(result).toMatchObject({ status: 'error' });
    expect((await db.trips.get(trip.id))?.remoteTripId).toBe(REMOTE_TRIP_ID);
  });
});
