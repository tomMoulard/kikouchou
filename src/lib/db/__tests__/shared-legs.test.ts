/**
 * Tests for the shared-leg key, grouping and field helpers.
 *
 * @module lib/db/__tests__/shared-legs.test
 */
import { describe, expect, it } from 'vitest';

import {
  SHARED_LEG_FIELDS,
  copySharedLegFields,
  getSharedLegKey,
  groupSharedLegs,
  listSharedLegMates,
  pickSharedLegFields,
  toSharedLegIdOrUndefined,
} from '@/lib/db/shared-legs';
import type {
  PersonId,
  SharedLegId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

function leg(id: string, fields: Partial<Transport> = {}): Transport {
  return {
    id: id as TransportId,
    tripId: 'trip' as TripId,
    personId: `person-${id}` as PersonId,
    type: 'arrival',
    datetime: '2024-07-15T14:30:00.000Z',
    location: 'Gare de Lyon',
    needsPickup: false,
    ...fields,
  } as Transport;
}

describe('getSharedLegKey', () => {
  it('is the leg id for a leg nobody joined', () => {
    expect(getSharedLegKey(leg('a'))).toBe('a');
  });

  it('is the founder id for a leg that joined', () => {
    expect(getSharedLegKey(leg('b', { sharedLegId: 'a' as SharedLegId }))).toBe('a');
  });
});

describe('toSharedLegIdOrUndefined', () => {
  it('keeps an id-shaped key', () => {
    expect(toSharedLegIdOrUndefined('V1StGXR8_Z5jdHi6B-myT')).toBe('V1StGXR8_Z5jdHi6B-myT');
  });

  it.each([
    ['an empty string', ''],
    ['free text', 'TGV 6105 to Lyon'],
    ['an overlong string', 'a'.repeat(65)],
    ['a number', 42],
    ['an object', { id: 'a' }],
    ['undefined', undefined],
  ])('drops %s', (_label, value) => {
    expect(toSharedLegIdOrUndefined(value)).toBeUndefined();
  });
});

describe('groupSharedLegs', () => {
  it('groups by key, in the order the groups first appear', () => {
    const a = leg('a');
    const b = leg('b', { sharedLegId: 'a' as SharedLegId });
    const c = leg('c');
    const d = leg('d', { sharedLegId: 'a' as SharedLegId });

    expect(groupSharedLegs([c, a, b, d])).toEqual([[c], [a, b, d]]);
  });

  it('splits one train by what each row must speak for', () => {
    const a = leg('a', { needsPickup: true });
    const b = leg('b', { sharedLegId: 'a' as SharedLegId, needsPickup: false });
    const c = leg('c', { sharedLegId: 'a' as SharedLegId, needsPickup: true });

    expect(groupSharedLegs([a, b, c], (row) => String(row.needsPickup))).toEqual([
      [a, c],
      [b],
    ]);
  });
});

describe('listSharedLegMates', () => {
  it('lists the other legs of the train, not the leg itself', () => {
    const a = leg('a');
    const b = leg('b', { sharedLegId: 'a' as SharedLegId });
    const c = leg('c');

    expect(listSharedLegMates(b, [a, b, c])).toEqual([a]);
    expect(listSharedLegMates(c, [a, b, c])).toEqual([]);
  });
});

describe('pickSharedLegFields', () => {
  it("keeps the train's fields and drops the guest's", () => {
    expect(
      pickSharedLegFields({
        personId: 'p' as PersonId,
        location: 'Lyon',
        needsPickup: true,
        notes: undefined,
      }),
    ).toEqual({ location: 'Lyon', notes: undefined });
  });

  it('keeps a field written as undefined, which is how a patch clears it', () => {
    expect(Object.keys(pickSharedLegFields({ transportNumber: undefined }))).toEqual([
      'transportNumber',
    ]);
  });
});

describe('copySharedLegFields', () => {
  it('copies only the fields the train has', () => {
    const copied = copySharedLegFields(
      leg('a', { transportNumber: 'TGV 6105', needsPickup: true }),
    );

    expect(copied).toEqual({
      type: 'arrival',
      datetime: '2024-07-15T14:30:00.000Z',
      location: 'Gare de Lyon',
      transportNumber: 'TGV 6105',
    });
    expect(Object.keys(copied).every((key) => (SHARED_LEG_FIELDS as readonly string[]).includes(key))).toBe(true);
  });
});
