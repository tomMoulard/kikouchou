/**
 * Convergence properties of the shared document model.
 *
 * These run on bare `Y.Doc`s — no Dexie, no network, no provider. Convergence is
 * a property of the model alone, and a test that needs a transport cannot tell a
 * model bug from a delivery bug. The user-visible consequences of getting this
 * wrong are pinned separately in `concurrent-edit-repro.test.ts`.
 *
 * @module lib/yjs/__tests__/doc-model.test
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  DOC_SCHEMA_VERSION,
  deleteDocEntity,
  migrateLegacyArrayCollections,
  readDocCollection,
  readDocSchemaVersion,
  replaceDocCollection,
  upsertDocEntity,
} from '@/lib/yjs/doc-model';

// ============================================================================
// Helpers
// ============================================================================

/** Exchanges pending updates both ways, as a reconnect to the shared log does. */
function reconcile(left: Y.Doc, right: Y.Doc): void {
  const leftState = Y.encodeStateAsUpdate(left);
  const rightState = Y.encodeStateAsUpdate(right);
  Y.applyUpdate(left, rightState);
  Y.applyUpdate(right, leftState);
}

/** Two docs sharing a common history, as two devices already on the trip. */
function joinedPair(seed: (doc: Y.Doc) => void): [Y.Doc, Y.Doc] {
  const host = new Y.Doc();
  seed(host);
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(host));
  return [host, peer];
}

const names = (doc: Y.Doc): string[] =>
  readDocCollection(doc, 'guests').map((guest) => String(guest.name));

// ============================================================================
// Convergence
// ============================================================================

describe('doc-model convergence', () => {
  it('keeps both concurrent edits to different fields of one row', () => {
    const [host, peer] = joinedPair((doc) => {
      upsertDocEntity(doc, 'guests', { id: 'p1', name: 'Bob', color: '#0f0' });
    });

    upsertDocEntity(host, 'guests', { id: 'p1', name: 'Bob', color: '#abc' });
    upsertDocEntity(peer, 'guests', { id: 'p1', name: 'Bobby', color: '#0f0' });

    reconcile(host, peer);

    const merged = readDocCollection(host, 'guests');
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ name: 'Bobby', color: '#abc' });
    expect(readDocCollection(peer, 'guests')).toEqual(merged);
  });

  it('resolves a same-field conflict to the same winner on both peers', () => {
    const [host, peer] = joinedPair((doc) => {
      upsertDocEntity(doc, 'guests', { id: 'p1', name: 'Bob', color: '#0f0' });
    });

    upsertDocEntity(host, 'guests', { id: 'p1', name: 'Robert', color: '#0f0' });
    upsertDocEntity(peer, 'guests', { id: 'p1', name: 'Bobby', color: '#0f0' });

    reconcile(host, peer);

    // Which name wins is Yjs's call, not ours. What matters is that both peers
    // agree, and that the winner is one of the two names actually written.
    expect(readDocCollection(host, 'guests')).toEqual(
      readDocCollection(peer, 'guests'),
    );
    expect(['Robert', 'Bobby']).toContain(names(host)[0]);
  });

  it('agrees on the outcome when a delete races an edit to the same row', () => {
    const [host, peer] = joinedPair((doc) => {
      upsertDocEntity(doc, 'guests', { id: 'p1', name: 'Alice', color: '#f00' });
      upsertDocEntity(doc, 'guests', { id: 'p2', name: 'Bob', color: '#0f0' });
    });

    deleteDocEntity(host, 'guests', 'p2');
    upsertDocEntity(peer, 'guests', { id: 'p2', name: 'Bobby', color: '#0f0' });

    reconcile(host, peer);

    // Either outcome is defensible; a split brain is not.
    expect(readDocCollection(host, 'guests')).toEqual(
      readDocCollection(peer, 'guests'),
    );
    expect(names(host)).toContain('Alice');
  });

  it('converges after a long two-sided offline divergence', () => {
    const [host, peer] = joinedPair((doc) => {
      upsertDocEntity(doc, 'guests', { id: 'p1', name: 'Alice', color: '#f00' });
    });

    for (let index = 0; index < 20; index += 1) {
      upsertDocEntity(host, 'guests', {
        id: `h${index}`,
        name: `Host ${index}`,
        color: '#111',
      });
      upsertDocEntity(peer, 'guests', {
        id: `g${index}`,
        name: `Peer ${index}`,
        color: '#222',
      });
    }

    reconcile(host, peer);

    expect(readDocCollection(host, 'guests')).toHaveLength(41);
    expect(readDocCollection(host, 'guests')).toEqual(
      readDocCollection(peer, 'guests'),
    );
  });

  it('reaches the same state whatever order updates arrive in', () => {
    const [host, peer] = joinedPair((doc) => {
      upsertDocEntity(doc, 'rooms', { id: 'r1', name: 'Attic', capacity: 2, order: 0 });
    });
    const third = new Y.Doc();
    Y.applyUpdate(third, Y.encodeStateAsUpdate(host));

    upsertDocEntity(host, 'rooms', { id: 'r2', name: 'Cellar', capacity: 4, order: 1 });
    upsertDocEntity(peer, 'rooms', { id: 'r1', name: 'Loft', capacity: 2, order: 0 });

    const fromHost = Y.encodeStateAsUpdate(host);
    const fromPeer = Y.encodeStateAsUpdate(peer);

    // The third device receives them in the opposite order.
    Y.applyUpdate(third, fromPeer);
    Y.applyUpdate(third, fromHost);
    reconcile(host, peer);

    expect(readDocCollection(third, 'rooms')).toEqual(
      readDocCollection(host, 'rooms'),
    );
  });

  it('treats a redelivered update as a no-op', () => {
    const source = new Y.Doc();
    upsertDocEntity(source, 'guests', { id: 'p1', name: 'Alice', color: '#f00' });

    const target = new Y.Doc();
    const update = Y.encodeStateAsUpdate(source);

    Y.applyUpdate(target, update);
    const afterFirst = readDocCollection(target, 'guests');
    Y.applyUpdate(target, update);

    // The outbox re-sends on reconnect without precise ack tracking, so
    // duplicate delivery has to cost nothing.
    expect(readDocCollection(target, 'guests')).toEqual(afterFirst);
  });

  it('emits a single-field update rather than the whole collection', () => {
    const doc = new Y.Doc();
    for (let index = 0; index < 30; index += 1) {
      upsertDocEntity(doc, 'guests', {
        id: `p${index}`,
        name: `Guest ${index}`,
        color: '#ff0000',
        notes: 'some notes that add weight to the record',
      });
    }

    let bytes = 0;
    doc.on('update', (update: Uint8Array) => {
      bytes += update.byteLength;
    });
    upsertDocEntity(doc, 'guests', {
      id: 'p0',
      name: 'Renamed',
      color: '#ff0000',
      notes: 'some notes that add weight to the record',
    });

    // The array model re-sent all 30 records for a one-word rename. Generous
    // bound: this is about the order of magnitude, not an exact encoding.
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(200);
  });
});

