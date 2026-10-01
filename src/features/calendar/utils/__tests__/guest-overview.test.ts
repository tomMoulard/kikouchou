/**
 * Unit tests for the guest overview gathered behind a calendar pill.
 *
 * @module features/calendar/utils/__tests__/guest-overview.test
 */
import { describe, it, expect } from 'vitest';

import { isoDate } from '@/test/utils';
import type {
  Activity,
  ActivityId,
  CurrencyCode,
  HexColor,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  ShareId,
  Transport,
  TransportId,
  Trip,
  TripId,
} from '@/types';

import { buildGuestOverview } from '../guest-overview';

// ============================================================================
// Helpers
// ============================================================================

const TRIP: Trip = {
  id: 'trip-1' as TripId,
  name: 'Summer',
  startDate: isoDate('2024-07-15'),
  endDate: isoDate('2024-07-20'),
  shareId: 'share-1' as ShareId,
  createdAt: 0,
  updatedAt: 0,
};

function makePerson(id: string): Person {
  return {
    id: id as PersonId,
    tripId: TRIP.id,
    name: id,
    color: '#ef4444' as HexColor,
    order: 0,
  } as Person;
}

function makeRoom(id: string): Room {
  return { id: id as RoomId, tripId: TRIP.id, name: `Room ${id}`, capacity: 2 } as Room;
}

function makeAssignment(
  id: string,
  roomId: string,
  personId: string,
  startDate: string,
  endDate: string,
): RoomAssignment {
  return {
    id: id as RoomAssignmentId,
    tripId: TRIP.id,
    roomId: roomId as RoomId,
    personId: personId as PersonId,
    startDate: isoDate(startDate),
    endDate: isoDate(endDate),
  } as RoomAssignment;
}

function makeTransport(
  id: string,
  personId: string,
  type: 'arrival' | 'departure',
  datetime: string,
): Transport {
  return {
    id: id as TransportId,
    tripId: TRIP.id,
    personId: personId as PersonId,
    type,
    datetime,
    location: `${id} station`,
  } as Transport;
}

function makeActivity(id: string, day: number, participantIds: string[]): Activity {
  return {
    id: id as ActivityId,
    tripId: TRIP.id,
    title: id,
    category: 'horticulture',
    startDatetime: new Date(2024, 6, day, 10, 0).toISOString(),
    allDay: false,
    participantIds: participantIds as PersonId[],
  } as Activity;
}

const ALICE = makePerson('alice');
const BOB = makePerson('bob');

function build(overrides: Partial<Parameters<typeof buildGuestOverview>[0]> = {}) {
  return buildGuestOverview({
    person: ALICE,
    trip: TRIP,
    rooms: [makeRoom('r1'), makeRoom('r2')],
    assignments: [],
    arrivals: [],
    departures: [],
    activities: [],
    ...overrides,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('buildGuestOverview', () => {
  it('keeps only this guest’s rooms, earliest stay first', () => {
    const overview = build({
      assignments: [
        makeAssignment('a2', 'r2', 'alice', '2024-07-18', '2024-07-20'),
        makeAssignment('a1', 'r1', 'alice', '2024-07-15', '2024-07-18'),
        makeAssignment('a3', 'r1', 'bob', '2024-07-15', '2024-07-18'),
      ],
    });

    expect(overview.stays.map((stay) => stay.assignment.id)).toEqual(['a1', 'a2']);
    expect(overview.stays.map((stay) => stay.room?.name)).toEqual(['Room r1', 'Room r2']);
  });

  it('leaves a room undefined when it has been deleted', () => {
    const overview = build({
      rooms: [],
      assignments: [makeAssignment('a1', 'r1', 'alice', '2024-07-15', '2024-07-18')],
    });

    expect(overview.stays[0]?.room).toBeUndefined();
  });

  it('merges this guest’s arrivals and departures into one list, earliest first', () => {
    const overview = build({
      arrivals: [
        makeTransport('t-late', 'alice', 'arrival', new Date(2024, 6, 16, 9, 0).toISOString()),
        makeTransport('t-bob', 'bob', 'arrival', new Date(2024, 6, 15, 9, 0).toISOString()),
      ],
      departures: [
        makeTransport('t-out', 'alice', 'departure', new Date(2024, 6, 15, 8, 0).toISOString()),
      ],
    });

    expect(overview.transports.map((transport) => transport.id)).toEqual(['t-out', 't-late']);
  });

  it('keeps only the activities this guest signed up for', () => {
    const overview = build({
      activities: [
        makeActivity('hike', 17, ['bob']),
        makeActivity('swim', 16, ['alice', 'bob']),
        makeActivity('walk', 15, ['alice']),
      ],
    });

    expect(overview.activities.map((activity) => activity.id)).toEqual(['walk', 'swim']);
  });

  it('falls back to the trip dates when the guest has no stay dates or travel', () => {
    const overview = build();

    expect(overview.checkIn).toBe(TRIP.startDate);
    expect(overview.checkOut).toBe(TRIP.endDate);
  });

  it('takes the check-in and check-out from the guest’s own travel', () => {
    const overview = build({
      arrivals: [
        makeTransport('in', 'alice', 'arrival', new Date(2024, 6, 16, 9, 0).toISOString()),
      ],
      departures: [
        makeTransport('out', 'alice', 'departure', new Date(2024, 6, 19, 8, 0).toISOString()),
      ],
    });

    expect(overview.checkIn).toBe(isoDate('2024-07-16'));
    expect(overview.checkOut).toBe(isoDate('2024-07-19'));
  });

  it('carries the balance and currency straight through', () => {
    const balance = { personId: BOB.id, paid: 40, owed: 10, balance: 30 };
    const overview = build({ balance, currency: 'GBP' as CurrencyCode });

    expect(overview.balance).toBe(balance);
    expect(overview.currency).toBe('GBP');
  });

  it('leaves the balance undefined when the accounts have not loaded', () => {
    expect(build().balance).toBeUndefined();
  });
});
