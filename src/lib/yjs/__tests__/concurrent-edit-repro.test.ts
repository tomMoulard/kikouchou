/**
 * Repro: concurrent edits from two peers duplicated every row.
 *
 * Asserted at the boundary the user actually feels — what lands in Dexie, which
 * is what every screen reads through `useLiveQuery`. That keeps the test honest
 * across the internal change: it says nothing about how the document is shaped,
 * only that two people editing one trip end up with one correct guest list.
 *
 * ## RED
 *
 * `syncDexieToDoc` replaced the whole collection on every change
 * (`array.delete(0, array.length)` then re-push). Two peers doing that
 * concurrently keep *both* deletion sets and *both* insertion sets, so the
 * merged `Y.Array` holds every peer's copy of every row — for two guests plus
 * one concurrent add and one concurrent rename:
 *
 *     p1=Alice  p2=Bobby  p1=Alice  p2=Bob  p3=Carol      (5 entries, 3 guests)
 *
 * That duplication never reaches a screen, because `syncDocToDexie` writes
 * through `bulkPut`, which is keyed on `id` and collapses the copies. What the
 * user sees instead is the *last* copy of each id winning arbitrarily, which
 * produces two quieter and worse failures:
 *
 *   - **A concurrent edit is silently lost**, when the stale copy of an id lands
 *     after the fresh one:
 *
 *         AssertionError: expected [ 'Alice', 'Bob', 'Carol' ]
 *                         to deeply equal [ 'Alice', 'Bobby', 'Carol' ]
 *         - "Bobby"
 *         + "Bob"
 *
 *     Which copy lands last follows Yjs's clientID ordering, and clientIDs are
 *     random per document, so against the old model this case failed on roughly
 *     one run in three. It asserts the right behaviour and it is worth keeping,
 *     but it is *not* the deterministic gate — the next one is.
 *
 *   - **A deletion is undone**, on every run. One peer removes a guest while the
 *     other edits anyone at all; the other peer's re-push still carries the
 *     removed row, so it comes back:
 *
 *         AssertionError: expected [ 'Alicia', 'Bob' ] to deeply equal [ 'Alicia' ]
 *
 * Measured over 6 runs against the pre-fix bridge: 1 or 2 of these 4 cases fail
 * each time, never zero.
 *
 * Both docs are byte-identical after merging, so the CRDT is behaving exactly as
 * specified — the model is wrong, not Yjs. The old transports hid it: the QR
 * flow is turn-taking, and y-webrtc needs both peers online on one LAN, so the
 * concurrency window was tiny. A server-persisted log removes that cover, which
 * is why this had to be fixed before the backend landed.
 *
 * @module lib/yjs/__tests__/concurrent-edit-repro.test
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import {
  populateDocFromDexie,
  syncDexieToDoc,
  syncDocToDexie,
} from '@/lib/yjs/dexie-bridge';
import { isoDate } from '@/test/utils';
import type { HexColor, Person, PersonId, Trip, TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

async function seedSharedTrip(): Promise<Trip> {
  const trip = await createTrip({
    name: 'Shared trip',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-20'),
  });
  return (await db.trips.get(trip.id)) as Trip;
}

/** A guest as it travels through the document: plain fields, no `tripId`. */
interface DocGuest {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

function guest(id: string, name: string, color = '#ff0000'): DocGuest {
  return { id, name, color };
}

/** The same guest as Dexie stores it. */
function personRow(tripId: TripId, entry: DocGuest): Person {
  return {
    id: entry.id as PersonId,
    tripId,
    name: entry.name,
    color: entry.color as HexColor,
  };
}

/**
 * What `YjsTripSync` does when Dexie changes: hand the collection to the doc.
 *
 * `allowDeletions: true` because every device in this file is one that has
 * synced — the point of these tests is how two complete, diverged replicas
 * merge, and a deletion has to be able to travel for that to mean anything. A
 * device whose Dexie is *not* known to mirror its document is a different
 * scenario, covered in `trip-integrity.test.ts`.
 */
function pushGuests(doc: Y.Doc, guests: readonly DocGuest[]): void {
  syncDexieToDoc(
    doc,
    'guests',
    guests.map((entry) => ({ ...entry })),
    { allowDeletions: true },
  );
}

/** Two docs sharing a common history, as two devices already on the trip. */
async function joinedPair(tripId: TripId): Promise<[Y.Doc, Y.Doc]> {
  const host = new Y.Doc();
  await populateDocFromDexie(host, tripId);
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(host));
  return [host, peer];
}

