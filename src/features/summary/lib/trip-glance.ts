/**
 * @fileoverview The three answers the organiser re-checks all day.
 *
 * Every trip page has a laptop's right-hand third going spare, and the host
 * spends the day asking the same three questions of it: are the beds covered
 * for tonight, who lands next, and who still has nowhere to sleep. This module
 * derives all three from data the trip contexts already hold, so the panel
 * beside the page costs no extra database read.
 *
 * Pure on purpose, and separate from the component that renders it: the night
 * arithmetic — which night "tonight" is before the trip starts, and which
 * assignments cover it — is the part worth testing, and it reads the shared
 * nights model (`isDateInStayRange`) rather than a second copy of it, so the
 * panel can never disagree with the rooms page it sits next to.
 *
 * @module features/summary/lib/trip-glance
 */

import {
  createHeadcountResolver,
  isDateInStayRange,
} from '@/features/rooms/utils/capacity-utils';
import { calculateUnassignedDates } from '@/features/rooms/utils/unassigned-guests';
import {
  isTransportUpcoming,
  sortTransportsByInstant,
} from '@/features/transports/utils/pickup-utils';
import type {
  ISODateString,
  ISODateTimeString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomIcon,
  RoomId,
  Transport,
  TransportId,
  Trip,
} from '@/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Which night the bed figures describe.
 *
 * The distinction is the whole reason the panel is readable before a trip
 * starts: "4 of 9 beds taken" means something different on a night three weeks
 * away, so the label has to say which night it counted.
 */
export type GlanceNight =
  /** Today is one of the trip's nights. */
  | 'tonight'
  /** The trip has not started; the count is for its first night. */
  | 'firstNight'
  /** The trip's last night has passed; there is no night left to count. */
  | 'over';

/** One room's beds on the counted night. */
export interface GlanceRoom {
  readonly roomId: RoomId;
  readonly name: string;
  /** The room's number of beds. */
  readonly capacity: number;
  /** People sleeping in it on the counted night. */
  readonly occupancy: number;
  /** The room's icon, for the same glyph the rooms page shows. */
  readonly icon: RoomIcon | undefined;
}

/** One arrival still to come. */
export interface GlanceArrival {
  readonly transportId: TransportId;
  readonly personId: PersonId;
  /** The traveller's name, or `undefined` when the guest row is gone. */
  readonly personName: string | undefined;
  /** The guest's colour, so the row carries the same dot as everywhere else. */
  readonly personColor: string | undefined;
  readonly datetime: ISODateTimeString;
  readonly location: string;
}

/** One guest with nights still uncovered. */
export interface GlanceGuestWithoutRoom {
  readonly personId: PersonId;
  readonly name: string;
  readonly color: string | undefined;
  /** How many of their nights have no bed. */
  readonly nightsWithoutRoom: number;
}

/** Everything the glance panel renders. */
export interface TripGlance {
  /** The night the bed figures are for, or `null` once the trip is over. */
  readonly nightKey: ISODateString | null;
  /** Which night that is, in words the label can use. */
  readonly night: GlanceNight;
  /** People sleeping in a room on that night. */
  readonly bedsTaken: number;
  /** Beds the trip has at all, across every room. */
  readonly bedsTotal: number;
  /** Every room, in the order the rooms page shows them. */
  readonly rooms: readonly GlanceRoom[];
  /** Arrivals at or after `nowMs`, earliest first. */
  readonly nextArrivals: readonly GlanceArrival[];
  /** Guests with at least one uncovered night, most nights first. */
  readonly guestsWithoutRoom: readonly GlanceGuestWithoutRoom[];
}

