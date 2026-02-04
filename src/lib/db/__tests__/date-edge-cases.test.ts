/**
 * @fileoverview Comprehensive date edge case tests for Kikoushou.
 *
 * Tests date handling robustness across:
 * - Timezone boundary dates
 * - DST (Daylight Saving Time) transitions
 * - Year boundaries and leap years
 * - Month boundaries
 * - Date range overlaps
 * - Invalid dates
 * - Date comparison edge cases
 *
 * @module lib/db/__tests__/date-edge-cases.test
 */

import { describe, it, expect } from 'vitest';

import {
  parseISODateString,
  parseISODateTimeString,
  toISODateString,
  toISODateTimeString,
  isValidISODateString,
  toISODateStringFromString,
} from '../utils';
import {
  createAssignment,
  checkAssignmentConflict,
  getAssignmentsForDate,
} from '../repositories/assignment-repository';
import { createTrip } from '../repositories/trip-repository';
import { createRoom } from '../repositories/room-repository';
import { createPerson } from '../repositories/person-repository';
import type { PersonId, RoomId, TripId } from '@/types';
import { isoDate, hexColor } from '@/test/utils';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates a test trip with customizable dates.
 */
async function createTestTrip(
  startDate = '2024-01-01',
  endDate = '2024-12-31',
  name = 'Date Edge Case Trip'
): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: isoDate(startDate),
    endDate: isoDate(endDate),
  });
  return trip.id;
}

/**
 * Creates a test room.
 */
async function createTestRoom(tripId: TripId, name = 'Test Room'): Promise<RoomId> {
  const room = await createRoom(tripId, { name, capacity: 2 });
  return room.id;
}

/**
 * Creates a test person.
 */
async function createTestPerson(tripId: TripId, name = 'Test Person'): Promise<PersonId> {
  const person = await createPerson(tripId, { name, color: hexColor('#3b82f6') });
  return person.id;
}

// ============================================================================
// Timezone Boundary Date Tests
// ============================================================================

