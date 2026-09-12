/**
 * @fileoverview Fills the rooms for the host: one suggested stay per guest per
 * gap, capacity respected, parties kept together.
 *
 * Ten guests and five rooms is ten deliberate drags. This module answers the
 * whole board in one pass so the host reviews a proposal instead of building
 * one, and it proposes rather than writes: every stay it returns carries the
 * room it chose *and* the nights it chose them for, so the reader can change a
 * room before anything reaches the database.
 *
 * Three rules, in order of precedence:
 *
 * 1. **Capacity is never exceeded.** A room is a candidate only when every
 *    night of the stay still fits, counting people rather than rows.
 * 2. **A party stays together.** The whole party goes in one room when one is
 *    big enough for all of them on all their nights; failing that, each member
 *    prefers a room that already holds one of the others.
 * 3. **Rooms fill rather than scatter.** Between two rooms that fit, the one
 *    left with less slack wins, so a five-bed room is not opened for one guest
 *    while a double sits half empty.
 *
 * When nothing fits, the stay comes back with `roomId: null` rather than being
 * dropped. The host has to know who is still homeless, and the review dialog
 * lets them pick a room anyway — over capacity is a decision they are allowed
 * to make, and it is theirs, not the planner's.
 *
 * @module features/rooms/utils/allocation-planner
 */