function reconcile(left: Y.Doc, right: Y.Doc): void {
  const leftState = Y.encodeStateAsUpdate(left);
  const rightState = Y.encodeStateAsUpdate(right);
  Y.applyUpdate(left, rightState);
  Y.applyUpdate(right, leftState);
}

async function personNames(tripId: TripId): Promise<string[]> {
  const persons = await db.persons.where('tripId').equals(tripId).toArray();
  return persons.map((person) => person.name).sort();
}

// ============================================================================
// Tests
// ============================================================================

describe('concurrent edits from two peers', () => {
  it('does not duplicate guests when one peer adds while the other renames', async () => {
    const trip = await seedSharedTrip();
    await db.persons.bulkAdd([
      personRow(trip.id, guest('p1', 'Alice')),
      personRow(trip.id, guest('p2', 'Bob', '#00ff00')),
    ]);

    const [host, peer] = await joinedPair(trip.id);

    // Host adds Carol. Peer renames Bob. Neither has seen the other's change.
    pushGuests(host, [
      guest('p1', 'Alice'),
      guest('p2', 'Bob', '#00ff00'),
      guest('p3', 'Carol', '#0000ff'),
    ]);
    pushGuests(peer, [guest('p1', 'Alice'), guest('p2', 'Bobby', '#00ff00')]);

    reconcile(host, peer);
    await syncDocToDexie(host, trip.id);

    expect(await personNames(trip.id)).toEqual(['Alice', 'Bobby', 'Carol']);
  });

  it('keeps both peers on the same guest list after merging', async () => {
    const trip = await seedSharedTrip();
    await db.persons.add(personRow(trip.id, guest('p1', 'Alice')));

    const [host, peer] = await joinedPair(trip.id);

    pushGuests(host, [guest('p1', 'Alice'), guest('p2', 'Bob', '#00ff00')]);
    pushGuests(peer, [guest('p1', 'Alice'), guest('p3', 'Carol', '#0000ff')]);

    reconcile(host, peer);

    await syncDocToDexie(host, trip.id);
    const fromHost = await personNames(trip.id);
    await syncDocToDexie(peer, trip.id);
    const fromPeer = await personNames(trip.id);

    expect(fromHost).toEqual(['Alice', 'Bob', 'Carol']);
    expect(fromPeer).toEqual(fromHost);
  });

  it('does not resurrect a guest one peer deleted while the other edited', async () => {
    const trip = await seedSharedTrip();
    await db.persons.bulkAdd([
      personRow(trip.id, guest('p1', 'Alice')),
      personRow(trip.id, guest('p2', 'Bob', '#00ff00')),
    ]);

    const [host, peer] = await joinedPair(trip.id);

    // Host removes Bob. Peer, not yet knowing, renames Alice.
    pushGuests(host, [guest('p1', 'Alice')]);
    pushGuests(peer, [guest('p1', 'Alicia'), guest('p2', 'Bob', '#00ff00')]);

    reconcile(host, peer);
    await syncDocToDexie(host, trip.id);

    expect(await personNames(trip.id)).toEqual(['Alicia']);
  });

  it('survives a long offline divergence without losing or duplicating rows', async () => {
    const trip = await seedSharedTrip();
    await db.persons.add(personRow(trip.id, guest('p1', 'Alice')));

    const [host, peer] = await joinedPair(trip.id);

    // Each device edits repeatedly while it cannot see the other.
    const hostGuests: DocGuest[] = [guest('p1', 'Alice')];
    const peerGuests: DocGuest[] = [guest('p1', 'Alice')];
    for (let index = 0; index < 10; index += 1) {
      hostGuests.push(guest(`h${index}`, `Host ${index}`));
      peerGuests.push(guest(`g${index}`, `Guest ${index}`));
      pushGuests(host, hostGuests);
      pushGuests(peer, peerGuests);
    }

    reconcile(host, peer);
    await syncDocToDexie(host, trip.id);

    // 1 shared + 10 + 10, nothing lost, nothing doubled.
    const names = await personNames(trip.id);
    expect(names).toHaveLength(21);
    expect(new Set(names).size).toBe(21);
  });
});