describe('Timezone Boundary Dates', () => {
  describe('parseISODateString timezone handling', () => {
    it('parses date at midnight UTC correctly', () => {
      // Dates at midnight UTC should be parsed without timezone shift
      const result = parseISODateString('2024-07-15');

      expect(result).not.toBeNull();
      expect(result?.toISOString()).toBe('2024-07-15T00:00:00.000Z');
      expect(result?.getUTCDate()).toBe(15);
      expect(result?.getUTCMonth()).toBe(6); // July is 0-indexed
      expect(result?.getUTCFullYear()).toBe(2024);
    });

    it('handles dates that could shift across day boundary in different timezones', () => {
      // Test dates that are problematic in timezones like UTC-12 to UTC+14
      const testDates = [
        '2024-01-01', // New Year's Day
        '2024-06-21', // Summer solstice
        '2024-12-31', // New Year's Eve
      ];

      for (const dateStr of testDates) {
        const result = parseISODateString(dateStr);
        expect(result).not.toBeNull();
        // Verify UTC components match the input string
        const [year, month, day] = dateStr.split('-').map(Number);
        expect(result?.getUTCFullYear()).toBe(year);
        expect(result?.getUTCMonth()).toBe(month! - 1);
        expect(result?.getUTCDate()).toBe(day);
      }
    });

    it('maintains date consistency when round-tripping through toISODateString', () => {
      const originalDate = '2024-03-15';
      const parsed = parseISODateString(originalDate);
      expect(parsed).not.toBeNull();

      const roundTripped = toISODateString(parsed!);
      expect(roundTripped).toBe(originalDate);
    });
  });

  describe('toISODateTimeString timezone handling', () => {
    it('formats datetime at exactly midnight UTC', () => {
      const date = new Date('2024-07-15T00:00:00.000Z');
      const result = toISODateTimeString(date);

      expect(result).toBe('2024-07-15T00:00:00.000Z');
    });

    it('formats datetime at 23:59:59.999 UTC', () => {
      const date = new Date('2024-07-15T23:59:59.999Z');
      const result = toISODateTimeString(date);

      expect(result).toBe('2024-07-15T23:59:59.999Z');
    });

    it('formats datetime crossing midnight UTC', () => {
      // One millisecond before midnight
      const beforeMidnight = new Date('2024-07-15T23:59:59.999Z');
      expect(toISODateTimeString(beforeMidnight)).toBe('2024-07-15T23:59:59.999Z');

      // Exactly midnight (next day)
      const atMidnight = new Date('2024-07-16T00:00:00.000Z');
      expect(toISODateTimeString(atMidnight)).toBe('2024-07-16T00:00:00.000Z');
    });
  });

  describe('parseISODateTimeString with different timezone offsets', () => {
    it('parses UTC datetime correctly', () => {
      const result = parseISODateTimeString('2024-07-15T14:30:00.000Z');
      expect(result).not.toBeNull();
      expect(result?.getUTCHours()).toBe(14);
      expect(result?.getUTCMinutes()).toBe(30);
    });

    it('parses positive timezone offset correctly', () => {
      // +02:00 means 2 hours ahead of UTC
      const result = parseISODateTimeString('2024-07-15T16:30:00+02:00');
      expect(result).not.toBeNull();
      // UTC time should be 14:30
      expect(result?.getUTCHours()).toBe(14);
      expect(result?.getUTCMinutes()).toBe(30);
    });

    it('parses negative timezone offset correctly', () => {
      // -05:00 means 5 hours behind UTC
      const result = parseISODateTimeString('2024-07-15T09:30:00-05:00');
      expect(result).not.toBeNull();
      // UTC time should be 14:30
      expect(result?.getUTCHours()).toBe(14);
      expect(result?.getUTCMinutes()).toBe(30);
    });

    it('handles timezone offset that crosses date boundary', () => {
      // 01:00 in UTC+10 is still July 14 in UTC
      const result = parseISODateTimeString('2024-07-15T01:00:00+10:00');
      expect(result).not.toBeNull();
      // UTC time: 15:00 on July 14
      expect(result?.getUTCDate()).toBe(14);
      expect(result?.getUTCHours()).toBe(15);
    });

    it('handles extreme timezone offsets', () => {
      // UTC+14 (Line Islands)
      const result1 = parseISODateTimeString('2024-07-15T14:00:00+14:00');
      expect(result1).not.toBeNull();
      expect(result1?.getUTCHours()).toBe(0);
      expect(result1?.getUTCDate()).toBe(15);

      // UTC-12 (Baker Island)
      const result2 = parseISODateTimeString('2024-07-15T02:00:00-12:00');
      expect(result2).not.toBeNull();
      expect(result2?.getUTCHours()).toBe(14);
    });
  });
});

// ============================================================================
// DST (Daylight Saving Time) Transition Tests
// ============================================================================

