/**
 * Rooms, assignments and activities crossing the trust boundary.
 *
 * These three collections were the last ones the projection cast straight out
 * of the document — `{ ...room, tripId } as Room` — while guests, transports,
 * rides, vehicles and money lines each had a bounder. The cast is what
 * AGENTS.md's unbounded-`capacity` paragraph is about: `RoomOccupancyTimeline`
 * renders one element per bed, so a peer's `1e9` allocates until the tab dies,
 * and it dies again on every reload because the row is in IndexedDB.
 *
 * @module lib/yjs/__tests__/room-doc-projection.test
 */

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { MAX_LENGTHS } from '@/lib/db/sanitize';
import { syncDocToDexie } from '@/lib/yjs/dexie-bridge';
import { DOC_SCHEMA_VERSION, upsertDocEntity } from '@/lib/yjs/doc-model';
import { isoDate } from '@/test/utils';
import { MAX_ACTIVITY_PARTICIPANTS, MAX_ROOM_CAPACITY } from '@/types';
import type { TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('schema', DOC_SCHEMA_VERSION);
  return doc;
}

async function makeTrip(): Promise<TripId> {
  const trip = await createTrip({
    name: 'Shared trip',
    startDate: isoDate('2026-08-01'),
    endDate: isoDate('2026-08-05'),
  });
  return trip.id;
}

/** Puts one record into the document as a peer would, and projects it. */
async function project(
  tripId: TripId,
  collection: 'rooms' | 'roomAssignments' | 'activities',
  record: Record<string, unknown> & { readonly id: string },
): Promise<void> {
  const doc = makeDoc();
  upsertDocEntity(doc, collection, record);
  await syncDocToDexie(doc, tripId);
}

const VALID_ROOM = { id: 'r1', name: 'Attic', capacity: 2, order: 0 };
const VALID_ASSIGNMENT = {
  id: 'a1',
  roomId: 'r1',
  personId: 'p1',
  startDate: '2026-08-01',
  endDate: '2026-08-03',
};
const VALID_ACTIVITY = {
  id: 'act1',
  title: 'Marché',
  category: 'market',
  startDatetime: '2026-08-02T09:00:00.000Z',
  allDay: false,
  participantIds: ['p1'],
};

// ============================================================================
// Tests
// ============================================================================

describe('rooms crossing the trust boundary', () => {
  it('keeps a well-formed room as the document holds it', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'rooms', VALID_ROOM);

    const room = await db.rooms.get('r1');
    expect(room?.name).toBe('Attic');
    expect(room?.capacity).toBe(2);
  });

  it('clamps a capacity that would render one element per bed', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'rooms', { ...VALID_ROOM, capacity: 1e9 });

    expect((await db.rooms.get('r1'))?.capacity).toBe(MAX_ROOM_CAPACITY);
  });

  it('reads a missing or unusable capacity as one bed rather than storing it', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'rooms', { ...VALID_ROOM, capacity: 'lots' });
    expect((await db.rooms.get('r1'))?.capacity).toBe(1);

    await project(tripId, 'rooms', { ...VALID_ROOM, capacity: -4 });
    expect((await db.rooms.get('r1'))?.capacity).toBe(1);
  });

  it('bounds a name and a description the local form would have capped', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'rooms', {
      ...VALID_ROOM,
      name: 'A'.repeat(5_000),
      description: 'B'.repeat(50_000),
    });

    const room = await db.rooms.get('r1');
    expect(room?.name).toHaveLength(MAX_LENGTHS.roomName);
    expect(room?.description).toHaveLength(MAX_LENGTHS.roomDescription);
  });

  it('drops a room with no usable order rather than storing an unreachable row', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'rooms', { ...VALID_ROOM, order: 'first' });

    expect(await db.rooms.get('r1')).toBeUndefined();
  });

  it('drops an icon this build does not know', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'rooms', { ...VALID_ROOM, icon: 'space-station' });

    expect((await db.rooms.get('r1'))?.icon).toBeUndefined();
  });

  it('keeps the rest of the collection when one room is unusable', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    upsertDocEntity(doc, 'rooms', VALID_ROOM);
    upsertDocEntity(doc, 'rooms', { id: 'r2', name: 'Barn', capacity: 3 });
    await syncDocToDexie(doc, tripId);

    expect(await db.rooms.get('r1')).toBeDefined();
    expect(await db.rooms.get('r2')).toBeUndefined();
  });
});

