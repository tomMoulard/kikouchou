/**
 * @fileoverview Which guests travel as one party, read from what the trip
 * already records.
 *
 * A *party* here is a set of guests who should end up in the same room when one
 * is big enough: a family, a couple booked as two rows, three friends who came
 * on the same train.
 *
 * Nothing on a guest states this. `Person` carries no group id — importing a
 * guest group copies its members and keeps no link back — so this module reads
 * the two facts the trip does hold:
 *
 * 1. **They already share a room** on at least one night. The host put them
 *    there, so the remaining nights belong beside each other too.
 * 2. **They arrive together** — the same time and the same place. Two people off
 *    one train are a party even on a trip where nothing else says so.
 *
 * A couple tracked under one name needs none of this: it is a single guest row
 * with `headcount: 2`, so it occupies one room by construction. This module is
 * for the people the roster splits into separate rows.
 *
 * Departures are deliberately not a signal. Guests leaving on one taxi to the
 * airport is a lift shared at the end of a stay, not evidence about who wanted
 * to sleep together, and treating it as one merged parties that had spent the
 * week in different rooms on purpose.
 *
 * @module features/rooms/utils/guest-parties
 */

import { stayNightsOverlap } from '@/features/rooms/utils/capacity-utils';
import type { Person, PersonId, RoomAssignment, Transport } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The party each guest belongs to, keyed by guest.
 *
 * The value is an opaque key, equal for two guests in the same party and
 * different otherwise. A guest who travels alone gets a party of one, so every
 * caller can treat the answer uniformly rather than special-casing the absence
 * of a key.
 */
export type PartyKeyByPerson = ReadonlyMap<PersonId, string>;

/** What {@link inferGuestParties} reads. */
export interface GuestPartyInput {
  /** The trip's guests. Only these take part in a party. */
  readonly persons: readonly Person[];
  /** Every room assignment in the trip. */
  readonly assignments: readonly RoomAssignment[];
  /** Every arrival transport in the trip. */
  readonly arrivals: readonly Transport[];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Collapses a place name to something two records can be compared on.
 *
 * "Gare de Lyon" and "gare de  lyon " are the same platform typed twice.
 */
function normalizeLocation(location: string | undefined): string {
  return (location ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Union-find over guest ids, so the two signals can merge parties in any order.
 */
function createUnionFind(): {
  readonly find: (id: PersonId) => PersonId;
  readonly union: (a: PersonId, b: PersonId) => void;
} {
  const parent = new Map<PersonId, PersonId>();

  const find = (id: PersonId): PersonId => {
    const seen = parent.get(id);
    if (seen === undefined || seen === id) {
      parent.set(id, id);
      return id;
    }
    const root = find(seen);
    parent.set(id, root);
    return root;
  };

  const union = (a: PersonId, b: PersonId): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) {
      return;
    }
    // Smaller id wins, so the key a party gets does not depend on the order the
    // signals arrived in. Two runs over the same trip must agree.
    if (rootA < rootB) {
      parent.set(rootB, rootA);
    } else {
      parent.set(rootA, rootB);
    }
  };

  return { find, union };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Works out who travels with whom.
 *
 * @param input - The trip's guests, room assignments and arrivals
 * @returns The party key of every guest in `persons`
 *
 * @example
 * ```ts
 * const parties = inferGuestParties({ persons, assignments, arrivals });
 * parties.get(alice.id) === parties.get(bob.id); // true if they came together
 * ```
 */
export function inferGuestParties(input: GuestPartyInput): PartyKeyByPerson {
  const { persons, assignments, arrivals } = input;
  const known = new Set(persons.map((person) => person.id));
  const { find, union } = createUnionFind();

  // Signal 1: already roommates on some night.
  const byRoom = new Map<RoomAssignment['roomId'], RoomAssignment[]>();
  for (const assignment of assignments) {
    if (!known.has(assignment.personId)) {
      continue;
    }
    const roomAssignments = byRoom.get(assignment.roomId);
    if (roomAssignments) {
      roomAssignments.push(assignment);
    } else {
      byRoom.set(assignment.roomId, [assignment]);
    }
  }

  for (const roomAssignments of byRoom.values()) {
    for (let i = 0; i < roomAssignments.length; i += 1) {
      const a = roomAssignments[i]!;
      for (let j = i + 1; j < roomAssignments.length; j += 1) {
        const b = roomAssignments[j]!;
        if (a.personId !== b.personId && stayNightsOverlap(a, b)) {
          union(a.personId, b.personId);
        }
      }
    }
  }

  // Signal 2: one arrival, several guests.
  const byArrival = new Map<string, PersonId[]>();
  for (const arrival of arrivals) {
    if (!known.has(arrival.personId) || !arrival.datetime) {
      continue;
    }
    const place = normalizeLocation(arrival.location);
    if (!place) {
      continue;
    }
    const key = `${arrival.datetime}|${place}`;
    const travellers = byArrival.get(key);
    if (travellers) {
      travellers.push(arrival.personId);
    } else {
      byArrival.set(key, [arrival.personId]);
    }
  }

  for (const travellers of byArrival.values()) {
    const first = travellers[0]!;
    for (const traveller of travellers.slice(1)) {
      union(first, traveller);
    }
  }

  const partyOf = new Map<PersonId, string>();
  for (const person of persons) {
    partyOf.set(person.id, find(person.id));
  }
  return partyOf;
}