import {
  buildNightlyOccupancyByRoom,
  listStayNights,
  type HeadcountResolver,
} from '@/features/rooms/utils/capacity-utils';
import { groupUnassignedNightsIntoStays } from '@/features/rooms/utils/unassigned-guests';
import type { PartyKeyByPerson } from '@/features/rooms/utils/guest-parties';
import type { Person, PersonId, Room, RoomAssignment, RoomId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * A guest and the nights they still have no bed for.
 *
 * Comes straight from `calculateUnassignedDates`, so the planner and the
 * timeline's "needs room" row are answering the same question.
 */
export interface GuestNeedingRoom {
  /** The guest. */
  readonly person: Person;
  /** Local day keys (`yyyy-MM-dd`) with no room, in any order. */
  readonly unassignedDates: readonly string[];
}

/**
 * One proposed stay: a guest, a room, and a check-in / check-out window.
 *
 * `endDate` is the check-out morning, exclusive, as everywhere else in the app —
 * so this can be handed to `createAssignment` unchanged.
 */
export interface SuggestedStay {
  /** The guest this stay is for. */
  readonly personId: PersonId;
  /** The chosen room, or `null` when no room fits these nights. */
  readonly roomId: RoomId | null;
  /** Check-in day. */
  readonly startDate: string;
  /** Check-out morning, exclusive. */
  readonly endDate: string;
  /** The nights covered, ascending. */
  readonly nights: readonly string[];
  /** Which party the guest belongs to; equal for guests kept together. */
  readonly partyKey: string;
}

/** What {@link planRoomAllocation} reads. */
export interface AllocationPlanInput {
  /** The guests with nights to fill. */
  readonly guests: readonly GuestNeedingRoom[];
  /** Every room in the trip. */
  readonly rooms: readonly Room[];
  /** Every existing assignment, which is what the free beds are counted from. */
  readonly assignments: readonly RoomAssignment[];
  /** Resolves a guest to the number of people they stand for. */
  readonly headcountOf: HeadcountResolver;
  /** Who travels with whom, from `inferGuestParties`. */
  readonly partyOf: PartyKeyByPerson;
}

/** A stay to place, before a room has been chosen for it. */
interface PendingStay {
  readonly personId: PersonId;
  readonly startDate: string;
  readonly endDate: string;
  readonly nights: readonly string[];
  readonly headcount: number;
  readonly partyKey: string;
}

/** Every stay one party needs, and how many nights that is in total. */
interface PartyPlan {
  readonly partyKey: string;
  readonly stays: readonly PendingStay[];
  readonly totalNights: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Turns a guest's loose uncovered nights into the stays a booking could cover.
 *
 * The run-splitting itself belongs to `groupUnassignedNightsIntoStays`, which
 * the timeline's bars already use: a guest housed for the middle of their stay
 * has two gaps, and one stay across both would book the nights they already
 * have a bed for.
 */
function buildPendingStays(
  guest: GuestNeedingRoom,
  headcountOf: HeadcountResolver,
  partyOf: PartyKeyByPerson,
): readonly PendingStay[] {
  const headcount = headcountOf(guest.person.id);
  const partyKey = partyOf.get(guest.person.id) ?? guest.person.id;

  return groupUnassignedNightsIntoStays(guest.unassignedDates).map((stay) => ({
    personId: guest.person.id,
    startDate: stay.startDate,
    endDate: stay.endDate,
    nights: listStayNights(stay.startDate, stay.endDate),
    headcount,
    partyKey,
  }));
}

/**
 * Adds a stay's people to a room's nightly occupancy, so the next choice sees
 * the bed this one just took.
 */
function occupy(
  occupancyByRoom: Map<RoomId, Map<string, number>>,
  roomId: RoomId,
  nights: readonly string[],
  headcount: number,
): void {
  let nightly = occupancyByRoom.get(roomId);
  if (!nightly) {
    nightly = new Map<string, number>();
    occupancyByRoom.set(roomId, nightly);
  }
  for (const night of nights) {
    nightly.set(night, (nightly.get(night) ?? 0) + headcount);
  }
}

/**
 * Picks the room that best fits a demand curve — how many people need a bed on
 * each night — or `undefined` when no room fits every night of it.
 *
 * `preferredRoomIds` carries rule 2: a room already holding a member of the
 * same party wins over an emptier one, which is the whole difference between
 * "everybody has a bed" and "the family is in three rooms".
 */
function chooseRoomForDemand(
  rooms: readonly Room[],
  occupancyByRoom: ReadonlyMap<RoomId, Map<string, number>>,
  demandByNight: ReadonlyMap<string, number>,
  preferredRoomIds: ReadonlySet<RoomId>,
): Room | undefined {
  const nights = [...demandByNight.keys()];
  if (nights.length === 0) {
    return undefined;
  }

  const candidates: Array<{
    readonly room: Room;
    readonly isPreferred: boolean;
    readonly isCompletelyEmpty: boolean;
    readonly slackScore: number;
  }> = [];

  for (const room of rooms) {
    const nightly = occupancyByRoom.get(room.id);
    let fits = true;
    let slackScore = 0;
    let isCompletelyEmpty = true;

    for (const night of nights) {
      const demand = demandByNight.get(night) ?? 0;
      const taken = nightly?.get(night) ?? 0;
      if (taken + demand > room.capacity) {
        fits = false;
        break;
      }
      if (taken > 0) {
        isCompletelyEmpty = false;
      }
      slackScore += room.capacity - (taken + demand);
    }

    if (fits) {
      candidates.push({
        room,
        isPreferred: preferredRoomIds.has(room.id),
        isCompletelyEmpty,
        slackScore,
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.isPreferred !== b.isPreferred) {
      return a.isPreferred ? -1 : 1;
    }
    if (a.isCompletelyEmpty !== b.isCompletelyEmpty) {
      return a.isCompletelyEmpty ? -1 : 1;
    }
    if (a.slackScore !== b.slackScore) {
      return a.slackScore - b.slackScore;
    }
    return a.room.order - b.room.order;
  });

  return candidates[0]?.room;
}

/**
 * Sums, per night, how many people a set of stays needs a bed for.
 */
function sumDemandByNight(stays: readonly PendingStay[]): Map<string, number> {
  const demand = new Map<string, number>();
  for (const stay of stays) {
    for (const night of stay.nights) {
      demand.set(night, (demand.get(night) ?? 0) + stay.headcount);
    }
  }
  return demand;
}

/**
 * Groups the stays to place by party, most constrained party first.
 *
 * Longest first is what stops a five-night stay finding every room half taken
 * by one-nighters it could have shared with.
 */
function groupStaysByParty(stays: readonly PendingStay[]): readonly PartyPlan[] {
  const byParty = new Map<string, PendingStay[]>();
  for (const stay of stays) {
    const partyStays = byParty.get(stay.partyKey);
    if (partyStays) {
      partyStays.push(stay);
    } else {
      byParty.set(stay.partyKey, [stay]);
    }
  }

  const plans: PartyPlan[] = [];
  for (const [partyKey, partyStays] of byParty) {
    const ordered = [...partyStays].sort((a, b) => {
      if (a.startDate !== b.startDate) {
        return a.startDate < b.startDate ? -1 : 1;
      }
      return a.personId < b.personId ? -1 : 1;
    });
    plans.push({
      partyKey,
      stays: ordered,
      totalNights: ordered.reduce((total, stay) => total + stay.nights.length, 0),
    });
  }

  plans.sort((a, b) => {
    if (a.totalNights !== b.totalNights) {
      return b.totalNights - a.totalNights;
    }
    if (a.stays.length !== b.stays.length) {
      return b.stays.length - a.stays.length;
    }
    return a.partyKey < b.partyKey ? -1 : 1;
  });

  return plans;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Proposes a room for every night no guest has a bed for.
 *
 * Writes nothing. The result is a proposal for a human to read, change and
 * apply.
 *
 * @param input - Guests with gaps, the rooms, the existing bookings, headcounts
 *   and the parties
 * @returns One stay per guest per gap, in party order; `roomId` is `null` for a
 *   stay no room could take
 *
 * @example
 * ```ts
 * const stays = planRoomAllocation({
 *   guests, rooms, assignments, headcountOf, partyOf,
 * });
 * const homeless = stays.filter((stay) => stay.roomId === null);
 * ```
 */
export function planRoomAllocation(
  input: AllocationPlanInput,
): readonly SuggestedStay[] {
  const { guests, rooms, assignments, headcountOf, partyOf } = input;

  const pending = guests.flatMap((guest) =>
    buildPendingStays(guest, headcountOf, partyOf),
  );
  if (pending.length === 0) {
    return [];
  }

  const occupancyByRoom = buildNightlyOccupancyByRoom(assignments, headcountOf);
  const suggested: SuggestedStay[] = [];

  // A party's members prefer a room one of them is already in — whether the
  // host put them there or this run just did.
  const roomsByParty = new Map<string, Set<RoomId>>();
  for (const assignment of assignments) {
    const partyKey = partyOf.get(assignment.personId);
    if (partyKey === undefined) {
      continue;
    }
    const roomIds = roomsByParty.get(partyKey);
    if (roomIds) {
      roomIds.add(assignment.roomId);
    } else {
      roomsByParty.set(partyKey, new Set([assignment.roomId]));
    }
  }

  const rememberPartyRoom = (partyKey: string, roomId: RoomId): void => {
    const roomIds = roomsByParty.get(partyKey);
    if (roomIds) {
      roomIds.add(roomId);
    } else {
      roomsByParty.set(partyKey, new Set([roomId]));
    }
  };

  const take = (stay: PendingStay, roomId: RoomId | null): void => {
    if (roomId === null) {
      return;
    }
    occupy(occupancyByRoom, roomId, stay.nights, stay.headcount);
    rememberPartyRoom(stay.partyKey, roomId);
  };

  const toSuggested = (
    stay: PendingStay,
    roomId: RoomId | null,
  ): SuggestedStay => ({
    personId: stay.personId,
    roomId,
    startDate: stay.startDate,
    endDate: stay.endDate,
    nights: stay.nights,
    partyKey: stay.partyKey,
  });

  for (const party of groupStaysByParty(pending)) {
    const preferred = roomsByParty.get(party.partyKey) ?? new Set<RoomId>();

    // One room for the whole party, when one can hold all of them.
    if (party.stays.length > 1) {
      const together = chooseRoomForDemand(
        rooms,
        occupancyByRoom,
        sumDemandByNight(party.stays),
        preferred,
      );
      if (together) {
        for (const stay of party.stays) {
          take(stay, together.id);
          suggested.push(toSuggested(stay, together.id));
        }
        continue;
      }
    }

    // Otherwise each stay on its own, longest first, still drawn towards
    // whichever room the party has already landed in. The *choosing* order is
    // longest first because that is what fits; the order the stays come back in
    // stays chronological, because that is what reads.
    const chosen = new Map<PendingStay, RoomId | null>();
    const byLongestFirst = [...party.stays].sort(
      (a, b) => b.nights.length - a.nights.length,
    );
    for (const stay of byLongestFirst) {
      const room = chooseRoomForDemand(
        rooms,
        occupancyByRoom,
        sumDemandByNight([stay]),
        roomsByParty.get(party.partyKey) ?? new Set<RoomId>(),
      );
      take(stay, room?.id ?? null);
      chosen.set(stay, room?.id ?? null);
    }

    for (const stay of party.stays) {
      suggested.push(toSuggested(stay, chosen.get(stay) ?? null));
    }
  }

  return suggested;
}
