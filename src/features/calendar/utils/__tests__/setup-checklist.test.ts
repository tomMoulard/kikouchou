/**
 * @fileoverview Tests for the empty calendar's trip-setup checklist.
 *
 * @module features/calendar/utils/__tests__/setup-checklist.test
 */

import { describe, it, expect } from 'vitest';

import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

import {
  buildTripSetupChecklist,
  TRIP_SETUP_STEP_KEYS,
  type TripSetupChecklist,
  type TripSetupStepKey,
} from '../setup-checklist';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

function makePerson(args: {
  readonly id: string;
  readonly headcount?: number;
}): Person {
  return {
    id: args.id as PersonId,
    tripId: TRIP_ID,
    name: args.id,
    color: '#3b82f6' as HexColor,
    headcount: args.headcount,
  };
}

function makeRoom(id: string): Room {
  return {
    id: id as RoomId,
    tripId: TRIP_ID,
    name: id,
    capacity: 2,
    order: 0,
  };
}

function makeAssignment(args: { readonly id: string; readonly personId: string }): RoomAssignment {
  return {
    id: args.id as RoomAssignmentId,
    tripId: TRIP_ID,
    roomId: 'room-1' as RoomId,
    personId: args.personId as PersonId,
    startDate: '2026-07-01' as ISODateString,
    endDate: '2026-07-05' as ISODateString,
  };
}

function makeArrival(id: string, personId: string): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP_ID,
    personId: personId as PersonId,
    type: 'arrival',
    datetime: '2026-07-01T10:00:00.000Z',
    location: 'Gare de Lyon',
    needsPickup: false,
  };
}

/** Reads one step out of a checklist by key, so a test never indexes by number. */
function step(checklist: TripSetupChecklist, key: TripSetupStepKey) {
  const found = checklist.steps.find((candidate) => candidate.key === key);
  expect(found, `no ${key} step`).toBeDefined();
  return found!;
}

// ============================================================================
// Tests
// ============================================================================

describe('buildTripSetupChecklist', () => {
  it('returns every step, in order, for a trip with nothing in it', () => {
    const checklist = buildTripSetupChecklist({
      persons: [],
      rooms: [],
      assignments: [],
      arrivals: [],
    });

    expect(checklist.steps.map((s) => s.key)).toEqual([...TRIP_SETUP_STEP_KEYS]);
    expect(checklist.steps.every((s) => !s.isDone)).toBe(true);
    expect(checklist.doneCount).toBe(0);
    expect(checklist.stepCount).toBe(TRIP_SETUP_STEP_KEYS.length);
    expect(checklist.isComplete).toBe(false);
  });

  it('ticks the guest step off as soon as the trip has a guest', () => {
    const checklist = buildTripSetupChecklist({
      persons: [makePerson({ id: 'p1' })],
      rooms: [],
      assignments: [],
      arrivals: [],
    });

    expect(step(checklist, 'guests')).toMatchObject({ count: 1, isDone: true });
    expect(checklist.doneCount).toBe(1);
  });

  it('counts people rather than guest rows', () => {
    // One row standing for a family of four, which is what `headcount` is for.
    const checklist = buildTripSetupChecklist({
      persons: [makePerson({ id: 'p1', headcount: 4 }), makePerson({ id: 'p2' })],
      rooms: [],
      assignments: [],
      arrivals: [],
    });

    expect(step(checklist, 'guests').count).toBe(5);
    expect(step(checklist, 'assignments').total).toBe(5);
  });

  it('counts a placed guest for its whole headcount', () => {
    const checklist = buildTripSetupChecklist({
      persons: [makePerson({ id: 'p1', headcount: 3 }), makePerson({ id: 'p2' })],
      rooms: [makeRoom('room-1')],
      assignments: [makeAssignment({ id: 'a1', personId: 'p1' })],
      arrivals: [],
    });

    expect(step(checklist, 'assignments')).toMatchObject({
      count: 3,
      total: 4,
      isDone: false,
    });
  });

  it('counts a guest once however many stays they have', () => {
    const checklist = buildTripSetupChecklist({
      persons: [makePerson({ id: 'p1' })],
      rooms: [makeRoom('room-1')],
      assignments: [
        makeAssignment({ id: 'a1', personId: 'p1' }),
        makeAssignment({ id: 'a2', personId: 'p1' }),
      ],
      arrivals: [],
    });

    expect(step(checklist, 'assignments')).toMatchObject({
      count: 1,
      total: 1,
      isDone: true,
    });
  });

  it('ignores an assignment whose guest is gone', () => {
    const checklist = buildTripSetupChecklist({
      persons: [makePerson({ id: 'p1' })],
      rooms: [makeRoom('room-1')],
      assignments: [makeAssignment({ id: 'a1', personId: 'deleted' })],
      arrivals: [],
    });

    expect(step(checklist, 'assignments')).toMatchObject({ count: 0, isDone: false });
  });

  it('leaves the assignment step undone while any guest has nowhere to sleep', () => {
    const checklist = buildTripSetupChecklist({
      persons: [makePerson({ id: 'p1' }), makePerson({ id: 'p2' })],
      rooms: [makeRoom('room-1')],
      assignments: [makeAssignment({ id: 'a1', personId: 'p1' })],
      arrivals: [makeArrival('t1', 'p1')],
    });

    expect(step(checklist, 'assignments').isDone).toBe(false);
    expect(checklist.isComplete).toBe(false);
  });

  it('does not call the assignment step done on a trip with no guests', () => {
    const checklist = buildTripSetupChecklist({
      persons: [],
      rooms: [makeRoom('room-1')],
      assignments: [],
      arrivals: [],
    });

    // 0 of 0 is not "everybody has a room", it is "there is nobody yet".
    expect(step(checklist, 'assignments')).toMatchObject({
      count: 0,
      total: 0,
      isDone: false,
    });
  });

  it('ticks the arrivals step off at the first arrival, not one per guest', () => {
    const checklist = buildTripSetupChecklist({
      persons: [makePerson({ id: 'p1' }), makePerson({ id: 'p2' })],
      rooms: [],
      assignments: [],
      arrivals: [makeArrival('t1', 'p1')],
    });

    expect(step(checklist, 'arrivals')).toMatchObject({ count: 1, isDone: true });
  });

  it('is complete once every guest has a room and travel is booked', () => {
    const checklist = buildTripSetupChecklist({
      persons: [makePerson({ id: 'p1', headcount: 2 })],
      rooms: [makeRoom('room-1')],
      assignments: [makeAssignment({ id: 'a1', personId: 'p1' })],
      arrivals: [makeArrival('t1', 'p1')],
    });

    expect(checklist.doneCount).toBe(checklist.stepCount);
    expect(checklist.isComplete).toBe(true);
  });
});
