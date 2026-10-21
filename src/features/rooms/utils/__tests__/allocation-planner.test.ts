/**
 * @fileoverview Tests for the suggested room allocation.
 *
 * @module features/rooms/utils/__tests__/allocation-planner.test
 */

import { describe, expect, it } from 'vitest';

import { tripDay } from '@/features/rooms/__tests__/fixture-days';
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

describe('planRoomAllocation, choosing between rooms that all fit', () => {
  function place(
    guests: readonly GuestNeedingRoom[],
    rooms: readonly Room[],
    options: {
      readonly assignments?: readonly RoomAssignment[];
      readonly persons?: readonly Person[];
      readonly partyOf?: ReadonlyMap<PersonId, string>;
    } = {},
  ): readonly SuggestedStay[] {
    const persons = options.persons ?? guests.map((entry) => entry.person);
    return planRoomAllocation({
      guests,
      rooms,
      assignments: options.assignments ?? [],
      headcountOf: createHeadcountResolver(persons),
      partyOf: options.partyOf ?? soloParties(persons),
    });
  }

  it('opens an empty room before squeezing into a shared one', () => {
    const alice = makePerson('alice');
    const bob = makePerson('bob');

    const stays = place(
      [guest(bob, nights(tripDay(1)))],
      [makeRoom('shared', 2, 0), makeRoom('empty', 3, 1)],
      {
        persons: [alice, bob],
        assignments: [makeAssignment('a1', 'alice', 'shared', tripDay(1), tripDay(2))],
      },
    );

    expect(roomOf(stays, 'bob')).toBe('empty');
  });

  it('only counts the nights asked for when deciding a room is empty', () => {
    const alice = makePerson('alice');
    const bob = makePerson('bob');

    // Alice sleeps in the single on other nights, so for Bob's night it is
    // as empty as the dorm, and the tighter fit wins.
    const stays = place(
      [guest(bob, nights(tripDay(3)))],
      [makeRoom('dorm', 6, 0), makeRoom('single', 1, 1)],
      {
        persons: [alice, bob],
        assignments: [makeAssignment('a1', 'alice', 'single', tripDay(1), tripDay(3))],
      },
    );

    expect(roomOf(stays, 'bob')).toBe('single');
  });

  it('prefers the tighter of two empty rooms, whatever order they come in', () => {
    const alice = makePerson('alice');

    for (const rooms of [
      [makeRoom('triple', 3, 0), makeRoom('single', 1, 1)],
      [makeRoom('single', 1, 1), makeRoom('triple', 3, 0)],
    ]) {
      expect(roomOf(place([guest(alice, nights(tripDay(1)))], rooms), 'alice')).toBe('single');
    }
  });

  it('breaks a tie between identical rooms by their order', () => {
    const alice = makePerson('alice');

    for (const rooms of [
      [makeRoom('second', 2, 1), makeRoom('first', 2, 0)],
      [makeRoom('first', 2, 0), makeRoom('second', 2, 1)],
    ]) {
      expect(roomOf(place([guest(alice, nights(tripDay(1)))], rooms), 'alice')).toBe('first');
    }
  });

  it('draws a party member to the party room over an empty one listed first', () => {
    const alice = makePerson('alice');
    const bob = makePerson('bob');
    const party = new Map<PersonId, string>([
      [alice.id, 'party'],
      [bob.id, 'party'],
    ]);

    const stays = place(
      [guest(bob, nights(tripDay(1)))],
      [makeRoom('empty', 2, 0), makeRoom('with-alice', 2, 1)],
      {
        persons: [alice, bob],
        partyOf: party,
        assignments: [makeAssignment('a1', 'alice', 'with-alice', tripDay(1), tripDay(2))],
      },
    );

    expect(roomOf(stays, 'bob')).toBe('with-alice');
  });

  it('remembers every room the party already sleeps in', () => {
    const alice = makePerson('alice');
    const bob = makePerson('bob');
    const carol = makePerson('carol');
    const party = new Map<PersonId, string>([
      [alice.id, 'party'],
      [bob.id, 'party'],
      [carol.id, 'party'],
    ]);

    // Alice is in the double and Bob in the quad; both are the party's, and
    // the double is the tighter fit for Carol.
    const stays = place(
      [guest(carol, nights(tripDay(1)))],
      [makeRoom('double', 2, 0), makeRoom('quad', 4, 1), makeRoom('empty', 1, 2)],
      {
        persons: [alice, bob, carol],
        partyOf: party,
        assignments: [
          makeAssignment('a1', 'alice', 'double', tripDay(1), tripDay(2)),
          makeAssignment('a2', 'bob', 'quad', tripDay(1), tripDay(2)),
        ],
      },
    );

    expect(roomOf(stays, 'carol')).toBe('double');
  });

  it.each([
    ['a party that already has a room', true],
    ['a party with no room yet', false],
  ])('keeps the members of %s together once one of them is placed', (_name, hasRoom) => {
    const dan = makePerson('dan');
    const [ann, ben, cat] = [makePerson('ann'), makePerson('ben'), makePerson('cat')];
    const members = hasRoom ? [dan, ann, ben, cat] : [ann, ben, cat];
    const party = new Map<PersonId, string>(members.map((member) => [member.id, 'party']));

    // Three people, two doubles: no room takes all three, so they are placed
    // one by one. Ben must follow Ann into her room rather than the empty one.
    const stays = place(
      [
        guest(ann, nights(tripDay(1))),
        guest(ben, nights(tripDay(1))),
        guest(cat, nights(tripDay(1))),
      ],
      [
        ...(hasRoom ? [makeRoom('full', 1, 0)] : []),
        makeRoom('double-a', 2, 1),
        makeRoom('double-b', 2, 2),
      ],
      {
        persons: members,
        partyOf: party,
        assignments: hasRoom
          ? [makeAssignment('a0', 'dan', 'full', tripDay(1), tripDay(2))]
          : [],
      },
    );

    expect(roomOf(stays, 'ann')).toBe('double-a');
    expect(roomOf(stays, 'ben')).toBe('double-a');
    expect(roomOf(stays, 'cat')).toBe('double-b');
  });

  it('counts a party placed together against the next party', () => {
    const [ann, ben, cat] = [makePerson('ann'), makePerson('ben'), makePerson('cat')];
    const partyOf = new Map<PersonId, string>([
      [ann.id, 'pair'],
      [ben.id, 'pair'],
      [cat.id, 'cat'],
    ]);

    const stays = place(
      [
        guest(ann, nights(tripDay(1))),
        guest(ben, nights(tripDay(1))),
        guest(cat, nights(tripDay(1))),
      ],
      [makeRoom('double', 2, 0), makeRoom('other', 2, 1)],
      { partyOf },
    );

    expect(roomOf(stays, 'ann')).toBe('double');
    expect(roomOf(stays, 'ben')).toBe('double');
    expect(roomOf(stays, 'cat')).toBe('other');
  });

  it('lets the longest stay of a split party pick its room first', () => {
    const [ann, ben] = [makePerson('ann'), makePerson('ben')];
    const party = new Map<PersonId, string>([
      [ann.id, 'party'],
      [ben.id, 'party'],
    ]);

    // Ann's short stay starts first, but Ben's long one is placed first and so
    // gets the first room.
    const stays = place(
      [
        guest(ann, nights(tripDay(1), tripDay(2))),
        guest(ben, nights(tripDay(2), tripDay(3), tripDay(4), tripDay(5))),
      ],
      [makeRoom('first', 1, 0), makeRoom('second', 1, 1)],
      { partyOf: party },
    );

    expect(roomOf(stays, 'ben')).toBe('first');
    expect(roomOf(stays, 'ann')).toBe('second');
  });
});

