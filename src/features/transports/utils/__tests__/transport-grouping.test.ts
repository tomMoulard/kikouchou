/**
 * @fileoverview Tests for the dated grouping the transport list and the run
 * sheet share.
 *
 * @module features/transports/utils/__tests__/transport-grouping.test
 */

import { enUS } from 'date-fns/locale';
import { describe, expect, it } from 'vitest';

import {
  countGroupedTransports,
  getTransportDateKey,
  groupTransportsByDate,
} from '../transport-grouping';

import type { Transport } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Builds a transport with only the fields the grouping reads.
 *
 * Datetimes here are offset-less local values, which is what the transport
 * form writes and what a calendar day is read back from.
 *
 * @param id - Transport id
 * @param datetime - Local ISO datetime
 * @returns A transport fixture
 */
function transport(id: string, datetime: string): Transport {
  return {
    id,
    tripId: 'trip-1',
    personId: 'person-1',
    type: 'arrival',
    datetime,
    location: 'Gare du Nord',
    needsPickup: false,
  } as unknown as Transport;
}

// ============================================================================
// Tests
// ============================================================================

describe('getTransportDateKey', () => {
  it('reads the local day out of a datetime', () => {
    expect(getTransportDateKey('2026-07-15T14:30:00')).toBe('2026-07-15');
  });

  it('returns an empty key for a datetime it cannot read', () => {
    expect(getTransportDateKey('not a datetime')).toBe('');
    expect(getTransportDateKey('')).toBe('');
  });
});

describe('groupTransportsByDate', () => {
  it('groups by day, earliest day first', () => {
    const groups = groupTransportsByDate(
      [
        transport('later-day', '2026-07-16T09:00:00'),
        transport('first-day', '2026-07-15T18:00:00'),
      ],
      enUS,
    );

    expect(groups.map((group) => group.dateKey)).toEqual(['2026-07-15', '2026-07-16']);
    expect(groups[0]?.displayDate).not.toBe('');
  });

  it('orders the legs of one day by instant', () => {
    const groups = groupTransportsByDate(
      [
        transport('evening', '2026-07-15T18:00:00'),
        transport('morning', '2026-07-15T08:00:00'),
      ],
      enUS,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.transports.map((leg) => leg.id)).toEqual(['morning', 'evening']);
  });

  it('drops a leg it cannot place on a day', () => {
    const groups = groupTransportsByDate(
      [transport('good', '2026-07-15T08:00:00'), transport('bad', 'nonsense')],
      enUS,
    );

    expect(countGroupedTransports(groups)).toBe(1);
  });

  it('does not mutate the list it was handed', () => {
    const input = [
      transport('evening', '2026-07-15T18:00:00'),
      transport('morning', '2026-07-15T08:00:00'),
    ];

    groupTransportsByDate(input, enUS);

    expect(input.map((leg) => leg.id)).toEqual(['evening', 'morning']);
  });
});

describe('countGroupedTransports', () => {
  it('totals the legs the groups hold', () => {
    const groups = groupTransportsByDate(
      [
        transport('a', '2026-07-15T08:00:00'),
        transport('b', '2026-07-15T09:00:00'),
        transport('c', '2026-07-16T09:00:00'),
      ],
      enUS,
    );

    expect(countGroupedTransports(groups)).toBe(3);
  });

  it('counts nothing for no groups', () => {
    expect(countGroupedTransports([])).toBe(0);
  });
});
