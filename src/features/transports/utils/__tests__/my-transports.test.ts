/**
 * @fileoverview Tests for the "which of these legs are mine?" selection.
 *
 * @module features/transports/utils/__tests__/my-transports.test
 */

import { describe, expect, it } from 'vitest';

import {
  isDrivenBy,
  isMyTransport,
  isTravelledBy,
  selectMyTransports,
} from '../my-transports';

import type { PersonId, Transport } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const ME = 'person-me' as PersonId;
const SOMEBODY = 'person-other' as PersonId;

/**
 * Builds a transport with only the fields this selection reads.
 *
 * @param id - Transport id
 * @param overrides - Fields to set on top of the defaults
 * @returns A transport fixture
 */
function transport(id: string, overrides: Partial<Transport> = {}): Transport {
  return {
    id,
    tripId: 'trip-1',
    personId: SOMEBODY,
    type: 'arrival',
    datetime: '2026-07-02T14:00:00.000Z',
    location: 'Gare du Nord',
    needsPickup: false,
    ...overrides,
  } as unknown as Transport;
}

// ============================================================================
// Tests
// ============================================================================

describe('isDrivenBy / isTravelledBy / isMyTransport', () => {
  it('reads the driver and the traveller apart', () => {
    const ride = transport('t1', { driverId: ME });

    expect(isDrivenBy(ride, ME)).toBe(true);
    expect(isTravelledBy(ride, ME)).toBe(false);
    expect(isMyTransport(ride, ME)).toBe(true);
  });

  it('claims nothing for nobody', () => {
    const ride = transport('t1', { driverId: ME, personId: ME });

    expect(isDrivenBy(ride, undefined)).toBe(false);
    expect(isTravelledBy(ride, undefined)).toBe(false);
    expect(isMyTransport(ride, undefined)).toBe(false);
  });

  it('does not claim somebody else’s leg', () => {
    const ride = transport('t1', { personId: SOMEBODY, driverId: SOMEBODY });

    expect(isMyTransport(ride, ME)).toBe(false);
  });
});

describe('selectMyTransports', () => {
  it('returns nothing when this browser is nobody', () => {
    const result = selectMyTransports([transport('t1', { driverId: ME })], undefined);

    expect(result.driving).toEqual([]);
    expect(result.traveling).toEqual([]);
  });

  it('splits the legs driven from the legs travelled', () => {
    const driven = transport('driven', { driverId: ME });
    const travelled = transport('travelled', { personId: ME });
    const neither = transport('neither');

    const result = selectMyTransports([driven, travelled, neither], ME);

    expect(result.driving.map((leg) => leg.id)).toEqual(['driven']);
    expect(result.traveling.map((leg) => leg.id)).toEqual(['travelled']);
  });

  it('lists a leg somebody drives themself in both places', () => {
    const own = transport('own', { personId: ME, driverId: ME });

    const result = selectMyTransports([own], ME);

    expect(result.driving.map((leg) => leg.id)).toEqual(['own']);
    expect(result.traveling.map((leg) => leg.id)).toEqual(['own']);
  });

  it('orders each list by instant, not by the datetime string', () => {
    // `+02:00` reads later than `Z` as a string and happens an hour earlier.
    const later = transport('later', {
      driverId: ME,
      datetime: '2026-07-15T13:00:00Z',
    });
    const earlier = transport('earlier', {
      driverId: ME,
      datetime: '2026-07-15T14:00:00+02:00',
    });

    const result = selectMyTransports([later, earlier], ME);

    expect(result.driving.map((leg) => leg.id)).toEqual(['earlier', 'later']);
  });
});
