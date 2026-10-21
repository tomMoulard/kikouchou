/**
 * @fileoverview What `YjsSyncObserver` publishes from Dexie into a member
 * trip's document, and what it keeps out.
 *
 * Every table the projection writes into Dexie has to travel back out, or the
 * next projection deletes it (see `ride-sync-round-trip.test.tsx`). These pin
 * the publishing half collection by collection: a new row, a later edit, a
 * deletion once Dexie is a trusted mirror, the trip's own fields, and the one
 * thing a range query could leak in, another trip's rows.
 *
 * The document is read back the way a reload rebuilds it, from the persisted
 * updates, so what is asserted is what the device carries and what the outbox
 * pushes.
 *
 * @module lib/yjs/__tests__/YjsTripSync.test
 */

import { type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { loadPersistedUpdates } from '@/lib/yjs/dexie-bridge';
import { readDocCollection } from '@/lib/yjs/doc-model';
import type { DocCollectionName } from '@/lib/yjs/doc-model';
import {
  createTestTrip,
  render,
  screen,
  waitFor,
  waitForDb,
  waitForTripDoc,
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

async function idsIn(tripId: TripId, name: DocCollectionName): Promise<string[]> {
  return readDocCollection(await readPersistedDoc(tripId), name).map((row) => row.id);
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

/** Opens the trip through `TripContext` and waits for its document to load. */
async function openTrip(tripId: TripId, name: string): Promise<void> {
  const { user } = render(<TripOpener tripId={tripId} />);
  await user.click(screen.getByRole('button', { name: 'open' }));
  await waitFor(() => {
    expect(screen.getByTestId('current-trip')).toHaveTextContent(name);
  });
  await waitForTripDoc(tripId);
}

/**
 * A trip whose id sorts before any generated one, so a range query that lost
 * its lower bound would sweep its rows into the open trip's document.
 */
const OTHER_TRIP = '!other-trip' as TripId;

async function seedOtherTrip(): Promise<void> {
  await db.trips.put({
    id: OTHER_TRIP,
    name: 'Somebody else',
    shareId: 'share-other',
    startDate: '2026-07-15',
    endDate: '2026-07-22',
    createdAt: 1,
    updatedAt: 1,
  } as never);
  await db.rooms.put({ id: 'other-room', tripId: OTHER_TRIP, name: 'Theirs', capacity: 1, order: 0 } as never);
  await db.transports.put({
    id: 'other-leg',
    tripId: OTHER_TRIP,
    personId: 'other-guest',
    type: 'arrival',
    datetime: '2026-07-15T10:00:00.000Z',
    location: 'Elsewhere',
    needsPickup: false,
  } as never);
}

/** One row in every trip-scoped table, written the way the repositories would. */
async function seedEveryTable(tripId: TripId): Promise<void> {
  await db.persons.put({ id: 'guest-1', tripId, name: 'Alice', color: '#ef4444' } as never);
  await db.rooms.put({ id: 'room-1', tripId, name: 'Attic', capacity: 2, order: 0 } as never);
  await db.roomAssignments.put({
    id: 'assignment-1',
    tripId,
    roomId: 'room-1',
    personId: 'guest-1',
    startDate: '2026-07-15',
    endDate: '2026-07-17',
  } as never);
  await db.transports.put({
    id: 'leg-1',
    tripId,
    personId: 'guest-1',
    type: 'arrival',
    datetime: '2026-07-15T14:00:00.000Z',
    location: 'Vannes',
    needsPickup: false,
  } as never);
  await db.rides.put({
    id: 'ride-1',
    tripId,
    direction: 'pickup',
    meetDatetime: '2026-07-15T13:30:00.000Z',
    location: 'Vannes',
  } as never);
  await db.vehicles.put({ id: 'vehicle-1', tripId, name: 'Espace' } as never);
  await db.activities.put({
    id: 'activity-1',
    tripId,
    title: 'Market',
    category: 'market',
    startDatetime: '2026-07-16T09:00:00.000Z',
    allDay: false,
    participantIds: [],
  } as never);
  await db.expenses.put({
    id: 'expense-1',
    tripId,
    kind: 'expense',
    category: 'meal',
    title: 'Lunch',
    date: '2026-07-16',
    amount: 12,
    payerId: 'guest-1',
    splitMode: 'equal',
    splits: [],
  } as never);
}

const EXPECTED: readonly (readonly [DocCollectionName, string])[] = [
  ['guests', 'guest-1'],
  ['rooms', 'room-1'],
  ['roomAssignments', 'assignment-1'],
  ['transport', 'leg-1'],
  ['rides', 'ride-1'],
  ['vehicles', 'vehicle-1'],
  ['activities', 'activity-1'],
  ['expenses', 'expense-1'],
];

// ============================================================================
// Tests
// ============================================================================

describe('YjsSyncObserver publishes a member trip', () => {
  it('seeds the document from what Dexie already held when the trip opens', async () => {
    const tripId = await createTestTrip({
      name: 'Brittany',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
    });
    await seedEveryTable(tripId);
    const trip = await db.trips.get(tripId);

    await openTrip(tripId, 'Brittany');

    await waitFor(async () => {
      const doc = await readPersistedDoc(tripId);
      expect(doc.getMap('meta').get('shareId')).toBe(trip?.shareId);
      for (const [name, id] of EXPECTED) {
        expect(readDocCollection(doc, name).map((row) => row.id), name).toEqual([id]);
      }
    });
  });

  it('publishes rows written after the trip opened, in every collection', async () => {
    const tripId = await createTestTrip({
      name: 'Brittany',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
    });
    await openTrip(tripId, 'Brittany');

    await seedEveryTable(tripId);

    await waitFor(async () => {
      for (const [name, id] of EXPECTED) {
        expect(await idsIn(tripId, name), name).toEqual([id]);
      }
    });
  });

  it('publishes a later edit and the trip\'s own fields', async () => {
    const tripId = await createTestTrip({
      name: 'Brittany',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
    });
    await openTrip(tripId, 'Brittany');
    await seedEveryTable(tripId);
    await waitFor(async () => {
      expect(await idsIn(tripId, 'expenses')).toEqual(['expense-1']);
    });

    await db.rooms.update('room-1', { name: 'Loft' });
    await db.trips.update(tripId, { location: 'Vannes', updatedAt: Date.now() });

    await waitFor(async () => {
      const doc = await readPersistedDoc(tripId);
      expect(readDocCollection(doc, 'rooms')[0]?.name).toBe('Loft');
      expect(doc.getMap('meta').get('location')).toBe('Vannes');
    });
  });

  it('removes a row deleted from Dexie once Dexie mirrors the document', async () => {
    const tripId = await createTestTrip({
      name: 'Brittany',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
    });
    await seedEveryTable(tripId);
    await openTrip(tripId, 'Brittany');
    await waitFor(async () => {
      expect(await idsIn(tripId, 'expenses')).toEqual(['expense-1']);
    });

    await db.rooms.delete('room-1');
    await db.roomAssignments.delete('assignment-1');
    await db.transports.delete('leg-1');
    await db.rides.delete('ride-1');

    await waitFor(async () => {
      expect(await idsIn(tripId, 'rooms')).toEqual([]);
      expect(await idsIn(tripId, 'roomAssignments')).toEqual([]);
      expect(await idsIn(tripId, 'transport')).toEqual([]);
      expect(await idsIn(tripId, 'rides')).toEqual([]);
    });
  });

  it('keeps another trip\'s rows out of the document', async () => {
    await seedOtherTrip();
    const tripId = await createTestTrip({
      name: 'Brittany',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
    });
    await seedEveryTable(tripId);

    await openTrip(tripId, 'Brittany');

    await waitFor(async () => {
      expect(await idsIn(tripId, 'rooms')).toEqual(['room-1']);
      expect(await idsIn(tripId, 'transport')).toEqual(['leg-1']);
    });
  });
});

function TripSwitcher({
  first,
  second,
}: {
  readonly first: TripId;
  readonly second: TripId;
}): ReactElement {
  const { currentTrip, setCurrentTrip } = useTripContext();

  return (
    <div>
      <span data-testid="current-trip">{currentTrip?.name ?? 'none'}</span>
      <button onClick={() => void setCurrentTrip(first)}>first</button>
      <button onClick={() => void setCurrentTrip(second)}>second</button>
    </div>
  );
}

describe('YjsSyncObserver across a trip switch and a viewer trip', () => {
  it('publishes the next trip\'s rows and fields once the same observer switches to it', async () => {
    const first = await createTestTrip({ name: 'First', startDate: '2026-07-15', endDate: '2026-07-22' });
    const second = await createTestTrip({ name: 'Second', startDate: '2026-08-15', endDate: '2026-08-22' });
    const { user } = render(<TripSwitcher first={first} second={second} />);
    await user.click(screen.getByRole('button', { name: 'first' }));
    await waitFor(() => {
      expect(screen.getByTestId('current-trip')).toHaveTextContent('First');
    });
    await waitForTripDoc(first);

    await user.click(screen.getByRole('button', { name: 'second' }));
    await waitFor(() => {
      expect(screen.getByTestId('current-trip')).toHaveTextContent('Second');
    });
    await waitForTripDoc(second);
    await seedEveryTable(second);
    await db.trips.update(second, { location: 'Quimper', updatedAt: Date.now() });

    await waitFor(async () => {
      const doc = await readPersistedDoc(second);
      expect(doc.getMap('meta').get('location')).toBe('Quimper');
      for (const [name, id] of EXPECTED) {
        expect(readDocCollection(doc, name).map((row) => row.id), name).toEqual([id]);
      }
    });
  });

  it('writes nothing into a viewer trip\'s document, whatever its tables hold', async () => {
    const tripId = await createTestTrip({
      name: 'Read-only',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
    });
    await db.trips.update(tripId, {
      remoteTripId: 'aaaaaaaa-0000-0000-0000-000000000002',
      viewerToken: 'tokentokentoken2',
    });
    await seedEveryTable(tripId);
    const { user } = render(<TripOpener tripId={tripId} />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await waitFor(() => {
      expect(screen.getByTestId('current-trip')).toHaveTextContent('Read-only');
    });

    await waitForDb(150);

    expect(await db.yjsUpdates.where('tripId').equals(tripId).count()).toBe(0);
  });

  it('removes deleted guests, cars, activities and money lines too', async () => {
    const tripId = await createTestTrip({
      name: 'Brittany',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
    });
    await seedEveryTable(tripId);
    await openTrip(tripId, 'Brittany');
    await waitFor(async () => {
      expect(await idsIn(tripId, 'expenses')).toEqual(['expense-1']);
    });

    await db.persons.delete('guest-1');
    await db.vehicles.delete('vehicle-1');
    await db.activities.delete('activity-1');
    await db.expenses.delete('expense-1');

    await waitFor(async () => {
      expect(await idsIn(tripId, 'guests')).toEqual([]);
      expect(await idsIn(tripId, 'vehicles')).toEqual([]);
      expect(await idsIn(tripId, 'activities')).toEqual([]);
      expect(await idsIn(tripId, 'expenses')).toEqual([]);
    });
  });
});