// ============================================================================
// Reads
// ============================================================================

describe('readDocCollection', () => {
  it('orders rooms by order then id so ties resolve the same everywhere', () => {
    const doc = new Y.Doc();
    upsertDocEntity(doc, 'rooms', { id: 'zz', name: 'Zulu', capacity: 1, order: 0 });
    upsertDocEntity(doc, 'rooms', { id: 'aa', name: 'Alpha', capacity: 1, order: 0 });
    upsertDocEntity(doc, 'rooms', { id: 'mm', name: 'Mike', capacity: 1, order: 1 });

    expect(readDocCollection(doc, 'rooms').map((room) => room.id)).toEqual([
      'aa',
      'zz',
      'mm',
    ]);
  });

  it('takes the id from the map key, not from a field a peer set', () => {
    const doc = new Y.Doc();
    upsertDocEntity(doc, 'guests', { id: 'p1', name: 'Alice', color: '#f00' });
    // A peer tries to make the row claim a different id than it is filed under.
    (doc.getMap('guestsById').get('p1') as Y.Map<unknown>).set('id', 'p999');

    expect(readDocCollection(doc, 'guests')[0]?.id).toBe('p1');
  });

  it('drops a row that is not a map instead of failing the whole read', () => {
    const doc = new Y.Doc();
    upsertDocEntity(doc, 'guests', { id: 'p1', name: 'Alice', color: '#f00' });
    doc.getMap('guestsById').set('p2', 'not-a-map');

    const guests = readDocCollection(doc, 'guests');
    expect(guests).toHaveLength(1);
    expect(guests[0]?.id).toBe('p1');
  });

  it('removes a field cleared to undefined rather than keeping the key', () => {
    const doc = new Y.Doc();
    upsertDocEntity(doc, 'guests', {
      id: 'p1',
      name: 'Alice',
      color: '#f00',
      notes: 'gluten free',
    });
    upsertDocEntity(doc, 'guests', {
      id: 'p1',
      name: 'Alice',
      color: '#f00',
      notes: undefined,
    });

    expect(readDocCollection(doc, 'guests')[0]).not.toHaveProperty('notes');
  });

  it('removes a field omitted entirely on a later write', () => {
    const doc = new Y.Doc();
    upsertDocEntity(doc, 'guests', {
      id: 'p1',
      name: 'Alice',
      color: '#f00',
      notes: 'gluten free',
    });
    upsertDocEntity(doc, 'guests', { id: 'p1', name: 'Alice', color: '#f00' });

    expect(readDocCollection(doc, 'guests')[0]).not.toHaveProperty('notes');
  });
});

// ============================================================================
// replaceDocCollection
// ============================================================================

