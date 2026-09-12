/**
 * Tests for the outbound guest redaction.
 *
 * @module lib/sharing/__tests__/guest-privacy.test
 */

import { describe, expect, it } from 'vitest';

import { toSharedGuest } from '../guest-privacy';

describe('toSharedGuest', () => {
  const mary = { id: 'guest-1', name: 'Mary', phone: '+33 6 12 34 56 78' };

  it('passes the phone through while sharing is on', () => {
    expect(toSharedGuest(mary, { sharePhone: true })).toEqual(mary);
  });

  it('drops the phone while sharing is off', () => {
    expect(toSharedGuest(mary, { sharePhone: false })).toEqual({
      id: 'guest-1',
      name: 'Mary',
    });
  });

  it('removes the key rather than setting it undefined', () => {
    // Load-bearing: `upsertDocEntity` prunes keys the entity does not carry, so
    // an absent `phone` un-shares a number a previous session published. A key
    // present with an undefined value is a different write.
    const shared = toSharedGuest(mary, { sharePhone: false });

    expect('phone' in shared).toBe(false);
  });

  it('never mutates the row it was given', () => {
    // The input is a live Dexie row on the way to the document; redacting it in
    // place would delete the local copy the flag is meant to preserve.
    toSharedGuest(mary, { sharePhone: false });

    expect(mary.phone).toBe('+33 6 12 34 56 78');
  });

  it('leaves everything else on the guest alone', () => {
    const guest = {
      id: 'guest-2',
      name: 'Alice+Auré',
      color: '#3b82f6',
      headcount: 2,
      notes: 'Vegan',
      phone: '0612345678',
    };

    expect(toSharedGuest(guest, { sharePhone: false })).toEqual({
      id: 'guest-2',
      name: 'Alice+Auré',
      color: '#3b82f6',
      headcount: 2,
      notes: 'Vegan',
    });
  });

  it('returns a guest with no phone unchanged, whatever the flag says', () => {
    const guest = { id: 'guest-3', name: 'Bob' };

    expect(toSharedGuest(guest, { sharePhone: false })).toBe(guest);
    expect(toSharedGuest(guest, { sharePhone: true })).toBe(guest);
  });
});
