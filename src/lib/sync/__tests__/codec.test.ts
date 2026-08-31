/**
 * Codec tests.
 *
 * This is the seam where a Yjs update becomes a database column and back, so a
 * silent corruption here would look like a CRDT bug somewhere else entirely.
 * Round-tripping real `Y.encodeStateAsUpdate` output — not hand-picked byte
 * arrays — is the part that matters.
 *
 * @module lib/sync/__tests__/codec.test
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  areStateVectorsEqual,
  decodeUpdate,
  encodeUpdate,
} from '@/lib/sync/codec';

// ============================================================================
// Round trip
// ============================================================================

describe('encodeUpdate / decodeUpdate', () => {
  it('round-trips a real Yjs update', () => {
    const doc = new Y.Doc();
    const row = new Y.Map<unknown>();
    doc.getMap('guestsById').set('p1', row);
    row.set('name', 'Alice');

    const update = Y.encodeStateAsUpdate(doc);
    const decoded = decodeUpdate(encodeUpdate(update));

    expect(decoded).not.toBeNull();
    expect(Array.from(decoded!)).toEqual(Array.from(update));

    // The real test of a codec: the far side rebuilds the same document.
    const rebuilt = new Y.Doc();
    Y.applyUpdate(rebuilt, decoded!);
    expect([...rebuilt.getMap('guestsById').keys()]).toEqual(['p1']);
  });

  it('round-trips every byte value, which base64 padding can mangle', () => {
    const all = new Uint8Array(256);
    for (let index = 0; index < 256; index += 1) {
      all[index] = index;
    }

    const decoded = decodeUpdate(encodeUpdate(all));
    expect(Array.from(decoded!)).toEqual(Array.from(all));
  });

  it.each([0, 1, 2, 3, 4, 5])(
    'round-trips a %i-byte update, covering each padding case',
    (length) => {
      const bytes = new Uint8Array(length).map((_, index) => index * 37);
      const encoded = encodeUpdate(bytes);

      if (length === 0) {
        // btoa('') is '', which decodeUpdate rejects as unusable — and an empty
        // update is never worth storing anyway.
        expect(decodeUpdate(encoded)).toBeNull();
        return;
      }
      expect(Array.from(decodeUpdate(encoded)!)).toEqual(Array.from(bytes));
    },
  );

  it('round-trips an update far larger than the chunk size', () => {
    // Builds a genuinely large document rather than random bytes, so this
    // exercises the size a real trip could reach.
    const doc = new Y.Doc();
    const guests = doc.getMap('guestsById');
    for (let index = 0; index < 4000; index += 1) {
      const row = new Y.Map<unknown>();
      guests.set(`person-${index}`, row);
      row.set('name', `Guest number ${index}`);
      row.set('notes', 'some notes that add weight to each record');
    }

    const update = Y.encodeStateAsUpdate(doc);
    expect(update.byteLength).toBeGreaterThan(8192);

    // `String.fromCharCode(...bytes)` on this would throw RangeError, which is
    // why both directions work in chunks.
    const decoded = decodeUpdate(encodeUpdate(update));
    expect(Array.from(decoded!)).toEqual(Array.from(update));
  });

  it('produces base64 the server check constraint accepts', () => {
    const doc = new Y.Doc();
    doc.getMap('guestsById').set('p1', new Y.Map());

    const encoded = encodeUpdate(Y.encodeStateAsUpdate(doc));

    // The column is `check ("update" ~ '^[A-Za-z0-9+/]+={0,2}$')`.
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});

// ============================================================================
// Malformed input
// ============================================================================

describe('decodeUpdate — untrusted input', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an object', { update: 'AQID' }],
    ['an array', ['AQID']],
    ['an empty string', ''],
  ])('returns null for %s', (_label, value) => {
    expect(decodeUpdate(value)).toBeNull();
  });

  it.each([
    ['characters outside the alphabet', 'not valid base64!!'],
    ['a data URL prefix', 'data:application/octet-stream;base64,AQID'],
    ['embedded whitespace', 'AQ ID'],
    ['a newline, as some encoders emit', 'AQID\nAQID'],
    ['url-safe base64, which the constraint rejects', 'AQ-D_w'],
    ['an impossible length', 'AQIDA'],
  ])('returns null for %s', (_label, value) => {
    // One unreadable row must be skippable, not fatal to the whole pull.
    expect(decodeUpdate(value)).toBeNull();
  });
});

// ============================================================================
// State vectors
// ============================================================================

describe('areStateVectorsEqual', () => {
  it('is true when two documents hold the same state', () => {
    const left = new Y.Doc();
    left.getMap('guestsById').set('p1', new Y.Map());
    const right = new Y.Doc();
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));

    expect(
      areStateVectorsEqual(Y.encodeStateVector(left), Y.encodeStateVector(right)),
    ).toBe(true);
  });

  it('is false once one document moves ahead', () => {
    const left = new Y.Doc();
    left.getMap('guestsById').set('p1', new Y.Map());
    const before = Y.encodeStateVector(left);
    left.getMap('guestsById').set('p2', new Y.Map());

    expect(areStateVectorsEqual(before, Y.encodeStateVector(left))).toBe(false);
  });

  it('is false when either side is missing', () => {
    const vector = Y.encodeStateVector(new Y.Doc());

    // No stored vector means "the server has nothing of ours", which must read
    // as not-equal so the first upload actually happens.
    expect(areStateVectorsEqual(undefined, vector)).toBe(false);
    expect(areStateVectorsEqual(vector, undefined)).toBe(false);
    expect(areStateVectorsEqual(undefined, undefined)).toBe(false);
  });

  it('is false for equal-length vectors that differ in content', () => {
    expect(
      areStateVectorsEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])),
    ).toBe(false);
  });
});