describe('DST (Daylight Saving Time) Transitions', () => {
  describe('Spring forward dates (March - US/EU)', () => {
    it('handles date on US spring forward day (March 10, 2024)', () => {
      // US DST starts second Sunday of March
      const springForward = '2024-03-10';
      const result = parseISODateString(springForward);

      expect(result).not.toBeNull();
      expect(toISODateString(result!)).toBe(springForward);
    });

    it('handles date on EU spring forward day (March 31, 2024)', () => {
      // EU DST starts last Sunday of March
      const springForward = '2024-03-31';
      const result = parseISODateString(springForward);

      expect(result).not.toBeNull();
      expect(toISODateString(result!)).toBe(springForward);
    });

    it('handles datetime during spring forward transition', () => {
      // 2:00 AM doesn't exist during spring forward (jumps to 3:00 AM)
      // But UTC-based parsing should still work
      const result = parseISODateTimeString('2024-03-10T02:30:00.000Z');
      expect(result).not.toBeNull();
      expect(result?.getUTCHours()).toBe(2);
      expect(result?.getUTCMinutes()).toBe(30);
    });
  });

  describe('Fall back dates (November - US / October - EU)', () => {
    it('handles date on US fall back day (November 3, 2024)', () => {
      // US DST ends first Sunday of November
      const fallBack = '2024-11-03';
      const result = parseISODateString(fallBack);

      expect(result).not.toBeNull();
      expect(toISODateString(result!)).toBe(fallBack);
    });

    it('handles date on EU fall back day (October 27, 2024)', () => {
      // EU DST ends last Sunday of October
      const fallBack = '2024-10-27';
      const result = parseISODateString(fallBack);

      expect(result).not.toBeNull();
      expect(toISODateString(result!)).toBe(fallBack);
    });

    it('handles datetime during fall back transition', () => {
      // 2:00 AM occurs twice during fall back
      // UTC-based parsing should be unambiguous
      const result = parseISODateTimeString('2024-11-03T02:30:00.000Z');
      expect(result).not.toBeNull();
      expect(result?.getUTCHours()).toBe(2);
    });
  });

  describe('Assignments spanning DST changes', () => {
    it('creates assignment spanning US spring forward', async () => {
      const tripId = await createTestTrip('2024-03-01', '2024-03-31');
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Assignment spans March 8-12 (includes spring forward on March 10)
      const assignment = await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-03-08'),
        endDate: isoDate('2024-03-12'),
      });

      expect(assignment.startDate).toBe('2024-03-08');
      expect(assignment.endDate).toBe('2024-03-12');

      // Verify conflict detection works across DST boundary
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-03-10', // Spring forward day
        '2024-03-10'
      );
      expect(hasConflict).toBe(true);
    });

    it('creates assignment spanning EU fall back', async () => {
      const tripId = await createTestTrip('2024-10-01', '2024-10-31');
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Assignment spans October 25-29 (includes fall back on October 27)
      const assignment = await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-10-25'),
        endDate: isoDate('2024-10-29'),
      });

      expect(assignment.startDate).toBe('2024-10-25');
      expect(assignment.endDate).toBe('2024-10-29');

      // Verify assignments for date works on fall back day
      const assignments = await getAssignmentsForDate(tripId, '2024-10-27');
      expect(assignments).toHaveLength(1);
    });
  });
});

// ============================================================================
// Year Boundary Tests
// ============================================================================

describe('Year Boundaries', () => {
  describe('Assignments spanning New Year', () => {
    it('creates assignment from December 31 to January 1', async () => {
      // Trip spans year boundary
      const tripId = await createTestTrip('2024-12-01', '2025-01-31');
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      const assignment = await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-12-31'),
        endDate: isoDate('2025-01-01'),
      });

      expect(assignment.startDate).toBe('2024-12-31');
      expect(assignment.endDate).toBe('2025-01-01');
    });

    it('detects conflicts across year boundary', async () => {
      const tripId = await createTestTrip('2024-12-01', '2025-01-31');
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: Dec 30 - Jan 2
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-12-30'),
        endDate: isoDate('2025-01-02'),
      });

      // New overlaps on Dec 31
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-12-29',
        '2024-12-31'
      );
      expect(hasConflict).toBe(true);

      // New overlaps on Jan 1
      const hasConflict2 = await checkAssignmentConflict(
        tripId,
        personId,
        '2025-01-01',
        '2025-01-05'
      );
      expect(hasConflict2).toBe(true);
    });

    it('handles assignment starting on New Year and ending same day', async () => {
      const tripId = await createTestTrip('2024-12-01', '2025-01-31');
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      const assignment = await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2025-01-01'),
        endDate: isoDate('2025-01-01'),
      });

      expect(assignment.startDate).toBe('2025-01-01');
      expect(assignment.endDate).toBe('2025-01-01');
    });
  });

  describe('Leap year February 29', () => {
    it('validates leap year date (2024-02-29)', () => {
      expect(isValidISODateString('2024-02-29')).toBe(true);

      const result = parseISODateString('2024-02-29');
      expect(result).not.toBeNull();
      expect(result?.getUTCDate()).toBe(29);
      expect(result?.getUTCMonth()).toBe(1); // February
    });

    it('validates century leap year date (2000-02-29)', () => {
      // 2000 is divisible by 400, so it's a leap year
      expect(isValidISODateString('2000-02-29')).toBe(true);
    });

    it('rejects non-leap year Feb 29 (2023-02-29)', () => {
      expect(isValidISODateString('2023-02-29')).toBe(false);
      expect(parseISODateString('2023-02-29')).toBeNull();
    });

    it('rejects century non-leap year Feb 29 (1900-02-29)', () => {
      // 1900 is divisible by 100 but not 400, so NOT a leap year
      expect(isValidISODateString('1900-02-29')).toBe(false);
    });

    it('creates assignment on leap day', async () => {
      const tripId = await createTestTrip('2024-02-01', '2024-02-29');
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      const assignment = await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-02-29'),
        endDate: isoDate('2024-02-29'),
      });

      expect(assignment.startDate).toBe('2024-02-29');
      expect(assignment.endDate).toBe('2024-02-29');
    });

    it('creates assignment spanning Feb 28 to March 1 in leap year', async () => {
      const tripId = await createTestTrip('2024-02-01', '2024-03-31');
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      const assignment = await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-02-28'),
        endDate: isoDate('2024-03-01'),
      });

      expect(assignment.startDate).toBe('2024-02-28');
      expect(assignment.endDate).toBe('2024-03-01');

      // Verify leap day is included
      const assignments = await getAssignmentsForDate(tripId, '2024-02-29');
      expect(assignments).toHaveLength(1);
    });

    it('creates assignment spanning Feb 28 to March 1 in non-leap year', async () => {
      const tripId = await createTestTrip('2023-02-01', '2023-03-31');
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      const assignment = await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2023-02-28'),
        endDate: isoDate('2023-03-01'),
      });

      expect(assignment.startDate).toBe('2023-02-28');
      expect(assignment.endDate).toBe('2023-03-01');
    });
  });
});