describe('replaceDocCollection', () => {
  it('adds, updates and removes to match the given set', () => {
    const doc = new Y.Doc();
    replaceDocCollection(doc, 'guests', [
      { id: 'p1', name: 'Alice' },
      { id: 'p2', name: 'Bob' },
    ],
      { allowDeletions: true },
    );

    replaceDocCollection(doc, 'guests', [
      { id: 'p1', name: 'Alicia' },
      { id: 'p3', name: 'Carol' },
    ],
      { allowDeletions: true },
    );

    expect(readDocCollection(doc, 'guests')).toEqual([
      { id: 'p1', name: 'Alicia' },
      { id: 'p3', name: 'Carol' },
    ]);
  });

  it('emits one update carrying the caller origin, despite nesting', () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      origins.push(origin);
    });

    // `syncDexieToDoc` wraps this in its own transaction tagged
    // ORIGIN_DEXIE_SYNC, while `replaceDocCollection` and `upsertDocEntity`
    // each open an untagged one. If a nested transaction reset the origin, the
    // echo guard in `subscribeToUpdates` would stop recognising local writes
    // and every edit would round-trip back through Dexie.
    Y.transact(
      doc,
      () => {
        replaceDocCollection(doc, 'guests', [
          { id: 'p1', name: 'Alice' },
          { id: 'p2', name: 'Bob' },
        ],
          { allowDeletions: true },
        );
      },
      'dexie-sync',
    );

    expect(origins).toEqual(['dexie-sync']);
  });

  it('emits nothing when the collection already matches', () => {
    const doc = new Y.Doc();
    const guests = [{ id: 'p1', name: 'Alice', color: '#f00' }];
    replaceDocCollection(doc, 'guests', guests, { allowDeletions: true });

    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    replaceDocCollection(doc, 'guests', guests, { allowDeletions: true });

    // `YjsTripSync` re-pushes on every useLiveQuery emission, so an unchanged
    // collection must not put a byte on the wire.
    expect(updates).toBe(0);
  });
});

// ============================================================================
// Migration from the array-based schema
// ============================================================================

describe('migrateLegacyArrayCollections', () => {
  /** Builds a document the previous build would have persisted. */
  function legacyDoc(): Y.Doc {
    const doc = new Y.Doc();
    doc.getMap('meta').set('id', 'trip-1');
    doc.getArray('guests').push([
      { id: 'p1', name: 'Alice', color: '#f00' },
      { id: 'p2', name: 'Bob', color: '#0f0' },
    ]);
    doc.getArray('rooms').push([{ id: 'r1', name: 'Attic', capacity: 2, order: 0 }]);
    return doc;
  }

  it('carries array collections across and stamps the schema version', () => {
    const doc = legacyDoc();
    expect(readDocSchemaVersion(doc)).toBe(1);

    expect(migrateLegacyArrayCollections(doc)).toBe(true);

    expect(names(doc)).toEqual(['Alice', 'Bob']);
    expect(readDocCollection(doc, 'rooms')).toHaveLength(1);
    expect(readDocSchemaVersion(doc)).toBe(DOC_SCHEMA_VERSION);
  });

  it('converges when two devices migrate the same document concurrently', () => {
    const [host, peer] = joinedPair((doc) => {
      doc.getMap('meta').set('id', 'trip-1');
      doc.getArray('guests').push([
        { id: 'p1', name: 'Alice', color: '#f00' },
        { id: 'p2', name: 'Bob', color: '#0f0' },
      ]);
    });

    // Both open the trip while offline; both convert.
    migrateLegacyArrayCollections(host);
    migrateLegacyArrayCollections(peer);
    reconcile(host, peer);

    // Keyed on each record's own id, so the same rows are written twice with
    // the same values and nothing is duplicated.
    expect(names(host)).toEqual(['Alice', 'Bob']);
    expect(readDocCollection(host, 'guests')).toEqual(
      readDocCollection(peer, 'guests'),
    );
  });

  it('does not walk back an edit made after the conversion', () => {
    const doc = legacyDoc();
    migrateLegacyArrayCollections(doc);
    upsertDocEntity(doc, 'guests', { id: 'p1', name: 'Alicia', color: '#f00' });

    // A second pass — another tab, a reload — must not restore the array value.
    migrateLegacyArrayCollections(doc);

    expect(names(doc)).toEqual(['Alicia', 'Bob']);
  });

  it('skips a legacy row with no usable id', () => {
    const doc = new Y.Doc();
    doc.getArray('guests').push([
      { id: 'p1', name: 'Alice' },
      { name: 'no id at all' },
      'not an object',
      { id: '', name: 'empty id' },
    ]);

    migrateLegacyArrayCollections(doc);

    expect(names(doc)).toEqual(['Alice']);
  });

  it('leaves a fresh empty document on v1 rather than self-certifying', () => {
    const doc = new Y.Doc();

    expect(migrateLegacyArrayCollections(doc)).toBe(false);

    // Claiming v2 here would let the version guard wave through a v1 peer whose
    // maps are legitimately empty, and projecting that empties the local tables.
    expect(readDocSchemaVersion(doc)).toBe(1);
  });

  it('reports nothing to do for a document with no legacy arrays', () => {
    const doc = new Y.Doc();
    upsertDocEntity(doc, 'guests', { id: 'p1', name: 'Alice', color: '#f00' });

    expect(migrateLegacyArrayCollections(doc)).toBe(false);
    expect(names(doc)).toEqual(['Alice']);
  });
});
