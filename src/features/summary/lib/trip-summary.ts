/**
 * @fileoverview The one read behind the printable trip summary.
 *
 * The summary is the page that ends up taped to the kitchen wall, so it must
 * answer three questions on paper, with no account and no network: who sleeps
 * where, who arrives when, and who drives. Everything it prints comes from
 * IndexedDB in a single read keyed on the trip id **in the URL**, the same way
 * `loadTripStats` is — the trip contexts lag the URL during a trip switch, and
 * a sheet that prints the previous trip's rooms under this trip's name is worse
 * than no sheet at all.
 *
 * The read builds a display model rather than handing raw rows to the page:
 * names are resolved once here, so the sheet contains no lookups and can be
 * rendered from a fixture in a test.
 *
 * @module features/summary/lib/trip-summary
 */

import {
  deriveGuestStayDateBounds,
  type TripStayWindow,
} from '@/features/persons/utils/guest-presence';
import { calculateUnassignedDates } from '@/features/rooms/utils/unassigned-guests';
import { sortTransportsByInstant } from '@/features/transports/utils/pickup-utils';
import { db } from '@/lib/db/database';
import { getPersonHeadcount } from '@/types';
import type {
  ISODateString,
  ISODateTimeString,
  Person,
  PersonId,
  RoomAssignmentId,
  RoomIcon,
  RoomId,
  Transport,
  TransportId,
  TransportMode,
  TransportType,
  TripId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * One guest's nights in one room, in the check-in / check-out convention the
 * rest of the app books with: the stay covers the nights `startDate … endDate`
 * minus the last, and `endDate` is the morning they leave the room.
 */
export interface SummaryStay {
  /** The assignment this row was built from, used as the render key. */
  readonly assignmentId: RoomAssignmentId;
  /** The guest sleeping here. */
  readonly personId: PersonId;
  /** The guest's name, resolved once so the sheet does no lookups. */
  readonly personName: string;
  /** How many real people the guest row stands for. */
  readonly headcount: number;
  /** First night in the room. */
  readonly startDate: ISODateString;
  /** Check-out: the morning after the last night. */
  readonly endDate: ISODateString;
}

/**
 * A room and everybody booked into it.
 */
export interface SummaryRoom {
  /** The room, used as the render key. */
  readonly roomId: RoomId;
  /** Room name. */
  readonly name: string;
  /** Beds in the room. */
  readonly capacity: number;
  /** The room's icon, or `undefined` on a room saved before icons existed. */
  readonly icon: RoomIcon | undefined;
  /** Stays in this room, earliest first, then by guest name. */
  readonly stays: readonly SummaryStay[];
}

/**
 * One arrival or departure, with the driver already resolved.
 */
export interface SummaryTravel {
  /** The transport, used as the render key. */
  readonly transportId: TransportId;
  /** Arrival or departure. */
  readonly type: TransportType;
  /** The stored instant. */
  readonly datetime: ISODateTimeString;
  /** Who is travelling, or `null` when that guest is no longer in the trip. */
  readonly personName: string | null;
  /** Station, airport or address. */
  readonly location: string;
  /** Train, plane, car, bus or other, when it was filled in. */
  readonly mode: TransportMode | undefined;
  /** Train or flight number, when it was filled in. */
  readonly number: string | undefined;
  /** Whether somebody has to fetch or drop off this traveller. */
  readonly needsPickup: boolean;
  /**
   * Who drives, or `null` when nobody does.
   *
   * `null` covers both "no driver chosen" and "the chosen driver is no longer
   * a guest of this trip". The sheet prints the same "nobody yet" either way,
   * which is exactly the line the fridge page exists to make visible.
   */
  readonly driverName: string | null;
}

/**
 * One guest, with the contact details the group needs on paper.
 */
export interface SummaryGuest {
  /** The guest, used as the render key. */
  readonly personId: PersonId;
  /** Display name. */
  readonly name: string;
  /** How many real people this row stands for. */
  readonly headcount: number;
  /** Phone number exactly as it was typed, when there is one. */
  readonly phone: string | undefined;
  /** Allergies, diet, accessibility — whatever was written down. */
  readonly notes: string | undefined;
  /** Stated or derived arrival day, when anything states one. */
  readonly arrivalDate: ISODateString | null;
  /** Stated or derived departure day, when anything states one. */
  readonly departureDate: ISODateString | null;
}

/**
 * Everything the printable sheet renders, from one read.
 */
export interface TripSummary {
  /** The trip this sheet describes. */
  readonly tripId: TripId;
  /** Trip name. */
  readonly name: string;
  /** Where the trip happens, when it was filled in. */
  readonly location: string | undefined;
  /** First day of the trip. */
  readonly startDate: ISODateString;
  /** Last day of the trip. */
  readonly endDate: ISODateString;
  /** Real people expected, summing every guest row's headcount. */
  readonly headcount: number;
  /** Rooms in their configured order. */
  readonly rooms: readonly SummaryRoom[];
  /** Names of guests with at least one night nobody has given a bed. */
  readonly guestsWithoutRoom: readonly string[];
  /** Arrivals and departures together, earliest first. */
  readonly travels: readonly SummaryTravel[];
  /** Every guest, by name. */
  readonly guests: readonly SummaryGuest[];
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Upper bound for a string component of a compound index range.
 * Matches the bound the contexts use, so the ranges select the same rows.
 */
const MAX_STRING_KEY = '\uffff';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolves a guest name for an id that may no longer be in the trip.
 *
 * @param persons - The trip's guests, keyed by id
 * @param personId - The id to resolve
 * @returns The name, or `null` when no guest carries that id
 */
function resolveName(
  persons: ReadonlyMap<PersonId, Person>,
  personId: PersonId | undefined,
): string | null {
  if (personId === undefined) {
    return null;
  }
  return persons.get(personId)?.name ?? null;
}

// ============================================================================
// Reads
// ============================================================================

/**
 * Builds the printable summary of one trip.
 *
 * @param tripId - The trip to summarize, taken from the URL rather than from
 *   `currentTrip`, so the sheet always describes the trip it names.
 * @returns The summary, or `null` when no trip carries that id.
 *
 * @example
 * ```ts
 * const summary = await loadTripSummary(tripId);
 * summary?.rooms.flatMap((room) => room.stays); // who sleeps where
 * ```
 */
export async function loadTripSummary(
  tripId: TripId,
): Promise<TripSummary | null> {
  const trip = await db.trips.get(tripId);
  if (trip === undefined) {
    return null;
  }

  const [persons, rooms, assignments, transports] = await Promise.all([
    // The same compound ranges the contexts and `loadTripStats` use, so a name
    // on this sheet is a name the Guests, Rooms and Transport pages also list.
    db.persons
      .where('[tripId+name]')
      .between([tripId, ''], [tripId, MAX_STRING_KEY])
      .toArray(),
    db.rooms
      .where('[tripId+order]')
      .between([tripId, 0], [tripId, Infinity])
      .toArray(),
    db.roomAssignments
      .where('[tripId+startDate]')
      .between([tripId, ''], [tripId, MAX_STRING_KEY])
      .toArray(),
    db.transports
      .where('[tripId+datetime]')
      .between([tripId, ''], [tripId, MAX_STRING_KEY])
      .toArray(),
  ]);

  const personsById = new Map<PersonId, Person>(
    persons.map((person) => [person.id, person]),
  );

  // "Count people, not rows": a guest row can stand for a couple or a family.
  let headcount = 0;
  for (const person of persons) {
    headcount += getPersonHeadcount(person);
  }

  // ==========================================================================
  // Who sleeps where
  // ==========================================================================

  const staysByRoom = new Map<RoomId, SummaryStay[]>();
  for (const assignment of assignments) {
    const person = personsById.get(assignment.personId);
    if (person === undefined) {
      // An assignment whose guest is gone names nobody. Printing a nameless
      // bed would read as a free bed, which is the opposite of the truth.
      continue;
    }
    const stays = staysByRoom.get(assignment.roomId) ?? [];
    stays.push({
      assignmentId: assignment.id,
      personId: person.id,
      personName: person.name,
      headcount: getPersonHeadcount(person),
      startDate: assignment.startDate,
      endDate: assignment.endDate,
    });
    staysByRoom.set(assignment.roomId, stays);
  }

  const summaryRooms: SummaryRoom[] = rooms.map((room) => {
    const stays = staysByRoom.get(room.id) ?? [];
    // Day keys are `YYYY-MM-DD`, so a string compare is chronological.
    stays.sort(
      (left, right) =>
        left.startDate.localeCompare(right.startDate) ||
        left.personName.localeCompare(right.personName),
    );
    return {
      roomId: room.id,
      name: room.name,
      capacity: room.capacity,
      icon: room.icon,
      stays,
    };
  });

  // Who still has a night with no bed. Same helper as the rooms timeline's
  // "needs room" row, so the sheet cannot contradict the screen it was
  // printed from.
  const arrivals = transports.filter((transport) => transport.type === 'arrival');
  const departures = transports.filter((transport) => transport.type !== 'arrival');
  const tripWindow: TripStayWindow = {
    startDate: trip.startDate,
    endDate: trip.endDate,
  };
  const guestsWithoutRoom = persons
    .filter(
      (person) =>
        calculateUnassignedDates(
          person,
          arrivals,
          departures,
          assignments,
          tripWindow,
        ) !== null,
    )
    .map((person) => person.name);

  // ==========================================================================
  // Who arrives when, and who drives
  // ==========================================================================

  const travels: SummaryTravel[] = sortTransportsByInstant(transports).map(
    (transport: Transport) => ({
      transportId: transport.id,
      type: transport.type,
      datetime: transport.datetime,
      personName: resolveName(personsById, transport.personId),
      location: transport.location,
      mode: transport.transportMode,
      number: transport.transportNumber,
      needsPickup: transport.needsPickup,
      driverName: resolveName(personsById, transport.driverId),
    }),
  );

  // ==========================================================================
  // Who to call
  // ==========================================================================

  const guests: SummaryGuest[] = persons.map((person) => {
    const bounds = deriveGuestStayDateBounds(person, arrivals, departures);
    return {
      personId: person.id,
      name: person.name,
      headcount: getPersonHeadcount(person),
      phone: person.phone,
      notes: person.notes,
      arrivalDate: bounds.arrival,
      departureDate: bounds.departure,
    };
  });

  return {
    tripId: trip.id,
    name: trip.name,
    location: trip.location,
    startDate: trip.startDate,
    endDate: trip.endDate,
    headcount,
    rooms: summaryRooms,
    guestsWithoutRoom,
    travels,
    guests,
  };
}
