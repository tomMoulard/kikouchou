/**
 * @fileoverview A viewer trip's document is never written from this device.
 *
 * ## Why this matters
 *
 * A trip opened from an invite link with no account holds the server's
 * document, replayed. `YjsSyncObserver` normally writes Dexie back into the
 * document — `populateDocFromDexie` on open, `syncDexieToDoc` on every change —
 * and for a member trip that is the whole point. For a viewer trip it is a
 * hazard: the Dexie rows are a projection taken at some earlier moment, and
 * written back as new CRDT items they rank ahead of whatever the members wrote
 * since. The day the viewer signs in, `reconcile()` pushes them over
 * everybody's copy.
 *
 * So the observer must write nothing for a viewer trip, and this asserts it the
 * way the trip-switch test does: by reading back the document as a reload would
 * rebuild it, from the persisted updates.
 *
 * @module lib/yjs/__tests__/viewer-read-only.test
 */

import { type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { loadPersistedUpdates } from '@/lib/yjs/dexie-bridge';
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

function TripOpener({ tripId }: { readonly tripId: TripId }): ReactElement {
  const { currentTrip, setCurrentTrip } = useTripContext();

  return (
    <div>
      <span data-testid="current-trip">{currentTrip?.name ?? 'none'}</span>
      <button onClick={() => void setCurrentTrip(tripId)}>open</button>
    </div>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('opening a viewer trip', () => {
  it('writes nothing from Dexie into its document', async () => {
    // What `materialiseViewerTrip` leaves behind: a row that reads through a
    // token, and the projected guests. No persisted updates yet, which is the
    // case where `populateDocFromDexie` would otherwise fire.
    const tripId = await createTestTrip({
      name: 'Read-only Brittany',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
    });
    await db.trips.update(tripId, {
      remoteTripId: 'aaaaaaaa-0000-0000-0000-000000000001',
      viewerToken: 'tokentokentoken1',
    });
    await createTestPerson(tripId, { name: 'Alice' });
    await createTestPerson(tripId, { name: 'Bob' });

    const { user } = render(<TripOpener tripId={tripId} />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await waitFor(() => {
      expect(screen.getByTestId('current-trip')).toHaveTextContent('Read-only Brittany');
    });
    // Long enough for every observer effect to have fired if it was going to.
    await waitForDb(100);

    const doc = await readPersistedDoc(tripId);
    expect(guestNamesIn(doc)).toEqual([]);
    expect(doc.getMap('meta').get('name')).toBeUndefined();
    expect(await db.yjsUpdates.where('tripId').equals(tripId).count()).toBe(0);
  });

  it('still writes a member trip, so the guard is the token and not a regression', async () => {
    const tripId = await createTestTrip({
      name: 'Editable Brittany',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
    });
    await createTestPerson(tripId, { name: 'Alice' });

    const { user } = render(<TripOpener tripId={tripId} />);
    await user.click(screen.getByRole('button', { name: 'open' }));

    await waitFor(async () => {
      expect(guestNamesIn(await readPersistedDoc(tripId))).toEqual(['Alice']);
    });
  });
});
