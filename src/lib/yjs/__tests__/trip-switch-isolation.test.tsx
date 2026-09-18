/**
 * Repro: switching trips moved the previous trip's guests into the new one.
 *
 * Reported from a real session: a trip was shared with a device that already
 * had another trip. The newly joined trip came up holding the *other* trip's
 * guests, and the other trip was left with none. Not a copy — a move.
 *
 * ## RED
 *
 * `YjsSyncObserver` reads each collection with `useLiveQuery` and writes it into
 * whatever document `YjsProvider` currently holds. Both are keyed on `tripId`,
 * which looks like it makes them agree. It does not, because they do not change
 * at the same moment:
 *
 *   - `useTripDoc` swaps the document in a `setState` once
 *     `loadPersistedUpdates` resolves. For a freshly joined trip that read
 *     returns nothing, so it resolves almost immediately.
 *   - `useLiveQuery` keeps its previous result in a ref across a deps change —
 *     `useObservable` only seeds `monitor.current.result` when `hasResult` is
 *     false, and it has been true since the first trip. So it goes on returning
 *     the *old* trip's rows until the new query emits.
 *
 * Between those two moments the observer holds the new trip's document and the
 * old trip's guests, and every sync effect fires on that pair — its deps
 * (`tripId`, `doc`, `loaded`) all just changed. The old trip's guests are
 * written into the new trip's document as genuine CRDT content: persisted to
 * `yjsUpdates`, queued to the outbox, and pushed to every other member.
 *
 * The move follows on the next projection. `syncDocToDexie` writes the document
 * back as `{...guest, tripId: newTrip}` through `bulkPut`, which is keyed on the
 * guest's own `id` — so the existing row is not duplicated, it is *rewritten*
 * onto the new trip. The old trip is then empty, which is exactly what was
 * reported.
 *
 * Both halves are asserted below: the poisoning at its source, and the data
 * loss it causes.
 *
 * @module lib/yjs/__tests__/trip-switch-isolation.test
 */

import { type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { loadPersistedUpdates, syncDocToDexie } from '@/lib/yjs/dexie-bridge';
import { readDocCollection } from '@/lib/yjs/doc-model';
import {
  createTestPerson,
  createTestTrip,
  render,
  screen,
  waitFor,
  waitForDb,
} from '@/test/utils';
import type { TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

/**
 * The trip's document as a reload would rebuild it — from the updates that were
 * actually persisted, rather than from a handle reached out of the React tree.
 * What is in here is what the device carries into the next session and what the
 * outbox pushes to everybody else.
 */
async function readPersistedDoc(tripId: TripId): Promise<Y.Doc> {
  const doc = new Y.Doc();
  await loadPersistedUpdates(doc, tripId);
  return doc;
}

function guestNamesIn(doc: Y.Doc): string[] {
  return readDocCollection(doc, 'guests')
    .map((guest) => String(guest.name))
    .sort();
}

async function guestNamesOf(tripId: TripId): Promise<string[]> {
  const guests = await db.persons.where('tripId').equals(tripId).toArray();
  return guests.map((guest) => guest.name).sort();
}

/** Drives the trip switch the way the app does — through `TripContext`. */
function TripSwitcher({
  tripA,
  tripB,
}: {
  readonly tripA: TripId;
  readonly tripB: TripId;
}): ReactElement {
  const { currentTrip, setCurrentTrip } = useTripContext();

  return (
    <div>
      <span data-testid="current-trip">{currentTrip?.name ?? 'none'}</span>
      <button onClick={() => void setCurrentTrip(tripA)}>open A</button>
      <button onClick={() => void setCurrentTrip(tripB)}>open B</button>
    </div>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('switching trips does not move the previous trip’s contents', () => {
  it('leaves the newly opened trip’s document empty of the other trip’s guests', async () => {
    const oldTrip = await createTestTrip({
      name: '30yo',
      startDate: '2024-07-01',
      endDate: '2024-07-07',
    });
    await createTestPerson(oldTrip, { name: 'Alice' });
    await createTestPerson(oldTrip, { name: 'Bob' });

    // The freshly joined trip: a local row and nothing else, which is exactly
    // what `materialiseJoinedTrip` leaves behind.
    const newTrip = await createTestTrip({
      name: '60 and de ma et engu',
      startDate: '2024-08-01',
      endDate: '2024-08-07',
    });

    const { user } = render(<TripSwitcher tripA={oldTrip} tripB={newTrip} />);

    // Open the old trip first and let it settle, so the live queries are holding
    // its rows when the switch happens.
    await user.click(screen.getByRole('button', { name: 'open A' }));
    await waitFor(async () => {
      expect(guestNamesIn(await readPersistedDoc(oldTrip))).toEqual(['Alice', 'Bob']);
    });

    // Now switch to the joined trip, the way opening it from the trip list does.
    await user.click(screen.getByRole('button', { name: 'open B' }));

    // Wait for the new trip's document to have been populated at all, so the
    // assertion below is about what the observer wrote and not about having
    // looked too early.
    await waitFor(async () => {
      const doc = await readPersistedDoc(newTrip);
      expect(doc.getMap('meta').get('name')).toBe('60 and de ma et engu');
    });
    await waitForDb(50);

    expect(guestNamesIn(await readPersistedDoc(newTrip))).toEqual([]);
  });

  it('leaves the other trip’s guests on the other trip once the document projects', async () => {
    const oldTrip = await createTestTrip({
      name: '30yo',
      startDate: '2024-07-01',
      endDate: '2024-07-07',
    });
    await createTestPerson(oldTrip, { name: 'Alice' });
    await createTestPerson(oldTrip, { name: 'Bob' });

    const newTrip = await createTestTrip({
      name: '60 and de ma et engu',
      startDate: '2024-08-01',
      endDate: '2024-08-07',
    });

    const { user } = render(<TripSwitcher tripA={oldTrip} tripB={newTrip} />);

    await user.click(screen.getByRole('button', { name: 'open A' }));
    await waitFor(async () => {
      expect(guestNamesIn(await readPersistedDoc(oldTrip))).toEqual(['Alice', 'Bob']);
    });

    await user.click(screen.getByRole('button', { name: 'open B' }));
    await waitFor(async () => {
      const doc = await readPersistedDoc(newTrip);
      expect(doc.getMap('meta').get('name')).toBe('60 and de ma et engu');
    });
    await waitForDb(50);

    // The projection a reload or any remote update performs. This is the step
    // that turns a poisoned document into lost data, because `bulkPut` is keyed
    // on the guest id and rewrites the row's `tripId`.
    await syncDocToDexie(await readPersistedDoc(newTrip), newTrip);

    expect(await guestNamesOf(oldTrip)).toEqual(['Alice', 'Bob']);
    expect(await guestNamesOf(newTrip)).toEqual([]);
  });
});
