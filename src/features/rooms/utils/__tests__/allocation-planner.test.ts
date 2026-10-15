/**
 * @fileoverview Tests for the suggested room allocation.
 *
 * @module features/rooms/utils/__tests__/allocation-planner.test
 */

import { describe, expect, it } from 'vitest';

import {
  planRoomAllocation,
  type GuestNeedingRoom,
  type SuggestedStay,
} from '../allocation-planner';
import { createHeadcountResolver } from '../capacity-utils';
import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  TripId,
} from '@/types';

// ============================================================================
// Test Helpers
// ============================================================================

function makePerson(id: string, headcount?: number): Person {
  return {
    id: id as PersonId,
    tripId: 'trip-1' as TripId,
    name: id,
    color: '#3b82f6' as HexColor,
    ...(headcount === undefined ? {} : { headcount }),
  };
}

function makeRoom(id: string, capacity: number, order: number): Room {
  return {
    id: id as RoomId,
    tripId: 'trip-1' as TripId,
    name: id,
    capacity,
    order,
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

/** Nights `start … end - 1`, as a guest's list of uncovered days. */
function nights(...days: readonly string[]): readonly string[] {
  return days;
}

function guest(person: Person, unassignedDates: readonly string[]): GuestNeedingRoom {
  return { person, unassignedDates };
}

/** No party ties at all: everybody travels alone. */
function soloParties(persons: readonly Person[]): ReadonlyMap<PersonId, string> {
  return new Map(persons.map((person) => [person.id, person.id]));
}

function roomOf(stays: readonly SuggestedStay[], personId: string): RoomId | null {
  const stay = stays.find((candidate) => candidate.personId === personId);
  expect(stay).toBeDefined();
  return stay!.roomId;
}

// ============================================================================
// Tests
// ============================================================================

describe('planRoomAllocation', () => {
  it('returns nothing when no guest needs a room', () => {
    expect(
      planRoomAllocation({
        guests: [],
        rooms: [makeRoom('room-1', 2, 0)],
        assignments: [],
        headcountOf: () => 1,
        partyOf: new Map(),
      }),
    ).toEqual([]);
  });

  it('books the whole gap as one stay, in check-out form', () => {
    const alice = makePerson('alice');

    const stays = planRoomAllocation({
      guests: [guest(alice, nights('2026-07-01', '2026-07-02', '2026-07-03'))],
      rooms: [makeRoom('room-1', 2, 0)],
      assignments: [],
      headcountOf: createHeadcountResolver([alice]),
      partyOf: soloParties([alice]),
    });

    expect(stays).toEqual([
      {
        personId: 'alice',
        roomId: 'room-1',
        startDate: '2026-07-01',
        // Check-out is the morning after the last night.
        endDate: '2026-07-04',
        nights: ['2026-07-01', '2026-07-02', '2026-07-03'],
        partyKey: 'alice',
      },
    ]);
  });

  it('splits a guest with two separate gaps into two stays', () => {
    const alice = makePerson('alice');

    const stays = planRoomAllocation({
      guests: [guest(alice, nights('2026-07-01', '2026-07-04'))],
      rooms: [makeRoom('room-1', 2, 0)],
      assignments: [],
      headcountOf: createHeadcountResolver([alice]),
      partyOf: soloParties([alice]),
    });

    expect(stays.map((stay) => [stay.startDate, stay.endDate])).toEqual([
      ['2026-07-01', '2026-07-02'],
      ['2026-07-04', '2026-07-05'],
    ]);
  });

  it('never exceeds a room capacity, counting people not rows', () => {
    // One guest row standing for four people does not fit a double.
    const family = makePerson('family', 4);

    const stays = planRoomAllocation({
      guests: [guest(family, nights('2026-07-01'))],
      rooms: [makeRoom('double', 2, 0), makeRoom('dorm', 4, 1)],
      assignments: [],
      headcountOf: createHeadcountResolver([family]),
      partyOf: soloParties([family]),
    });

    expect(roomOf(stays, 'family')).toBe('dorm');
  });

  it('counts the beds already taken on the night that is tight', () => {
    const alice = makePerson('alice');
    const bob = makePerson('bob');

    const stays = planRoomAllocation({
      guests: [guest(bob, nights('2026-07-02'))],
      rooms: [makeRoom('room-1', 1, 0), makeRoom('room-2', 1, 1)],
      assignments: [
        makeAssignment('a1', 'alice', 'room-1', '2026-07-01', '2026-07-05'),
      ],
      headcountOf: createHeadcountResolver([alice, bob]),
      partyOf: soloParties([alice, bob]),
    });

    expect(roomOf(stays, 'bob')).toBe('room-2');
  });

  it('reports a stay no room can take rather than dropping it', () => {
    const alice = makePerson('alice');
    const bob = makePerson('bob');

    const stays = planRoomAllocation({
      guests: [guest(bob, nights('2026-07-01'))],
      rooms: [makeRoom('room-1', 1, 0)],
      assignments: [
        makeAssignment('a1', 'alice', 'room-1', '2026-07-01', '2026-07-02'),
      ],
      headcountOf: createHeadcountResolver([alice, bob]),
      partyOf: soloParties([alice, bob]),
    });

    expect(stays).toHaveLength(1);
    expect(roomOf(stays, 'bob')).toBeNull();
  });

  it('puts a whole party in one room when one is big enough', () => {
    const alice = makePerson('alice');
    const bob = makePerson('bob');
    const carol = makePerson('carol');
    const party = new Map<PersonId, string>([
      [alice.id, 'party'],
      [bob.id, 'party'],
      [carol.id, 'party'],
    ]);

    const stays = planRoomAllocation({
      guests: [
        guest(alice, nights('2026-07-01', '2026-07-02')),
        guest(bob, nights('2026-07-01', '2026-07-02')),
        guest(carol, nights('2026-07-01', '2026-07-02')),
      ],
      // Two doubles would take them with a bed to spare, and split them up.
      rooms: [makeRoom('double-a', 2, 0), makeRoom('double-b', 2, 1), makeRoom('triple', 3, 2)],
      assignments: [],
      headcountOf: createHeadcountResolver([alice, bob, carol]),
      partyOf: party,
    });

    expect(roomOf(stays, 'alice')).toBe('triple');
    expect(roomOf(stays, 'bob')).toBe('triple');
    expect(roomOf(stays, 'carol')).toBe('triple');
  });

  it('sends a party member to the room the party already sleeps in', () => {
    const alice = makePerson('alice');
    const bob = makePerson('bob');
    const party = new Map<PersonId, string>([
      [alice.id, 'party'],
      [bob.id, 'party'],
    ]);

    const stays = planRoomAllocation({
      guests: [guest(bob, nights('2026-07-01'))],
      // An empty room would otherwise win on the "fill rather than scatter"
      // rule; the party tie outranks it.
      rooms: [makeRoom('with-alice', 2, 0), makeRoom('empty', 2, 1)],
      assignments: [
        makeAssignment('a1', 'alice', 'with-alice', '2026-07-01', '2026-07-02'),
      ],
      headcountOf: createHeadcountResolver([alice, bob]),
      partyOf: party,
    });

    expect(roomOf(stays, 'bob')).toBe('with-alice');
  });

  it('splits a party that no single room can hold, keeping capacity', () => {
    const alice = makePerson('alice');
    const bob = makePerson('bob');
    const carol = makePerson('carol');
    const party = new Map<PersonId, string>([
      [alice.id, 'party'],
      [bob.id, 'party'],
      [carol.id, 'party'],
    ]);

    const stays = planRoomAllocation({
      guests: [
        guest(alice, nights('2026-07-01')),
        guest(bob, nights('2026-07-01')),
        guest(carol, nights('2026-07-01')),
      ],
      rooms: [makeRoom('double', 2, 0), makeRoom('single', 1, 1)],
      assignments: [],
      headcountOf: createHeadcountResolver([alice, bob, carol]),
      partyOf: party,
    });

    const rooms = stays.map((stay) => stay.roomId);
    expect(rooms.filter((roomId) => roomId === 'double')).toHaveLength(2);
    expect(rooms.filter((roomId) => roomId === 'single')).toHaveLength(1);
    expect(rooms).not.toContain(null);
  });

  it('fills a tight room before opening a roomy one', () => {
    const alice = makePerson('alice');

    const stays = planRoomAllocation({
      guests: [guest(alice, nights('2026-07-01'))],
      rooms: [makeRoom('dorm', 6, 0), makeRoom('single', 1, 1)],
      assignments: [],
      headcountOf: createHeadcountResolver([alice]),
      partyOf: soloParties([alice]),
    });

    expect(roomOf(stays, 'alice')).toBe('single');
  });

  it('returns a party stays in date order, whatever order it placed them in', () => {
    const alice = makePerson('alice');
    const bob = makePerson('bob');
    const party = new Map<PersonId, string>([
      [alice.id, 'party'],
      [bob.id, 'party'],
    ]);

    const stays = planRoomAllocation({
      // Alice's single night comes first in the trip; Bob's three nights are
      // placed first, because the longest stay is the hardest to fit.
      guests: [
        guest(alice, nights('2026-07-01')),
        guest(bob, nights('2026-07-05', '2026-07-06', '2026-07-07')),
      ],
      rooms: [makeRoom('single', 1, 0)],
      assignments: [],
      headcountOf: createHeadcountResolver([alice, bob]),
      partyOf: party,
    });

    expect(stays.map((stay) => stay.personId)).toEqual(['alice', 'bob']);
  });
});