// ============================================================================
// Month Boundary Tests
// ============================================================================

describe('Month Boundaries', () => {
  describe('Assignments spanning month ends', () => {
    it('creates assignment spanning 31-day month end (January 31 to February 1)', async () => {
      const tripId = await createTestTrip('2024-01-15', '2024-02-15');
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      const assignment = await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-01-31'),
        endDate: isoDate('2024-02-01'),
      });

      expect(assignment.startDate).toBe('2024-01-31');
      expect(assignment.endDate).toBe('2024-02-01');
    });

    it('creates assignment spanning 30-day month end (April 30 to May 1)', async () => {
      const tripId = await createTestTrip('2024-04-15', '2024-05-15');
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      const assignment = await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-04-30'),
        endDate: isoDate('2024-05-01'),
      });

      expect(assignment.startDate).toBe('2024-04-30');
      expect(assignment.endDate).toBe('2024-05-01');
    });

    it('creates assignment spanning 28-day month end (February 28 to March 1 non-leap)', async () => {
      const tripId = await createTestTrip('2023-02-15', '2023-03-15');
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      const assignment = await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2023-02-28'),
        endDate: isoDate('2023-03-01'),
      });

      expect(assignment.startDate).toBe('2023-02-28');
      expect(assignment.endDate).toBe('2023-03-01');
    });
  });

  describe('Months with different day counts', () => {
    it('validates last day of each 31-day month', () => {
      const months31 = ['01', '03', '05', '07', '08', '10', '12'];

      for (const month of months31) {
        const dateStr = `2024-${month}-31`;
        expect(isValidISODateString(dateStr)).toBe(true);
        expect(parseISODateString(dateStr)).not.toBeNull();
      }
    });

    it('validates last day of each 30-day month', () => {
      const months30 = ['04', '06', '09', '11'];

      for (const month of months30) {
        const dateStr = `2024-${month}-30`;
        expect(isValidISODateString(dateStr)).toBe(true);
        expect(parseISODateString(dateStr)).not.toBeNull();
      }
    });

    it('rejects day 31 for 30-day months', () => {
      const months30 = ['04', '06', '09', '11'];

      for (const month of months30) {
        const dateStr = `2024-${month}-31`;
        expect(isValidISODateString(dateStr)).toBe(false);
        expect(parseISODateString(dateStr)).toBeNull();
      }
    });

    it('rejects day 30 and 31 for February', () => {
      expect(isValidISODateString('2024-02-30')).toBe(false);
      expect(isValidISODateString('2024-02-31')).toBe(false);
      expect(isValidISODateString('2023-02-30')).toBe(false);
      expect(isValidISODateString('2023-02-31')).toBe(false);
    });
  });
});

