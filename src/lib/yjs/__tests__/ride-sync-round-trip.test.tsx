/**
 * Repro: a car arranged on this device vanished the next time anything synced.
 *
 * ## RED
 *
 * `syncDocToDexie` is a *replacement*. It treats the document as the shared
 * truth and deletes every local row the document does not hold — correct, and
 * the same thing it has always done for guests, rooms, assignments and
 * transports.
 *
 * It only stays correct while every table Dexie holds also travels the other
 * way. `YjsSyncObserver` pushes Dexie into the document with one hand-written
 * effect per collection, and when rides and vehicles were added to the
 * doc→Dexie half they were not added to that list. So they were write-only from
 * the user's point of view: created locally, never published, absent from the
 * document, and deleted by the very next projection — which any edit by any
 * member of the trip triggers.
 *
 * Nothing looked wrong at either end. The projection was behaving exactly as
 * designed, and the repository wrote the row it was asked to write.
 *
 * This asserts both halves, because they fail for the same reason and only one
 * of them is visible to the person who lost the car: the ride reaching the
 * document at all (so the rest of the trip ever learns who is driving), and the
 * ride surviving the projection that follows (so it is still there afterwards).
 *
 * @module lib/yjs/__tests__/ride-sync-round-trip.test
 */

import { type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { createRide } from '@/lib/db/repositories/ride-repository';
import { createVehicle } from '@/lib/db/repositories/vehicle-repository';
import { loadPersistedUpdates, syncDocToDexie } from '@/lib/yjs/dexie-bridge';
import { readDocCollection } from '@/lib/yjs/doc-model';
import {
  createTestTrip,
  render,
  screen,
  waitFor,
  waitForTripDoc,
} from '@/test/utils';
import type { TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

/**
 * The trip's document as a reload would rebuild it — from the updates actually
 * persisted, rather than from a handle reached out of the React tree. What is
 * in here is what the device carries into the next session and what the outbox
 * pushes to everybody else.
 */
async function readPersistedDoc(tripId: TripId): Promise<Y.Doc> {
  const doc = new Y.Doc();
  await loadPersistedUpdates(doc, tripId);
  return doc;
}

/** Opens a trip the way the app does — through `TripContext`. */
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

describe('a car arranged locally reaches the shared document', () => {
  it('publishes the ride and its vehicle, and keeps them after a projection', async () => {
    const tripId = await createTestTrip({
      name: 'Summer',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
    });

    const { user } = render(<TripOpener tripId={tripId} />);

    await user.click(screen.getByRole('button', { name: 'open' }));
    await waitFor(() => {
      expect(screen.getByTestId('current-trip')).toHaveTextContent('Summer');
    });

    // Wait for the document to have actually been seeded, not merely for the
    // trip name to appear. `YjsTripSync` mounts, seeds the document from Dexie
    // and projects it back, all asynchronously — and writing into that window
    // races the projection's own transaction. This test failed roughly one run
    // in three without it, which is worse than not having it: a flaky guard on
    // a data-loss bug is a guard nobody trusts.
    await waitForTripDoc(tripId);

    // The trip is open and its document is loaded. Now arrange a car — which is
    // what a user does *after* the trip is on screen, never before.
    const vehicle = await createVehicle(tripId, { name: 'Espace', seatCount: 7 }),
      ride = await createRide(tripId, {
        direction: 'pickup',
        meetDatetime: '2026-07-15T15:02:00.000Z',
        location: 'Lyon Part-Dieu',
        vehicleId: vehicle.id,
      });

    // The observer's live queries have to tick and its effects have to run.
    await waitFor(async () => {
      const doc = await readPersistedDoc(tripId);
      expect(readDocCollection(doc, 'rides').map((row) => row.id)).toEqual([ride.id]);
    });

    const doc = await readPersistedDoc(tripId);
    expect(readDocCollection(doc, 'vehicles').map((row) => row.id)).toEqual([
      vehicle.id,
    ]);

    // And the half the user actually notices: somebody else edits anything, the
    // document comes back, and the car is still there.
    await syncDocToDexie(doc, tripId);

    expect(await db.rides.get(ride.id)).toBeDefined();
    expect(await db.vehicles.get(vehicle.id)).toBeDefined();
  });
});
