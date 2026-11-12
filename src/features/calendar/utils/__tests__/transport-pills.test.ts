/**
 * Tests for merging the guests of one train into one calendar pill.
 *
 * @module features/calendar/utils/__tests__/transport-pills.test
 */
import { describe, expect, it } from 'vitest';

import type { CalendarTransport } from '../../types';
import { mergeSharedLegPills } from '../transport-pills';
import type { HexColor, PersonId, SharedLegId, Transport, TransportId, TripId } from '@/types';

function pill(id: string, name: string, fields: Partial<Transport> = {}): CalendarTransport {
  return {
    transport: {
      id: id as TransportId,
      tripId: 'trip' as TripId,
      personId: `person-${id}` as PersonId,
      type: 'arrival',
      datetime: '2026-07-15T14:30:00.000Z',
      location: 'Gare de Lyon',
      needsPickup: false,
      ...fields,
    } as Transport,
    person: undefined,
    personName: name,
    color: '#3b82f6' as HexColor,
  };
}

describe('mergeSharedLegPills', () => {
  it('draws the guests of one train as one pill naming each of them', () => {
    const alice = pill('a', 'Alice');
    const bob = pill('b', 'Bob', { sharedLegId: 'a' as SharedLegId });

    const [merged, ...rest] = mergeSharedLegPills([alice, bob]);

    expect(rest).toEqual([]);
    expect(merged?.transport.id).toBe('a');
    expect(merged?.personName).toBe('Alice, Bob');
    expect(merged?.sharedWith?.map((leg) => leg.id)).toEqual(['b']);
  });

  it('keeps apart guests on different trains', () => {
    expect(mergeSharedLegPills([pill('a', 'Alice'), pill('b', 'Bob')])).toHaveLength(2);
  });

  it('keeps apart a guest of the same train whose pickup differs', () => {
    const alice = pill('a', 'Alice');
    const bob = pill('b', 'Bob', { sharedLegId: 'a' as SharedLegId, needsPickup: true });
    const carol = pill('c', 'Carol', {
      sharedLegId: 'a' as SharedLegId,
      driverId: 'person-x' as PersonId,
    });

    expect(mergeSharedLegPills([alice, bob, carol])).toHaveLength(3);
  });
});