// ============================================================================
// Date Range Overlap Tests
// ============================================================================

describe('Date Range Overlaps', () => {
  describe('Same start date, different end dates', () => {
    it('detects conflict: same start, existing ends earlier', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 15-17
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-17'),
      });

      // New: July 15-20 (same start, ends later)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-20'
      );
      expect(hasConflict).toBe(true);
    });

    it('detects conflict: same start, new ends earlier', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 15-20
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      });

      // New: July 15-17 (same start, ends earlier)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-17'
      );
      expect(hasConflict).toBe(true);
    });
  });

  describe('Same end date, different start dates', () => {
    it('detects conflict: same end, existing starts earlier', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 15-20
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      });

      // New: July 18-20 (starts later, same end)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-18',
        '2024-07-20'
      );
      expect(hasConflict).toBe(true);
    });

    it('detects conflict: same end, new starts earlier', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 18-20
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-18'),
        endDate: isoDate('2024-07-20'),
      });

      // New: July 15-20 (starts earlier, same end)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-20'
      );
      expect(hasConflict).toBe(true);
    });
  });

  describe('One range fully contains another', () => {
    it('detects conflict: new range fully contains existing', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 17-18 (small range)
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-17'),
        endDate: isoDate('2024-07-18'),
      });

      // New: July 15-20 (fully contains existing)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-20'
      );
      expect(hasConflict).toBe(true);
    });

    it('detects conflict: existing range fully contains new', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 15-20 (large range)
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      });

      // New: July 17-18 (fully within existing)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-17',
        '2024-07-18'
      );
      expect(hasConflict).toBe(true);
    });
  });

  describe('Ranges that touch but might not overlap (boundary conditions)', () => {
    it('detects conflict when ranges share a single day (Jan 1-5 and Jan 5-10)', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: Jan 1-5
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-01-01'),
        endDate: isoDate('2024-01-05'),
      });

      // New: Jan 5-10 (starts on existing's end date)
      // This IS a conflict because the person is in the room on Jan 5
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-01-05',
        '2024-01-10'
      );
      expect(hasConflict).toBe(true);
    });

    it('no conflict when ranges are adjacent (Jan 1-5 and Jan 6-10)', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: Jan 1-5
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-01-01'),
        endDate: isoDate('2024-01-05'),
      });

      // New: Jan 6-10 (starts day after existing ends)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-01-06',
        '2024-01-10'
      );
      expect(hasConflict).toBe(false);
    });

    it('no conflict when ranges have gap (Jan 1-5 and Jan 7-10)', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: Jan 1-5
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-01-01'),
        endDate: isoDate('2024-01-05'),
      });

      // New: Jan 7-10 (gap of one day)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-01-07',
        '2024-01-10'
      );
      expect(hasConflict).toBe(false);
    });

    it('detects conflict when new ends on existing start (Jan 5-10 existing, Jan 1-5 new)', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: Jan 5-10
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-01-05'),
        endDate: isoDate('2024-01-10'),
      });

      // New: Jan 1-5 (ends on existing's start date)
      // This IS a conflict because the person is in the room on Jan 5
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-01-01',
        '2024-01-05'
      );
      expect(hasConflict).toBe(true);
    });

    it('no conflict when new ends before existing starts (Jan 5-10 existing, Jan 1-4 new)', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: Jan 5-10
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-01-05'),
        endDate: isoDate('2024-01-10'),
      });

      // New: Jan 1-4 (ends day before existing starts)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-01-01',
        '2024-01-04'
      );
      expect(hasConflict).toBe(false);
    });
  });

  describe('Single-day ranges', () => {
    it('detects conflict between two identical single-day ranges', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 15 only
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-15'),
      });

      // New: July 15 only (same day)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-15',
        '2024-07-15'
      );
      expect(hasConflict).toBe(true);
    });

    it('detects conflict: single day within range', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 15-20
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      });

      // New: July 17 only (single day within)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-17',
        '2024-07-17'
      );
      expect(hasConflict).toBe(true);
    });

    it('no conflict: single day before range', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 15-20
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      });

      // New: July 14 only (before)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-14',
        '2024-07-14'
      );
      expect(hasConflict).toBe(false);
    });

    it('no conflict: single day after range', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // Existing: July 15-20
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      });

      // New: July 21 only (after)
      const hasConflict = await checkAssignmentConflict(
        tripId,
        personId,
        '2024-07-21',
        '2024-07-21'
      );
      expect(hasConflict).toBe(false);
    });
  });
});

