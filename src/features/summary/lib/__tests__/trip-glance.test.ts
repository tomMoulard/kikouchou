/**
 * @fileoverview Tests for the organiser column's three answers.
 *
 * The night arithmetic is the part that can be wrong without anybody noticing:
 * a bed counted on the check-out morning, or "tonight" counted for a trip that
 * has not started, both render as a plausible number.
 *
 * @module features/summary/lib/__tests__/trip-glance.test
 */

import { describe, expect, it } from 'vitest';

import { buildTripGlance } from '@/features/summary/lib/trip-glance';
import type {
  ISODateString,
  Person,
  Room,
  RoomAssignment,
  Transport,
  Trip,
  TripId,
} from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-a' as TripId;

/** Midday on the trip's second day, as the reference instant. */
const NOW_MS = Date.parse('2026-07-02T12:00:00.000Z');

const TRIP: Trip = {
  id: TRIP_ID,
  name: 'Summer house',
  startDate: '2026-07-01',
  endDate: '2026-07-08',
} as unknown as Trip;

function person(
  id: string,
  overrides: Record<string, unknown> = {},
): Person {
  return {
    id,
    tripId: TRIP_ID,
    name: id,
    color: '#3b82f6',
    ...overrides,
  } as unknown as Person;
}

function room(
  id: string,
  capacity: number,
  overrides: Record<string, unknown> = {},
): Room {
  return {
    id,
    tripId: TRIP_ID,
    name: `Room ${id}`,
    capacity,
    order: 0,
    ...overrides,
  } as unknown as Room;
}

function assignment(
  id: string,
  roomId: string,
  personId: string,
  startDate: string,
  endDate: string,
): RoomAssignment {
  return {
    id,
    tripId: TRIP_ID,
    roomId,
    personId,
    startDate,
    endDate,
  } as unknown as RoomAssignment;
}

function arrival(
  id: string,
  personId: string,
  datetime: string,
  location = 'Gare de Lyon',
): Transport {
  return {
    id,
    tripId: TRIP_ID,
    personId,
    type: 'arrival',
    datetime,
    location,
  } as unknown as Transport;
}

/**
 * A glance built from the given rows, with everything else empty.
 *
 * Stay dates are given per guest by the tests that care; the ones that do not
 * inherit the trip window, which is what the app does.
 */
