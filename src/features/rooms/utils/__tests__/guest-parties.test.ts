/**
 * @fileoverview Tests for guest party inference.
 *
 * @module features/rooms/utils/__tests__/guest-parties.test
 */

import { describe, expect, it } from 'vitest';

import { tripDay } from '@/features/rooms/__tests__/fixture-days';
import { inferGuestParties } from '../guest-parties';
import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Test Helpers
// ============================================================================

function makePerson(id: string, name = id): Person {
  return {
    id: id as PersonId,
    tripId: 'trip-1' as TripId,
    name,
    color: '#3b82f6' as HexColor,
  };
}

function makeAssignment(
  id: string,
  personId: string,
  roomId: string,
  startDate: string,
  endDate: string,
): RoomAssignment {
  return {
    id: id as RoomAssignmentId,
    tripId: 'trip-1' as TripId,
    roomId: roomId as RoomId,
    personId: personId as PersonId,
    startDate: startDate as ISODateString,
    endDate: endDate as ISODateString,
  };
}

function makeArrival(
  id: string,
  personId: string,
  datetime: string,
  location: string,
): Transport {
  return {
    id: id as TransportId,
    tripId: 'trip-1' as TripId,
    personId: personId as PersonId,
    type: 'arrival',
    datetime,
    location,
    needsPickup: false,
  } as Transport;
}

// ============================================================================
// Tests
// ============================================================================

describe('inferGuestParties', () => {
  it('gives a guest who travels alone a party of their own', () => {
    const parties = inferGuestParties({
      persons: [makePerson('alice'), makePerson('bob')],
      assignments: [],
      arrivals: [],
    });

    expect(parties.get('alice' as PersonId)).toBeDefined();
    expect(parties.get('alice' as PersonId)).not.toBe(
      parties.get('bob' as PersonId),
    );
  });

  it('keeps guests who already share a room in one party', () => {
    const parties = inferGuestParties({
      persons: [makePerson('alice'), makePerson('bob')],
      assignments: [
        makeAssignment('a1', 'alice', 'room-1', '2026-07-01', '2026-07-05'),
        makeAssignment('a2', 'bob', 'room-1', '2026-07-03', '2026-07-08'),
      ],
      arrivals: [],
    });

    expect(parties.get('alice' as PersonId)).toBe(parties.get('bob' as PersonId));
  });

  it('does not merge back-to-back stays in the same room', () => {
    // Bob checks in the morning Alice checks out: one room, no shared night,
    // which is a room handover rather than two people travelling together.
    const parties = inferGuestParties({
      persons: [makePerson('alice'), makePerson('bob')],
      assignments: [
        makeAssignment('a1', 'alice', 'room-1', '2026-07-01', '2026-07-05'),
        makeAssignment('a2', 'bob', 'room-1', '2026-07-05', '2026-07-08'),
      ],
      arrivals: [],
    });

    expect(parties.get('alice' as PersonId)).not.toBe(
      parties.get('bob' as PersonId),
    );
  });

  it('keeps guests who arrive at the same time and place in one party', () => {
    const parties = inferGuestParties({
      persons: [makePerson('alice'), makePerson('bob'), makePerson('carol')],
      assignments: [],
      arrivals: [
        makeArrival('t1', 'alice', '2026-07-01T14:00:00', 'Gare de Lyon'),
        makeArrival('t2', 'bob', '2026-07-01T14:00:00', 'gare de  lyon '),
        makeArrival('t3', 'carol', '2026-07-01T18:30:00', 'Gare de Lyon'),
      ],
    });

    expect(parties.get('alice' as PersonId)).toBe(parties.get('bob' as PersonId));
    expect(parties.get('carol' as PersonId)).not.toBe(
      parties.get('alice' as PersonId),
    );
  });

  it('ignores an arrival with no place, however exact the time', () => {
    const parties = inferGuestParties({
      persons: [makePerson('alice'), makePerson('bob')],
      assignments: [],
      arrivals: [
        makeArrival('t1', 'alice', '2026-07-01T14:00:00', '   '),
        makeArrival('t2', 'bob', '2026-07-01T14:00:00', ''),
      ],
    });

    expect(parties.get('alice' as PersonId)).not.toBe(
      parties.get('bob' as PersonId),
    );
  });

  it('merges parties that the two signals join at either end', () => {
    // Alice and Bob arrive together; Bob and Carol already share a room. All
    // three are one party, whichever signal is read first.
    const parties = inferGuestParties({
      persons: [makePerson('alice'), makePerson('bob'), makePerson('carol')],
      assignments: [
        makeAssignment('a1', 'bob', 'room-1', '2026-07-01', '2026-07-05'),
        makeAssignment('a2', 'carol', 'room-1', '2026-07-01', '2026-07-05'),
      ],
      arrivals: [
        makeArrival('t1', 'alice', '2026-07-01T14:00:00', 'Gare de Lyon'),
        makeArrival('t2', 'bob', '2026-07-01T14:00:00', 'Gare de Lyon'),
      ],
    });

    const key = parties.get('alice' as PersonId);
    expect(parties.get('bob' as PersonId)).toBe(key);
    expect(parties.get('carol' as PersonId)).toBe(key);
  });

  it('leaves out records for guests who are not on the trip', () => {
    const parties = inferGuestParties({
      persons: [makePerson('alice')],
      assignments: [
        makeAssignment('a1', 'alice', 'room-1', '2026-07-01', '2026-07-05'),
        makeAssignment('a2', 'ghost', 'room-1', '2026-07-01', '2026-07-05'),
      ],
      arrivals: [makeArrival('t1', 'ghost', '2026-07-01T14:00:00', 'Gare')],
    });

    expect([...parties.keys()]).toEqual(['alice']);
  });
});