describe('planRoomAllocation, the order of the proposal', () => {
  function order(
    guests: readonly GuestNeedingRoom[],
    partyOf: ReadonlyMap<PersonId, string>,
  ): string[] {
    const persons = guests.map((entry) => entry.person);
    return planRoomAllocation({
      guests,
      rooms: [makeRoom('dorm', 20, 0)],
      assignments: [],
      headcountOf: createHeadcountResolver(persons),
      partyOf,
    }).map((stay) => stay.personId);
  }

  it('lists a party by date, then by guest', () => {
    const [ann, ben, cat] = [makePerson('ann'), makePerson('ben'), makePerson('cat')];
    const party = new Map<PersonId, string>([
      [ann.id, 'party'],
      [ben.id, 'party'],
      [cat.id, 'party'],
    ]);

    expect(
      order(
        [
          guest(cat, nights(tripDay(1))),
          guest(ben, nights(tripDay(1))),
          guest(ann, nights(tripDay(2))),
        ],
        party,
      ),
    ).toEqual(['ben', 'cat', 'ann']);
  });

  it('places the party with the most nights first', () => {
    const [ann, ben] = [makePerson('ann'), makePerson('ben')];

    expect(
      order(
        [
          guest(ann, nights(tripDay(1))),
          guest(ben, nights(tripDay(1), tripDay(2), tripDay(3))),
        ],
        soloParties([ann, ben]),
      ),
    ).toEqual(['ben', 'ann']);
  });

  it('places the party with more stays first when the nights are equal', () => {
    const [ann, ben, cat] = [makePerson('ann'), makePerson('ben'), makePerson('cat')];
    const partyOf = new Map<PersonId, string>([
      [ann.id, 'ann'],
      [ben.id, 'pair'],
      [cat.id, 'pair'],
    ]);

    expect(
      order(
        [
          guest(ann, nights(tripDay(1), tripDay(2))),
          guest(ben, nights(tripDay(1))),
          guest(cat, nights(tripDay(1))),
        ],
        partyOf,
      ),
    ).toEqual(['ben', 'cat', 'ann']);
  });

  it('falls back on the party key when everything else is equal', () => {
    const [ann, ben] = [makePerson('ann'), makePerson('ben')];

    expect(
      order(
        [guest(ben, nights(tripDay(1))), guest(ann, nights(tripDay(1)))],
        soloParties([ann, ben]),
      ),
    ).toEqual(['ann', 'ben']);
  });
});