// ============================================================================
// Invalid Date Tests
// ============================================================================

describe('Invalid Dates', () => {
  describe('February 30 (never valid)', () => {
    it('rejects February 30 in leap year', () => {
      expect(isValidISODateString('2024-02-30')).toBe(false);
      expect(parseISODateString('2024-02-30')).toBeNull();
    });

    it('rejects February 30 in non-leap year', () => {
      expect(isValidISODateString('2023-02-30')).toBe(false);
      expect(parseISODateString('2023-02-30')).toBeNull();
    });
  });

  describe('Invalid ISO format strings', () => {
    it('rejects MM-DD-YYYY format', () => {
      expect(isValidISODateString('07-15-2024')).toBe(false);
      expect(parseISODateString('07-15-2024')).toBeNull();
    });

    it('rejects DD/MM/YYYY format', () => {
      expect(isValidISODateString('15/07/2024')).toBe(false);
      expect(parseISODateString('15/07/2024')).toBeNull();
    });

    it('rejects YYYYMMDD format (no separators)', () => {
      expect(isValidISODateString('20240715')).toBe(false);
      expect(parseISODateString('20240715')).toBeNull();
    });

    it('rejects partial dates', () => {
      expect(isValidISODateString('2024-07')).toBe(false);
      expect(isValidISODateString('2024')).toBe(false);
      expect(parseISODateString('2024-07')).toBeNull();
      expect(parseISODateString('2024')).toBeNull();
    });

    it('rejects dates with extra characters', () => {
      expect(isValidISODateString('2024-07-15T')).toBe(false);
      expect(isValidISODateString('2024-07-15 ')).toBe(false);
      expect(isValidISODateString(' 2024-07-15')).toBe(false);
      expect(parseISODateString('2024-07-15abc')).toBeNull();
    });

    it('rejects dates with wrong separators', () => {
      expect(isValidISODateString('2024/07/15')).toBe(false);
      expect(isValidISODateString('2024.07.15')).toBe(false);
      expect(parseISODateString('2024_07_15')).toBeNull();
    });

    it('rejects datetime strings when date expected', () => {
      expect(isValidISODateString('2024-07-15T14:30:00.000Z')).toBe(false);
      expect(parseISODateString('2024-07-15T00:00:00Z')).toBeNull();
    });
  });

  describe('Empty and whitespace strings', () => {
    it('rejects empty string', () => {
      expect(isValidISODateString('')).toBe(false);
      expect(parseISODateString('')).toBeNull();
    });

    it('rejects whitespace-only string', () => {
      expect(isValidISODateString('   ')).toBe(false);
      expect(isValidISODateString('\t')).toBe(false);
      expect(isValidISODateString('\n')).toBe(false);
      expect(parseISODateString('   ')).toBeNull();
    });

    it('rejects null-like strings', () => {
      expect(isValidISODateString('null')).toBe(false);
      expect(isValidISODateString('undefined')).toBe(false);
      expect(parseISODateString('null')).toBeNull();
    });
  });

  describe('Invalid date values with valid format', () => {
    it('rejects month 00', () => {
      expect(isValidISODateString('2024-00-15')).toBe(false);
    });

    it('rejects month 13', () => {
      expect(isValidISODateString('2024-13-15')).toBe(false);
    });

    it('rejects day 00', () => {
      expect(isValidISODateString('2024-07-00')).toBe(false);
    });

    it('rejects day 32', () => {
      expect(isValidISODateString('2024-07-32')).toBe(false);
    });

    it('rejects negative year format', () => {
      // While negative years exist historically, the format doesn't support them
      expect(isValidISODateString('-2024-07-15')).toBe(false);
    });
  });

  describe('toISODateStringFromString validation', () => {
    it('throws for invalid date format', () => {
      expect(() => toISODateStringFromString('07-15-2024')).toThrow(
        'Invalid ISO date string'
      );
    });

    it('throws for invalid date values', () => {
      expect(() => toISODateStringFromString('2024-02-30')).toThrow(
        'Invalid ISO date string'
      );
    });

    it('returns branded type for valid date', () => {
      const result = toISODateStringFromString('2024-07-15');
      expect(result).toBe('2024-07-15');
    });
  });
});

