/**
 * @fileoverview Activity invitations and a money line's author, as another
 * device's document hands them over.
 *
 * Both are written by peers, so they are bounded on the way in like the
 * participants: strings only, each once, and gone when empty, so a row with
 * none reads the same as one written before they existed.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { syncDocToDexie } from '@/lib/yjs/dexie-bridge';
import { DOC_SCHEMA_VERSION, upsertDocEntity } from '@/lib/yjs/doc-model';
import { isoDate } from '@/test/utils';
import type { TripId } from '@/types';

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

const ACTIVITY = {
  id: 'a1',
  title: 'Plant fair',
  category: 'horticulture',
  startDatetime: '2026-08-02T09:00:00.000Z',
  allDay: false,
  participantIds: ['carol'],
};

describe('invitations from another device', () => {
  it('keeps each invited and declined guest once, and the inviter', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    upsertDocEntity(doc, 'activities', {
      ...ACTIVITY,
      invitedIds: ['bob', 'bob', 42, '', 'dan'],
      declinedIds: ['eve', null],
      invitedBy: 'alice',
    });

    await syncDocToDexie(doc, tripId);

    expect(await db.activities.get('a1')).toMatchObject({
      invitedIds: ['bob', 'dan'],
      declinedIds: ['eve'],
      invitedBy: 'alice',
    });
  });

  it('reads an activity with no invitations as one written before they existed', async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    upsertDocEntity(doc, 'activities', {
      ...ACTIVITY,
      invitedIds: [],
      declinedIds: 'not a list',
      invitedBy: '',
    });

    await syncDocToDexie(doc, tripId);

    const activity = await db.activities.get('a1');
    expect(activity).toBeDefined();
    expect(activity).not.toHaveProperty('invitedIds');
    expect(activity).not.toHaveProperty('declinedIds');
    expect(activity).not.toHaveProperty('invitedBy');
  });

  it("keeps a money line's author, and drops one that is not a guest id", async () => {
    const tripId = await makeTrip();
    const doc = makeDoc();
    const line = {
      kind: 'expense',
      category: 'groceries',
      title: 'Courses',
      date: '2026-08-02',
      amount: 84.2,
      payerId: 'alice',
      splitMode: 'equal',
      splits: [{ personId: 'alice', value: 1 }, { personId: 'bob', value: 1 }],
    };
    upsertDocEntity(doc, 'expenses', { id: 'e1', ...line, updatedBy: 'alice' });
    upsertDocEntity(doc, 'expenses', { id: 'e2', ...line, updatedBy: 7 });

    await syncDocToDexie(doc, tripId);

    expect((await db.expenses.get('e1'))?.updatedBy).toBe('alice');
    expect(await db.expenses.get('e2')).not.toHaveProperty('updatedBy');
  });
});