describe('inferGuestParties, the key a party gets', () => {
  it.each([
    ['the smaller id first', ['amy', 'zed']],
    ['the larger id first', ['zed', 'amy']],
  ])('names a party after its smallest id, with %s', (_name, order) => {
    const parties = inferGuestParties({
      persons: [makePerson('amy'), makePerson('zed')],
      assignments: order.map((personId, index) =>
        makeAssignment(`a${index}`, personId, 'room-1', tripDay(1), tripDay(5)),
      ),
      arrivals: [],
    });

    expect(parties.get('amy' as PersonId)).toBe('amy');
    expect(parties.get('zed' as PersonId)).toBe('amy');
  });

  it('lets no stranger to the trip join or rename a party', () => {
    const parties = inferGuestParties({
      persons: [makePerson('bob'), makePerson('cat')],
      assignments: [
        makeAssignment('a1', 'aaa', 'room-1', tripDay(1), tripDay(5)),
        makeAssignment('a2', 'bob', 'room-1', tripDay(1), tripDay(5)),
      ],
      arrivals: [
        makeArrival('t1', 'aaa', `${tripDay(1)}T14:00:00`, 'Gare'),
        makeArrival('t2', 'cat', `${tripDay(1)}T14:00:00`, 'Gare'),
      ],
    });

    expect(parties.get('bob' as PersonId)).toBe('bob');
    expect(parties.get('cat' as PersonId)).toBe('cat');
  });

  it('ignores an arrival with no time, however exact the place', () => {
    const parties = inferGuestParties({
      persons: [makePerson('alice'), makePerson('bob')],
      assignments: [],
      arrivals: [
        makeArrival('t1', 'alice', '', 'Gare de Lyon'),
        makeArrival('t2', 'bob', '', 'Gare de Lyon'),
      ],
    });

    expect(parties.get('alice' as PersonId)).not.toBe(parties.get('bob' as PersonId));
  });

  it('ignores an arrival whose place was never filled in', () => {
    const noPlace = (id: string, personId: string): Transport => ({
      ...makeArrival(id, personId, `${tripDay(1)}T14:00:00`, ''),
      location: undefined as unknown as string,
    });
    const parties = inferGuestParties({
      persons: [makePerson('alice'), makePerson('bob')],
      assignments: [],
      arrivals: [noPlace('t1', 'alice'), noPlace('t2', 'bob')],
    });

    expect(parties.get('alice' as PersonId)).not.toBe(parties.get('bob' as PersonId));
  });

  it('keeps the spaces between words when it compares places', () => {
    const parties = inferGuestParties({
      persons: [makePerson('alice'), makePerson('bob')],
      assignments: [],
      arrivals: [
        makeArrival('t1', 'alice', `${tripDay(1)}T14:00:00`, 'Gare de Lyon'),
        makeArrival('t2', 'bob', `${tripDay(1)}T14:00:00`, 'Gare deLyon'),
      ],
    });

    expect(parties.get('alice' as PersonId)).not.toBe(parties.get('bob' as PersonId));
  });
});