// ============================================================================
// Date Comparison Edge Cases
// ============================================================================

describe('Date Comparison Edge Cases', () => {
  describe('String comparison vs Date object comparison', () => {
    it('ISO date strings compare correctly as strings (lexicographic)', () => {
      // String comparison works for ISO dates because YYYY-MM-DD is lexicographically ordered
      expect('2024-07-15' < '2024-07-16').toBe(true);
      expect('2024-07-15' < '2024-08-01').toBe(true);
      expect('2024-07-15' < '2025-01-01').toBe(true);
      expect('2024-07-15' === '2024-07-15').toBe(true);
      expect('2024-07-16' > '2024-07-15').toBe(true);
    });

    it('ISO date strings compare correctly across month boundaries', () => {
      expect('2024-01-31' < '2024-02-01').toBe(true);
      expect('2024-02-28' < '2024-03-01').toBe(true);
      expect('2024-12-31' < '2025-01-01').toBe(true);
    });

    it('ISO date strings compare correctly across year boundaries', () => {
      expect('2023-12-31' < '2024-01-01').toBe(true);
      expect('2024-12-31' < '2025-01-01').toBe(true);
    });

    it('parsed Date objects maintain comparison consistency', () => {
      const date1 = parseISODateString('2024-07-15')!;
      const date2 = parseISODateString('2024-07-16')!;
      const date3 = parseISODateString('2024-07-15')!;

      expect(date1.getTime() < date2.getTime()).toBe(true);
      expect(date1.getTime() === date3.getTime()).toBe(true);
    });
  });

  describe('Assignment conflict detection using string comparison', () => {
    it('correctly compares dates in conflict detection (implementation detail)', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      // The checkAssignmentConflict uses string comparison: startDate <= end && endDate >= start
      // Verify this works correctly

      // Existing: July 15-20
      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      });

      // Edge case: new starts exactly on existing end
      expect(await checkAssignmentConflict(tripId, personId, '2024-07-20', '2024-07-25')).toBe(true);

      // Edge case: new ends exactly on existing start
      expect(await checkAssignmentConflict(tripId, personId, '2024-07-10', '2024-07-15')).toBe(true);

      // No overlap: new is entirely before
      expect(await checkAssignmentConflict(tripId, personId, '2024-07-01', '2024-07-14')).toBe(false);

      // No overlap: new is entirely after
      expect(await checkAssignmentConflict(tripId, personId, '2024-07-21', '2024-07-30')).toBe(false);
    });
  });

  describe('Date ordering with different month lengths', () => {
    it('maintains correct order for dates across February/March boundary', () => {
      const dates = [
        '2024-02-28',
        '2024-02-29', // Leap year
        '2024-03-01',
      ];

      for (let i = 0; i < dates.length - 1; i++) {
        expect(dates[i]! < dates[i + 1]!).toBe(true);
      }
    });

    it('maintains correct order for all month transitions', () => {
      const monthEnds = [
        ['2024-01-31', '2024-02-01'],
        ['2024-02-29', '2024-03-01'],
        ['2024-03-31', '2024-04-01'],
        ['2024-04-30', '2024-05-01'],
        ['2024-05-31', '2024-06-01'],
        ['2024-06-30', '2024-07-01'],
        ['2024-07-31', '2024-08-01'],
        ['2024-08-31', '2024-09-01'],
        ['2024-09-30', '2024-10-01'],
        ['2024-10-31', '2024-11-01'],
        ['2024-11-30', '2024-12-01'],
        ['2024-12-31', '2025-01-01'],
      ];

      for (const [end, start] of monthEnds) {
        expect(end! < start!).toBe(true);
      }
    });
  });

  describe('Timezone consistency in stored vs compared dates', () => {
    // Note: We don't use fake timers here because they interfere with IndexedDB async operations.
    // Instead, we test that dates are stored/retrieved as strings, independent of system time.

    it('date stored and retrieved maintains consistency', async () => {
      // Store assignments with explicit date strings
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      const assignment = await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      });

      // The stored date should be the exact string, not affected by any timezone
      expect(assignment.startDate).toBe('2024-07-15');
      expect(assignment.endDate).toBe('2024-07-20');

      // Verify the date strings are preserved as-is (not converted to/from Date objects)
      expect(typeof assignment.startDate).toBe('string');
      expect(typeof assignment.endDate).toBe('string');
    });

    it('getAssignmentsForDate uses string comparison consistently', async () => {
      const tripId = await createTestTrip();
      const roomId = await createTestRoom(tripId);
      const personId = await createTestPerson(tripId);

      await createAssignment(tripId, {
        roomId,
        personId,
        startDate: isoDate('2024-07-15'),
        endDate: isoDate('2024-07-20'),
      });

      // Query using string date - this works because comparison is string-based
      const assignments = await getAssignmentsForDate(tripId, '2024-07-17');
      expect(assignments).toHaveLength(1);

      // Query on boundary dates
      const startBoundary = await getAssignmentsForDate(tripId, '2024-07-15');
      expect(startBoundary).toHaveLength(1);

      const endBoundary = await getAssignmentsForDate(tripId, '2024-07-20');
      expect(endBoundary).toHaveLength(1);

      // Query outside range
      const beforeRange = await getAssignmentsForDate(tripId, '2024-07-14');
      expect(beforeRange).toHaveLength(0);

      const afterRange = await getAssignmentsForDate(tripId, '2024-07-21');
      expect(afterRange).toHaveLength(0);
    });
  });
});