describe('planRoomAllocation, more of its choices', () => {
  it('fills the fuller of two shared rooms first', () => {
    const [ann, ben, cat, dan] = ['ann', 'ben', 'cat', 'dan'].map((id) => makePerson(id)) as [
      Person,
      Person,
      Person,
      Person,
    ];

    const stays = planRoomAllocation({
      guests: [guest(dan, nights(tripDay(1)))],
      rooms: [makeRoom('one-taken', 3, 0), makeRoom('two-taken', 3, 1)],
      assignments: [
        makeAssignment('a1', 'ann', 'one-taken', tripDay(1), tripDay(2)),
        makeAssignment('a2', 'ben', 'two-taken', tripDay(1), tripDay(2)),
        makeAssignment('a3', 'cat', 'two-taken', tripDay(1), tripDay(2)),
      ],
      headcountOf: createHeadcountResolver([ann, ben, cat, dan]),
      partyOf: soloParties([ann, ben, cat, dan]),
    });

    expect(roomOf(stays, 'dan')).toBe('two-taken');
  });

  it('remembers a party room it learns of second', () => {
    const alice = makePerson('alice');
    const bob = makePerson('bob');
    const carol = makePerson('carol');
    const party = new Map<PersonId, string>([
      [alice.id, 'party'],
      [bob.id, 'party'],
      [carol.id, 'party'],
    ]);

    const stays = planRoomAllocation({
      guests: [guest(carol, nights(tripDay(1)))],
      rooms: [makeRoom('quad', 4, 0), makeRoom('double', 2, 1), makeRoom('empty', 1, 2)],
      assignments: [
        makeAssignment('a1', 'alice', 'quad', tripDay(1), tripDay(2)),
        makeAssignment('a2', 'bob', 'double', tripDay(1), tripDay(2)),
      ],
      headcountOf: createHeadcountResolver([alice, bob, carol]),
      partyOf: party,
    });

    expect(roomOf(stays, 'carol')).toBe('double');
  });

  it('lists a party by date even when the later stay comes first', () => {
    const [ann, ben] = [makePerson('ann'), makePerson('ben')];
    const party = new Map<PersonId, string>([
      [ann.id, 'party'],
      [ben.id, 'party'],
    ]);

    const stays = planRoomAllocation({
      guests: [guest(ann, nights(tripDay(2))), guest(ben, nights(tripDay(1)))],
      rooms: [makeRoom('dorm', 20, 0)],
      assignments: [],
      headcountOf: createHeadcountResolver([ann, ben]),
      partyOf: party,
    });

    expect(stays.map((stay) => stay.personId)).toEqual(['ben', 'ann']);
  });

  it('orders equal parties by key whatever order they come in', () => {
    const [ann, ben] = [makePerson('ann'), makePerson('ben')];

    const stays = planRoomAllocation({
      guests: [guest(ann, nights(tripDay(1))), guest(ben, nights(tripDay(1)))],
      rooms: [makeRoom('dorm', 20, 0)],
      assignments: [],
      headcountOf: createHeadcountResolver([ann, ben]),
      partyOf: soloParties([ann, ben]),
    });

    expect(stays.map((stay) => stay.personId)).toEqual(['ann', 'ben']);
  });
});

describe('planRoomAllocation, a party with a room already', () => {
  it('still draws a later stay to the party’s first room once another member went elsewhere', () => {
    // Xavier already sleeps in the attic on the first night, so it is full for
    // Yann's two-person stay, which goes to the barn. Zoé needs the second
    // night only, when the attic is free again: as the party's room it wins
    // over the snug single, which would otherwise be the tighter fit.
    const xavier = makePerson('xavier');
    const yann = makePerson('yann', 2);
    const zoe = makePerson('zoe');
    const party = new Map<PersonId, string>([
      [xavier.id, 'party'],
      [yann.id, 'party'],
      [zoe.id, 'party'],
    ]);

    const stays = planRoomAllocation({
      guests: [guest(yann, nights(tripDay(1), tripDay(2))), guest(zoe, nights(tripDay(2)))],
      rooms: [makeRoom('attic', 2, 0), makeRoom('barn', 2, 1), makeRoom('single', 1, 2)],
      assignments: [makeAssignment('a1', 'xavier', 'attic', tripDay(1), tripDay(2))],
      headcountOf: createHeadcountResolver([xavier, yann, zoe]),
      partyOf: party,
    });

    expect(roomOf(stays, 'yann')).toBe('barn');
    expect(roomOf(stays, 'zoe')).toBe('attic');
  });
});
