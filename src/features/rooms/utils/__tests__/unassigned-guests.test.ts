/**
 * Tests for calculateUnassignedDates.
 *
 * @module features/rooms/utils/__tests__/unassigned-guests.test
 */
import { describe, it, expect } from 'vitest';

import { calculateUnassignedDates } from '../unassigned-guests';
import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  TripId,
} from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 'p1' as PersonId,
    tripId: 'trip-1' as TripId,
    name: 'Tom',
    color: '#6366f1' as HexColor,
    ...overrides,
  };
}

function makeAssignment(startDate: string, endDate: string): RoomAssignment {
  return {
    id: 'a1' as RoomAssignmentId,
    tripId: 'trip-1' as TripId,
    personId: 'p1' as PersonId,
    roomId: 'r1' as RoomId,
    startDate: startDate as ISODateString,
    endDate: endDate as ISODateString,
  };
}

const tripWindow = (startDate: string, endDate: string) => ({
  startDate: startDate as ISODateString,
  endDate: endDate as ISODateString,
});

// ============================================================================
// Tests
// ============================================================================

describe('calculateUnassignedDates', () => {
  it('reports every night when an undated guest has no room at all', () => {
    // The trip fallback exists for exactly this: a guest who filled in nothing
    // still needs a bed, and has to surface somewhere to be given one.
    const result = calculateUnassignedDates(
      makePerson(),
      [],
      [],
      [],
      tripWindow('2026-09-01', '2026-09-04'),
    );

    expect(result?.unassignedDates).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  it('reports nothing when the guest is housed for their whole stated stay', () => {
    const result = calculateUnassignedDates(
      makePerson({
        stayStartDate: '2026-09-01' as ISODateString,
        stayEndDate: '2026-09-04' as ISODateString,
      }),
      [],
      [],
      [makeAssignment('2026-09-01', '2026-09-04')],
      tripWindow('2026-09-01', '2026-09-10'),
    );

    expect(result).toBeNull();
  });

  it('still reports the gap when a stated stay outruns the room booked for it', () => {
    // The host said when this guest is here, so a short booking is a real gap.
    const result = calculateUnassignedDates(
      makePerson({
        stayStartDate: '2026-09-01' as ISODateString,
        stayEndDate: '2026-09-05' as ISODateString,
      }),
      [],
      [],
      [makeAssignment('2026-09-01', '2026-09-03')],
      tripWindow('2026-09-01', '2026-09-10'),
    );

    expect(result?.unassignedDates).toEqual(['2026-09-03', '2026-09-04']);
  });

  // Reported from the app: create a guest with no dates, give them a room, then
  // edit the trip's dates. The guest appeared in their room *and* in the
  // "needs room" row, for days nobody ever said they would be there for.
  it('keeps an undated guest housed after the trip dates are widened', () => {
    const result = calculateUnassignedDates(
      makePerson(),
      [],
      [],
      // The room the host booked while the trip still ran 01 – 10 Sep.
      [makeAssignment('2026-09-01', '2026-09-10')],
      // The trip now runs to 3 Oct.
      tripWindow('2026-09-01', '2026-10-03'),
    );

    expect(result).toBeNull();
  });

  it('keeps an undated guest housed after the trip dates are moved earlier', () => {
    const result = calculateUnassignedDates(
      makePerson(),
      [],
      [],
      [makeAssignment('2026-09-05', '2026-09-10')],
      tripWindow('2026-09-01', '2026-09-10'),
    );

    expect(result).toBeNull();
  });
});
