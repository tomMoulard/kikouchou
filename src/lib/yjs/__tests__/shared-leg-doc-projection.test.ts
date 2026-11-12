/**
 * @fileoverview Several guests on one train, across the CRDT boundary.
 *
 * 1. **Two guests joining the same train offline both survive the merge.**
 *    Each joiner writes only their own leg, carrying the founder's id. Nobody
 *    writes the founder's row or a list of travellers, so there is nothing for
 *    the merge to overwrite.
 * 2. **A key arriving from a peer is bounded before it reaches Dexie.** It is
 *    compared with every other leg's key, so anything not shaped like an id is
 *    read as "travels alone".
 *
 * @module lib/yjs/__tests__/shared-leg-doc-projection.test
 */

import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { db } from '@/lib/db/database';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { getSharedLegKey } from '@/lib/db/shared-legs';
import { toISODateStringFromString } from '@/lib/db/utils';
import { syncDocToDexie } from '../dexie-bridge';
import {
  readDocCollection,
  replaceDocCollection,
  stampDocSchemaVersion,
} from '../doc-model';
import type { TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

let tripId: TripId;

beforeEach(async () => {
  const trip = await createTrip({
    name: 'Summer',
    startDate: toISODateStringFromString('2026-07-15'),
    endDate: toISODateStringFromString('2026-07-22'),
  });
  tripId = trip.id;
});

/** A document already carrying this trip's metadata and schema stamp. */
function makeDoc(): Y.Doc {
  const doc = new Y.Doc(),
    meta = doc.getMap('meta');

  stampDocSchemaVersion(doc);
  meta.set('name', 'Summer');
  meta.set('startDate', '2026-07-15');
  meta.set('endDate', '2026-07-22');
  meta.set('shareId', 'share-1');
  meta.set('createdAt', Date.now());
  meta.set('updatedAt', Date.now());

  return doc;
}

/** One guest's leg on the 15:02 TGV. */
function tgvLeg(
  id: string,
  personId: string,
  sharedLegId?: unknown,
): Record<string, unknown> & { id: string } {
  return {
    id,
    personId,
    type: 'arrival',
    datetime: '2026-07-15T15:02:00.000Z',
    location: 'Lyon Part-Dieu',
    transportNumber: 'TGV 6105',
    needsPickup: false,
    ...(sharedLegId === undefined ? {} : { sharedLegId }),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('joining a train under a concurrent offline merge', () => {
  it('keeps both guests when two of them join the same train offline', () => {
    const base = makeDoc();
    replaceDocCollection(base, 'transport', [tgvLeg('t-alice', 'alice')], {
      allowDeletions: false,
    });

    const bobsPhone = new Y.Doc(),
      carolsPhone = new Y.Doc();
    Y.applyUpdate(bobsPhone, Y.encodeStateAsUpdate(base));
    Y.applyUpdate(carolsPhone, Y.encodeStateAsUpdate(base));

    // Each guest adds their own leg on Alice's train, and only that.
    replaceDocCollection(
      bobsPhone,
      'transport',
      [tgvLeg('t-alice', 'alice'), tgvLeg('t-bob', 'bob', 't-alice')],
      { allowDeletions: false },
    );
    replaceDocCollection(
      carolsPhone,
      'transport',
      [tgvLeg('t-alice', 'alice'), tgvLeg('t-carol', 'carol', 't-alice')],
      { allowDeletions: false },
    );

    Y.applyUpdate(bobsPhone, Y.encodeStateAsUpdate(carolsPhone));
    Y.applyUpdate(carolsPhone, Y.encodeStateAsUpdate(bobsPhone));

    for (const doc of [bobsPhone, carolsPhone]) {
      const legs = readDocCollection(doc, 'transport') as unknown as Parameters<
        typeof getSharedLegKey
      >[0][];
      expect(legs).toHaveLength(3);
      expect(new Set(legs.map(getSharedLegKey))).toEqual(new Set(['t-alice']));
    }
  });
});

describe('projecting a shared train into Dexie', () => {
  it('keeps an id-shaped key and drops anything else', async () => {
    const doc = makeDoc();
    replaceDocCollection(
      doc,
      'transport',
      [
        tgvLeg('t-alice', 'alice'),
        tgvLeg('t-bob', 'bob', 't-alice'),
        tgvLeg('t-text', 'carol', 'the TGV with Alice'),
        tgvLeg('t-long', 'dan', 'x'.repeat(5000)),
        tgvLeg('t-number', 'eve', 42),
        tgvLeg('t-empty', 'fay', ''),
      ],
      { allowDeletions: false },
    );

    await syncDocToDexie(doc, tripId);

    expect((await db.transports.get('t-bob'))?.sharedLegId).toBe('t-alice');
    for (const id of ['t-text', 't-long', 't-number', 't-empty']) {
      const row = await db.transports.get(id);
      expect(row).toBeDefined();
      expect(row && 'sharedLegId' in row).toBe(false);
    }
  });
});