// ============================================================================
// Round-Trip Consistency Tests
// ============================================================================

describe('Round-Trip Consistency', () => {
  it('Date -> ISOString -> Date maintains value', () => {
    const dates = [
      new Date('2024-01-01T00:00:00.000Z'),
      new Date('2024-02-29T00:00:00.000Z'), // Leap day
      new Date('2024-07-15T00:00:00.000Z'),
      new Date('2024-12-31T00:00:00.000Z'),
    ];

    for (const originalDate of dates) {
      const isoString = toISODateString(originalDate);
      const parsedBack = parseISODateString(isoString);

      expect(parsedBack).not.toBeNull();
      expect(parsedBack?.getTime()).toBe(originalDate.getTime());
    }
  });

  it('ISOString -> Date -> ISOString maintains value', () => {
    const dateStrings = [
      '2024-01-01',
      '2024-02-29',
      '2024-07-15',
      '2024-12-31',
      '2000-02-29', // Century leap year
    ];

    for (const original of dateStrings) {
      const parsed = parseISODateString(original);
      expect(parsed).not.toBeNull();

      const backToString = toISODateString(parsed!);
      expect(backToString).toBe(original);
    }
  });

  it('DateTime round-trip maintains UTC consistency', () => {
    const datetimes = [
      '2024-07-15T00:00:00.000Z',
      '2024-07-15T12:30:45.123Z',
      '2024-07-15T23:59:59.999Z',
    ];

    for (const original of datetimes) {
      const parsed = parseISODateTimeString(original);
      expect(parsed).not.toBeNull();

      const backToString = toISODateTimeString(parsed!);
      expect(backToString).toBe(original);
    }
  });
});
