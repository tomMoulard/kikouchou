/**
 * @fileoverview A partial mirror must never delete the document's contents.
 *
 * The scenario, which is not hypothetical — it was reachable in this codebase
 * until the fix these tests pin:
 *
 *   A creates a trip with rooms and guests and shares it with B. B's document
 *   receives A's content from the log, but B's Dexie does not — the projection is
 *   refused, or has not run yet, or B's local data was cleared. Something then
 *   syncs B's Dexie *into* the document, which prunes every entry Dexie does not
 *   have. Those are real CRDT deletions. They push to the server, A applies them,
 *   and A's rooms and guests are gone for everybody, permanently.
 *
 * The CRDT layer is not the problem: Yjs updates are additive, so a document that
 * merely *lacks* an entry deletes nothing when it merges. The danger is the
 * projection layer inferring a deletion from the absence of a row in a mirror
 * that was never complete.
 *
 * So the rule these tests defend: **a deletion is never inferred from a mirror
 * that might be incomplete.** Pruning requires a caller willing to assert the
 * mirror is complete, and the seeding path never asserts it.
 *
 * @module lib/yjs/__tests__/trip-integrity.test
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { replaceDocCollection } from '@/lib/yjs/doc-model';

// ============================================================================
// Helpers
// ============================================================================

/** A document as B's would look after pulling A's trip from the log. */
function docWithContent(): Y.Doc {
  const doc = new Y.Doc();
  replaceDocCollection(
    doc,
    'guests',
    [
      { id: 'person-alice', name: 'Alice' },
      { id: 'person-bob', name: 'Bob' },
    ],
    { allowDeletions: true },
  );
  replaceDocCollection(
    doc,
    'rooms',
    [
      { id: 'room-attic', name: 'Attic' },
      { id: 'room-barn', name: 'Barn' },
    ],
    { allowDeletions: true },
  );
  return doc;
}

function idsIn(doc: Y.Doc, name: 'guests' | 'rooms'): string[] {
  const key = name === 'guests' ? 'guestsById' : 'roomsById';
  return [...doc.getMap(key).keys()].sort();
}

// ============================================================================
// Tests
// ============================================================================

describe('trip integrity: an incomplete mirror cannot delete', () => {
  it('keeps the document intact when the mirror is empty and untrusted', () => {
    const doc = docWithContent();

    // B's Dexie holds nothing for this trip, because the projection into it was
    // refused. Syncing that back without asserting completeness must change
    // nothing.
    replaceDocCollection(doc, 'guests', [], { allowDeletions: false });
    replaceDocCollection(doc, 'rooms', [], { allowDeletions: false });

    expect(idsIn(doc, 'guests')).toEqual(['person-alice', 'person-bob']);
    expect(idsIn(doc, 'rooms')).toEqual(['room-attic', 'room-barn']);
  });

  it('keeps the entries a partial mirror has not heard of', () => {
    const doc = docWithContent();

    // B received Alice but not Bob before the connection dropped.
    replaceDocCollection(doc, 'guests', [{ id: 'person-alice', name: 'Alice' }], {
      allowDeletions: false,
    });

    // Bob must survive. He is A's data, and B never had any basis to remove him.
    expect(idsIn(doc, 'guests')).toEqual(['person-alice', 'person-bob']);
  });

  it('still updates what the mirror does know about', () => {
    const doc = docWithContent();

    replaceDocCollection(doc, 'guests', [{ id: 'person-alice', name: 'Alicia' }], {
      allowDeletions: false,
    });

    // Refusing to delete is not refusing to work: an edit B did make still
    // applies.
    const alice = doc.getMap('guestsById').get('person-alice') as Y.Map<unknown>;
    expect(alice.get('name')).toBe('Alicia');
    expect(idsIn(doc, 'guests')).toEqual(['person-alice', 'person-bob']);
  });

  it('deletes when the caller asserts the mirror is complete', () => {
    const doc = docWithContent();

    // The ordinary case: the projection has run, Dexie mirrors the document, and
    // the user really did delete Bob. That deletion has to propagate.
    replaceDocCollection(doc, 'guests', [{ id: 'person-alice', name: 'Alice' }], {
      allowDeletions: true,
    });

    expect(idsIn(doc, 'guests')).toEqual(['person-alice']);
  });

  it('produces no deletion in the update it emits when untrusted', () => {
    const doc = docWithContent();
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));

    const updates: Uint8Array[] = [];
    doc.on('update', (update: Uint8Array) => {
      updates.push(update);
    });

    replaceDocCollection(doc, 'guests', [], { allowDeletions: false });

    // The real damage travels: whatever this device writes is pushed to the log
    // and applied by everyone else. Merging it into a peer that has the full trip
    // must leave that peer whole.
    for (const update of updates) {
      Y.applyUpdate(peer, update);
    }
    expect(idsIn(peer, 'guests')).toEqual(['person-alice', 'person-bob']);
  });
});