describe('writing only what changed', () => {
  it('leaves a row alone when the document did not touch it', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    upsertDocEntity(doc, 'rooms', VALID_ROOM);
    upsertDocEntity(doc, 'rooms', { id: 'r2', name: 'Barn', capacity: 3, order: 1 });
    await syncDocToDexie(doc, tripId);

    const puts: string[][] = [];
    const bulkPut = vi
      .spyOn(db.rooms, 'bulkPut')
      .mockImplementation(async (rows: readonly { id: string }[]) => {
        puts.push(rows.map((row) => row.id));
        return '' as never;
      });

    // One room's name changes. The projection used to `bulkPut` every row of
    // all nine trip tables on every remote update, so one guest's name arriving
    // over sync rewrote hundreds of rows and woke every `useLiveQuery` watching
    // them.
    upsertDocEntity(doc, 'rooms', { ...VALID_ROOM, name: 'Loft' });
    await syncDocToDexie(doc, tripId);

    expect(puts).toEqual([['r1']]);
    bulkPut.mockRestore();
  });

  it('writes nothing at all when nothing changed', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    upsertDocEntity(doc, 'rooms', VALID_ROOM);
    await syncDocToDexie(doc, tripId);

    const bulkPut = vi.spyOn(db.rooms, 'bulkPut');
    await syncDocToDexie(doc, tripId);

    expect(bulkPut).not.toHaveBeenCalled();
    bulkPut.mockRestore();
  });
});

describe('room assignments crossing the trust boundary', () => {
  it('keeps a well-formed assignment', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'roomAssignments', VALID_ASSIGNMENT);

    expect((await db.roomAssignments.get('a1'))?.endDate).toBe('2026-08-03');
  });

  it.each([
    ['a non-string start date', { startDate: 20_260_801 }],
    ['an unparseable day', { startDate: 'tomorrow' }],
    ['a month that does not exist', { startDate: '2026-13-01' }],
    ['an empty room reference', { roomId: '' }],
    ['a missing guest reference', { personId: undefined }],
  ])('drops an assignment with %s', async (_label, patch) => {
    const tripId = await makeTrip();
    await project(tripId, 'roomAssignments', { ...VALID_ASSIGNMENT, ...patch });

    expect(await db.roomAssignments.get('a1')).toBeUndefined();
  });

  it('collapses an inverted window instead of hiding the guest', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'roomAssignments', {
      ...VALID_ASSIGNMENT,
      startDate: '2026-08-03',
      endDate: '2026-08-01',
    });

    const assignment = await db.roomAssignments.get('a1');
    expect(assignment?.startDate).toBe('2026-08-03');
    expect(assignment?.endDate).toBe('2026-08-03');
  });
});

describe('activities crossing the trust boundary', () => {
  it('keeps a well-formed activity', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'activities', VALID_ACTIVITY);

    expect((await db.activities.get('act1'))?.title).toBe('Marché');
  });

  it('drops an activity whose start is not an instant', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'activities', {
      ...VALID_ACTIVITY,
      startDatetime: 'soon',
    });

    expect(await db.activities.get('act1')).toBeUndefined();
  });

  it('forgets an end this build cannot parse rather than dropping the activity', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'activities', {
      ...VALID_ACTIVITY,
      endDatetime: 'later',
    });

    const activity = await db.activities.get('act1');
    expect(activity).toBeDefined();
    expect(activity?.endDatetime).toBeUndefined();
  });

  it('falls back to "other" for a category a newer peer invented', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'activities', {
      ...VALID_ACTIVITY,
      category: 'paragliding',
    });

    expect((await db.activities.get('act1'))?.category).toBe('other');
  });

  it('bounds the participant list and the cap that is compared against it', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'activities', {
      ...VALID_ACTIVITY,
      participantIds: Array.from({ length: 5_000 }, (_, i) => `p${i}`),
      maxParticipants: 1e9,
    });

    const activity = await db.activities.get('act1');
    expect(activity?.participantIds).toHaveLength(MAX_ACTIVITY_PARTICIPANTS);
    expect(activity?.maxParticipants).toBe(MAX_ACTIVITY_PARTICIPANTS);
  });

  it('reads a participant list of the wrong shape as nobody signed up', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'activities', {
      ...VALID_ACTIVITY,
      participantIds: 'everyone',
    });

    expect((await db.activities.get('act1'))?.participantIds).toEqual([]);
  });

  it('bounds the title, place and notes a local form would have capped', async () => {
    const tripId = await makeTrip();
    await project(tripId, 'activities', {
      ...VALID_ACTIVITY,
      title: 'T'.repeat(5_000),
      location: 'L'.repeat(5_000),
      notes: 'N'.repeat(50_000),
    });

    const activity = await db.activities.get('act1');
    expect(activity?.title).toHaveLength(MAX_LENGTHS.activityTitle);
    expect(activity?.location).toHaveLength(MAX_LENGTHS.activityLocation);
    expect(activity?.notes).toHaveLength(MAX_LENGTHS.activityNotes);
  });
});