/** What {@link buildTripGlance} reads. All of it is already in a context. */
export interface TripGlanceInput {
  /** The trip whose dates bound the night, or `null` while none is selected. */
  readonly trip: Pick<Trip, 'startDate' | 'endDate'> | null;
  readonly persons: readonly Person[];
  readonly rooms: readonly Room[];
  readonly assignments: readonly RoomAssignment[];
  readonly arrivals: readonly Transport[];
  readonly departures: readonly Transport[];
  /** Today, as a local day key — from `toLocalISODateString(today)`. */
  readonly todayKey: ISODateString;
  /**
   * The reference instant past/upcoming is decided against.
   *
   * `TransportContext.nowMs`, not a fresh `Date.now()`: the transports page and
   * this panel must drop the same arrival from "next" on the same tick.
   */
  readonly nowMs: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * The night worth counting beds for, given today.
 *
 * A trip's nights run from `startDate` to the night before `endDate` — the
 * check-in / check-out model the whole app books with — so a day key equal to
 * `endDate` is the morning everybody leaves, and there is no night to count.
 */
function resolveNight(
  trip: Pick<Trip, 'startDate' | 'endDate'>,
  todayKey: ISODateString,
): { readonly nightKey: ISODateString | null; readonly night: GlanceNight } {
  if (todayKey < trip.startDate) {
    return { nightKey: trip.startDate, night: 'firstNight' };
  }
  if (todayKey >= trip.endDate) {
    return { nightKey: null, night: 'over' };
  }
  return { nightKey: todayKey, night: 'tonight' };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Derives the glance panel's three answers.
 *
 * @param input - The trip and the context rows behind it
 * @returns The panel's display model; empty figures when no trip is selected
 */
export function buildTripGlance(input: TripGlanceInput): TripGlance {
  const { trip, persons, rooms, assignments, arrivals, departures, todayKey, nowMs } =
    input;

  const headcountOf = createHeadcountResolver(persons);
  const personsById = new Map(persons.map((person) => [person.id, person]));

  const { nightKey, night } = trip
    ? resolveNight(trip, todayKey)
    : { nightKey: null, night: 'over' as GlanceNight };

  /*
    Counted per room as well as in one total, because the panel shows both: the
    headline figure is the sum, and the rows underneath are what tell the host
    *which* room is the tight one. An assignment whose room has been deleted
    still occupies a bed in the headline — it is a person sleeping somewhere —
    so the sum is taken over assignments, not over the rows.
  */
  const occupancyByRoom = new Map<RoomId, number>();
  let bedsTaken = 0;

  if (nightKey !== null) {
    for (const assignment of assignments) {
      if (!isDateInStayRange(assignment.startDate, assignment.endDate, nightKey)) {
        continue;
      }
      const heads = headcountOf(assignment.personId);
      bedsTaken += heads;
      occupancyByRoom.set(
        assignment.roomId,
        (occupancyByRoom.get(assignment.roomId) ?? 0) + heads,
      );
    }
  }

  const glanceRooms: readonly GlanceRoom[] = rooms.map((room) => ({
    roomId: room.id,
    name: room.name,
    capacity: room.capacity,
    occupancy: occupancyByRoom.get(room.id) ?? 0,
    icon: room.icon,
  }));

  const bedsTotal = rooms.reduce((total, room) => total + room.capacity, 0);

  const nextArrivals: readonly GlanceArrival[] = sortTransportsByInstant(
    arrivals.filter((arrival) => isTransportUpcoming(arrival.datetime, nowMs)),
  ).map((arrival) => {
    const person = personsById.get(arrival.personId);
    return {
      transportId: arrival.id,
      personId: arrival.personId,
      personName: person?.name,
      personColor: person?.color,
      datetime: arrival.datetime,
      location: arrival.location,
    };
  });

  const guestsWithoutRoom: GlanceGuestWithoutRoom[] = [];

  if (trip) {
    const tripWindow = { startDate: trip.startDate, endDate: trip.endDate };
    for (const person of persons) {
      const unassigned = calculateUnassignedDates(
        person,
        arrivals,
        departures,
        assignments,
        tripWindow,
      );
      if (unassigned === null) {
        continue;
      }
      guestsWithoutRoom.push({
        personId: person.id,
        name: person.name,
        color: person.color,
        nightsWithoutRoom: unassigned.unassignedDates.length,
      });
    }
    // Most nights first: the guest with nowhere to sleep at all outranks the
    // one missing a single night. Ties by name, so the list is stable between
    // renders rather than following the guest list's own order by accident.
    guestsWithoutRoom.sort(
      (a, b) =>
        b.nightsWithoutRoom - a.nightsWithoutRoom ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
  }

  return {
    nightKey,
    night,
    bedsTaken,
    bedsTotal,
    rooms: glanceRooms,
    nextArrivals,
    guestsWithoutRoom,
  };
}