function build(
  overrides: {
    readonly trip?: Trip | null;
    readonly persons?: readonly Person[];
    readonly rooms?: readonly Room[];
    readonly assignments?: readonly RoomAssignment[];
    readonly arrivals?: readonly Transport[];
    readonly departures?: readonly Transport[];
    readonly todayKey?: ISODateString;
    readonly nowMs?: number;
  } = {},
) {
  return buildTripGlance({
    trip: overrides.trip === undefined ? TRIP : overrides.trip,
    persons: overrides.persons ?? [],
    rooms: overrides.rooms ?? [],
    assignments: overrides.assignments ?? [],
    arrivals: overrides.arrivals ?? [],
    departures: overrides.departures ?? [],
    todayKey: overrides.todayKey ?? ('2026-07-02' as ISODateString),
    nowMs: overrides.nowMs ?? NOW_MS,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('buildTripGlance', () => {
  describe('which night the beds are counted for', () => {
    it("counts tonight when today is one of the trip's nights", () => {
      const glance = build();

      expect(glance.night).toBe('tonight');
      expect(glance.nightKey).toBe('2026-07-02');
    });

    it('counts the first night when the trip has not started', () => {
      const glance = build({ todayKey: '2026-06-20' as ISODateString });

      expect(glance.night).toBe('firstNight');
      expect(glance.nightKey).toBe('2026-07-01');
    });

    it('counts no night on the check-out morning', () => {
      const glance = build({
        todayKey: '2026-07-08' as ISODateString,
        rooms: [room('r1', 4)],
        persons: [person('p1')],
        assignments: [assignment('a1', 'r1', 'p1', '2026-07-01', '2026-07-08')],
      });

      expect(glance.night).toBe('over');
      expect(glance.nightKey).toBeNull();
      expect(glance.bedsTaken).toBe(0);
    });

    it('reports no night at all without a trip', () => {
      const glance = build({ trip: null });

      expect(glance.night).toBe('over');
      expect(glance.guestsWithoutRoom).toEqual([]);
    });
  });

  describe('beds', () => {
    it('counts the people sleeping in each room on that night', () => {
      const glance = build({
        rooms: [room('r1', 3), room('r2', 2)],
        persons: [person('p1'), person('p2'), person('p3')],
        assignments: [
          assignment('a1', 'r1', 'p1', '2026-07-01', '2026-07-05'),
          assignment('a2', 'r1', 'p2', '2026-07-02', '2026-07-03'),
          // Ends the morning of the counted night, so it holds no bed tonight.
          assignment('a3', 'r2', 'p3', '2026-07-01', '2026-07-02'),
        ],
      });

      expect(glance.bedsTaken).toBe(2);
      expect(glance.bedsTotal).toBe(5);
      expect(glance.rooms).toEqual([
        expect.objectContaining({ roomId: 'r1', occupancy: 2, capacity: 3 }),
        expect.objectContaining({ roomId: 'r2', occupancy: 0, capacity: 2 }),
      ]);
    });

    it('counts a guest row as its whole headcount', () => {
      const glance = build({
        rooms: [room('r1', 4)],
        persons: [person('family', { headcount: 3 })],
        assignments: [assignment('a1', 'r1', 'family', '2026-07-01', '2026-07-05')],
      });

      expect(glance.bedsTaken).toBe(3);
      expect(glance.rooms[0]?.occupancy).toBe(3);
    });
  });

  describe('next arrivals', () => {
    it('keeps the arrivals still to come, earliest first', () => {
      const glance = build({
        persons: [person('p1', { color: '#ff0000' }), person('p2')],
        arrivals: [
          arrival('t-late', 'p1', '2026-07-04T18:00:00.000Z'),
          arrival('t-past', 'p2', '2026-07-01T09:00:00.000Z'),
          arrival('t-soon', 'p2', '2026-07-02T20:00:00.000Z'),
        ],
      });

      expect(glance.nextArrivals.map((item) => item.transportId)).toEqual([
        't-soon',
        't-late',
      ]);
      expect(glance.nextArrivals[1]).toEqual(
        expect.objectContaining({ personName: 'p1', personColor: '#ff0000' }),
      );
    });

    it('leaves the name undefined when the guest row is gone', () => {
      const glance = build({
        arrivals: [arrival('t1', 'ghost', '2026-07-03T10:00:00.000Z')],
      });

      expect(glance.nextArrivals[0]?.personName).toBeUndefined();
    });
  });

  describe('guests still without a room', () => {
    it('lists the guests with uncovered nights, most nights first', () => {
      const glance = build({
        rooms: [room('r1', 4)],
        persons: [
          person('housed'),
          // Stay dates of their own, so the missing last night is a real gap:
          // a guest with nothing but a booking is taken to want exactly the
          // nights they were booked for.
          person('one-night', {
            stayStartDate: '2026-07-01',
            stayEndDate: '2026-07-08',
          }),
          person('homeless'),
        ],
        assignments: [
          assignment('a1', 'r1', 'housed', '2026-07-01', '2026-07-08'),
          assignment('a2', 'r1', 'one-night', '2026-07-01', '2026-07-07'),
        ],
      });

      expect(glance.guestsWithoutRoom).toEqual([
        expect.objectContaining({ personId: 'homeless', nightsWithoutRoom: 7 }),
        expect.objectContaining({ personId: 'one-night', nightsWithoutRoom: 1 }),
      ]);
    });

    it('says nothing when every guest has a bed for their whole stay', () => {
      const glance = build({
        rooms: [room('r1', 2)],
        persons: [person('p1')],
        assignments: [assignment('a1', 'r1', 'p1', '2026-07-01', '2026-07-08')],
      });

      expect(glance.guestsWithoutRoom).toEqual([]);
    });
  });
});
