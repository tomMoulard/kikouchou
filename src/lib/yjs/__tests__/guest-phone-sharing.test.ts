/**
 * The `guest-phone-sharing` flag at the sync boundary.
 *
 * The flag gates one direction only. A guest's phone is written to IndexedDB
 * either way; what the flag decides is whether it is allowed into the shared
 * document, and therefore onto the server and every other member's device.
 *
 * That asymmetry has a second half which is easy to miss and expensive to get
 * wrong: the projection back into Dexie must not read the document's silence
 * about a phone as a deletion while the flag is off, or this device's own sync
 * loop wipes the number the user just typed.
 *
 * @module lib/yjs/__tests__/guest-phone-sharing.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { isoDate, hexColor } from '@/test/utils';
import type { Person, Trip } from '@/types';

const isGuestPhoneSharingEnabled = vi.fn(() => false);
vi.mock('@/lib/flags', () => ({
  isGuestPhoneSharingEnabled: () => isGuestPhoneSharingEnabled(),
}));

import {
  populateDocFromDexie,
  syncDexieToDoc,
  syncDocToDexie,
} from '@/lib/yjs/dexie-bridge';
import {
  DOC_SCHEMA_VERSION,
  readDocCollection,
  upsertDocEntity,
} from '@/lib/yjs/doc-model';

// ============================================================================
// Helpers
// ============================================================================

async function makeTrip(): Promise<Trip> {
  return createTrip({
    name: 'Brittany',
    startDate: isoDate('2026-07-15'),
    endDate: isoDate('2026-07-22'),
  });
}

/** Reads the phone the shared document currently holds for a guest. */
function docPhoneOf(doc: Y.Doc, id: string): unknown {
  return readDocCollection(doc, 'guests').find((row) => row.id === id)?.phone;
}

/** A document already stamped with the schema `syncDocToDexie` requires. */
function stampedDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('schema', DOC_SCHEMA_VERSION);
  return doc;
}

beforeEach(() => {
  isGuestPhoneSharingEnabled.mockReturnValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Outbound — what leaves this device
// ============================================================================

describe('publishing a guest while sharing is off', () => {
  it('keeps the phone out of the document on the initial seed', async () => {
    const trip = await makeTrip();
    const guest = await createPerson(trip.id, {
      name: 'Mary',
      color: hexColor('#3b82f6'),
      phone: '+33 6 12 34 56 78',
    });
    const doc = stampedDoc();

    await populateDocFromDexie(doc, trip.id);

    expect(docPhoneOf(doc, guest.id)).toBeUndefined();
    // The rest of the guest still publishes — only the phone is held back.
    expect(readDocCollection(doc, 'guests')).toHaveLength(1);
    expect(docPhoneOf(doc, guest.id)).toBeUndefined();
  });

  it('keeps the phone out of the document on a live change', () => {
    const doc = stampedDoc();

    syncDexieToDoc(
      doc,
      'guests',
      [{ id: 'guest-1', name: 'Mary', color: '#3b82f6', phone: '0612345678' }],
      { allowDeletions: false },
    );

    expect(docPhoneOf(doc, 'guest-1')).toBeUndefined();
  });

  it('still stores the phone in IndexedDB — the flag gates sharing, not keeping', async () => {
    const trip = await makeTrip();
    const guest = await createPerson(trip.id, {
      name: 'Mary',
      color: hexColor('#3b82f6'),
      phone: '+33 6 12 34 56 78',
    });

    expect((await db.persons.get(guest.id))?.phone).toBe('+33 6 12 34 56 78');
  });

  it('un-shares a number a previous session published', () => {
    // The flag went off between sessions. Leaving the old value behind would
    // keep it on every other member's device forever.
    const doc = stampedDoc();
    upsertDocEntity(doc, 'guests', {
      id: 'guest-1',
      name: 'Mary',
      color: '#3b82f6',
      phone: '+33 6 12 34 56 78',
    });

    syncDexieToDoc(
      doc,
      'guests',
      [{ id: 'guest-1', name: 'Mary', color: '#3b82f6', phone: '+33 6 12 34 56 78' }],
      { allowDeletions: false },
    );

    expect(docPhoneOf(doc, 'guest-1')).toBeUndefined();
  });
});

describe('publishing a guest while sharing is on', () => {
  beforeEach(() => {
    isGuestPhoneSharingEnabled.mockReturnValue(true);
  });

  it('puts the phone in the document on the initial seed', async () => {
    const trip = await makeTrip();
    const guest = await createPerson(trip.id, {
      name: 'Mary',
      color: hexColor('#3b82f6'),
      phone: '+33 6 12 34 56 78',
    });
    const doc = stampedDoc();

    await populateDocFromDexie(doc, trip.id);

    expect(docPhoneOf(doc, guest.id)).toBe('+33 6 12 34 56 78');
  });

  it('puts the phone in the document on a live change', () => {
    const doc = stampedDoc();

    syncDexieToDoc(
      doc,
      'guests',
      [{ id: 'guest-1', name: 'Mary', color: '#3b82f6', phone: '0612345678' }],
      { allowDeletions: false },
    );

    expect(docPhoneOf(doc, 'guest-1')).toBe('0612345678');
  });
});

// ============================================================================
// Inbound — what the projection is allowed to overwrite
// ============================================================================

describe('projecting a guest back into Dexie', () => {
  it('keeps a local-only phone the document was never going to carry', async () => {
    // The bug this guards: with sharing off the phone is deliberately absent
    // from the document, and the projection `bulkPut`s whole rows — so a naive
    // overwrite had the device wipe its own number moments after the form saved
    // it.
    const trip = await makeTrip();
    const guest = await createPerson(trip.id, {
      name: 'Mary',
      color: hexColor('#3b82f6'),
      phone: '+33 6 12 34 56 78',
    });

    const doc = stampedDoc();
    await populateDocFromDexie(doc, trip.id);
    await syncDocToDexie(doc, trip.id);

    expect((await db.persons.get(guest.id))?.phone).toBe('+33 6 12 34 56 78');
  });

  it('honours a real deletion once sharing is on', async () => {
    // With the flag on the document is where this guest's phone lives, so an
    // absent one is somebody clearing the field rather than the flag hiding it.
    const trip = await makeTrip();
    const guest = await createPerson(trip.id, {
      name: 'Mary',
      color: hexColor('#3b82f6'),
      phone: '+33 6 12 34 56 78',
    });

    isGuestPhoneSharingEnabled.mockReturnValue(true);
    const doc = stampedDoc();
    upsertDocEntity(doc, 'guests', {
      id: guest.id,
      name: 'Mary',
      color: '#3b82f6',
    });
    await syncDocToDexie(doc, trip.id);

    expect((await db.persons.get(guest.id))?.phone).toBeUndefined();
  });

  it('still accepts a phone another member shared', async () => {
    // This device not publishing does not mean it refuses to receive: a member
    // whose flag is on is sharing their guests' numbers deliberately.
    const trip = await makeTrip();
    const doc = stampedDoc();
    upsertDocEntity(doc, 'guests', {
      id: 'from-a-peer',
      name: 'Mary',
      color: '#3b82f6',
      phone: '+33 6 12 34 56 78',
    });

    await syncDocToDexie(doc, trip.id);

    expect((await db.persons.get('from-a-peer' as Person['id']))?.phone).toBe(
      '+33 6 12 34 56 78',
    );
  });
});
