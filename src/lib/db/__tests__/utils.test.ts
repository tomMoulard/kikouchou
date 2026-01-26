/**
 * @fileoverview Unit tests for database utility functions.
 * Tests ID generation, timestamp utilities, validation type guards,
 * parsing functions, and database helpers.
 *
 * @module lib/db/__tests__/utils.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  // ID Generation
  createTripId,
  createRoomId,
  createPersonId,
  createRoomAssignmentId,
  createTransportId,
  createShareId,
  generateId,
  // Timestamp Utilities
  now,
  toUnixTimestamp,
  fromUnixTimestamp,
  toISODateString,
  toISODateTimeString,
  // Parsing Functions
  parseISODateString,
  parseISODateTimeString,
  // Validation Type Guards
  isValidISODateString,
  isValidISODateTimeString,
  isValidHexColor,
  // Database Helpers
  createTimestamps,
  updateTimestamp,
} from '../utils';

// ============================================================================
// Test Suites
// ============================================================================

describe('utils', () => {
  // ==========================================================================
  // ID Generation Tests
  // ==========================================================================

  describe('ID Generation', () => {
    describe('generateId', () => {
      it('should return a 21-character string', () => {
        const id = generateId();
        expect(id).toHaveLength(21);
        expect(typeof id).toBe('string');
      });

      it('should return only URL-safe characters', () => {
        const id = generateId();
        // nanoid uses A-Za-z0-9_- by default
        expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
      });

      it('should generate unique IDs on consecutive calls', () => {
        const id1 = generateId();
        const id2 = generateId();
        const id3 = generateId();

        expect(id1).not.toBe(id2);
        expect(id2).not.toBe(id3);
        expect(id1).not.toBe(id3);
      });

      it('should generate at least 1000 unique IDs without collision', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 1000; i++) {
          ids.add(generateId());
        }
        expect(ids.size).toBe(1000);
      });
    });

    describe('createTripId', () => {
      it('should return a 21-character string', () => {
        const id = createTripId();
        expect(id).toHaveLength(21);
      });

      it('should return unique IDs on consecutive calls', () => {
        const id1 = createTripId();
        const id2 = createTripId();
        expect(id1).not.toBe(id2);
      });

      it('should return a branded TripId type', () => {
        const id = createTripId();
        // TypeScript compile-time check - runtime just checks it's a string
        expect(typeof id).toBe('string');
      });
    });

    describe('createRoomId', () => {
      it('should return a 21-character string', () => {
        const id = createRoomId();
        expect(id).toHaveLength(21);
      });

      it('should return unique IDs on consecutive calls', () => {
        const id1 = createRoomId();
        const id2 = createRoomId();
        expect(id1).not.toBe(id2);
      });
    });

    describe('createPersonId', () => {
      it('should return a 21-character string', () => {
        const id = createPersonId();
        expect(id).toHaveLength(21);
      });

      it('should return unique IDs on consecutive calls', () => {
        const id1 = createPersonId();
        const id2 = createPersonId();
        expect(id1).not.toBe(id2);
      });
    });

    describe('createRoomAssignmentId', () => {
      it('should return a 21-character string', () => {
        const id = createRoomAssignmentId();
        expect(id).toHaveLength(21);
      });

      it('should return unique IDs on consecutive calls', () => {
        const id1 = createRoomAssignmentId();
        const id2 = createRoomAssignmentId();
        expect(id1).not.toBe(id2);
      });
    });

    describe('createTransportId', () => {
      it('should return a 21-character string', () => {
        const id = createTransportId();
        expect(id).toHaveLength(21);
      });

      it('should return unique IDs on consecutive calls', () => {
        const id1 = createTransportId();
        const id2 = createTransportId();
        expect(id1).not.toBe(id2);
      });
    });

    describe('createShareId', () => {
      it('should return exactly 10 characters', () => {
        const id = createShareId();
        expect(id).toHaveLength(10);
      });

      it('should return only URL-safe characters', () => {
        const id = createShareId();
        expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
      });

      it('should return unique IDs on consecutive calls', () => {
        const id1 = createShareId();
        const id2 = createShareId();
        expect(id1).not.toBe(id2);
      });

      it('should generate at least 100 unique IDs without collision', () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i++) {
          ids.add(createShareId());
        }
        expect(ids.size).toBe(100);
      });
    });
  });

  // ==========================================================================
  // Timestamp Utilities Tests
  // ==========================================================================

  describe('Timestamp Utilities', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe('now', () => {
      it('should return current Unix timestamp in milliseconds', () => {
        const testTime = new Date('2024-07-15T10:30:00.000Z').getTime();
        vi.setSystemTime(testTime);

        const timestamp = now();
        expect(timestamp).toBe(testTime);
      });

      it('should return a number', () => {
        const timestamp = now();
        expect(typeof timestamp).toBe('number');
      });

      it('should return an integer value', () => {
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
        const timestamp = now();
        expect(Number.isInteger(timestamp)).toBe(true);
      });

      it('should update when time advances', () => {
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
        const timestamp1 = now();

        vi.advanceTimersByTime(1000); // Advance 1 second
        const timestamp2 = now();

        expect(timestamp2 - timestamp1).toBe(1000);
      });
    });

    describe('toUnixTimestamp', () => {
      it('should convert Date to Unix timestamp in milliseconds', () => {
        const date = new Date('2024-07-15T10:30:00.000Z');
        const timestamp = toUnixTimestamp(date);

        expect(timestamp).toBe(date.getTime());
      });

      it('should handle Date at Unix epoch', () => {
        const date = new Date('1970-01-01T00:00:00.000Z');
        const timestamp = toUnixTimestamp(date);

        expect(timestamp).toBe(0);
      });

      it('should handle future dates', () => {
        const date = new Date('2050-12-31T23:59:59.999Z');
        const timestamp = toUnixTimestamp(date);

        expect(timestamp).toBe(date.getTime());
        expect(timestamp).toBeGreaterThan(0);
      });

      it('should handle dates before Unix epoch (negative timestamps)', () => {
        const date = new Date('1960-01-01T00:00:00.000Z');
        const timestamp = toUnixTimestamp(date);

        expect(timestamp).toBeLessThan(0);
      });

      it('should throw Error for invalid Date', () => {
        const invalidDate = new Date('invalid');

        expect(() => toUnixTimestamp(invalidDate)).toThrow(
          'Invalid Date passed to toUnixTimestamp'
        );
      });

      it('should throw Error for Date created with NaN', () => {
        const invalidDate = new Date(NaN);

        expect(() => toUnixTimestamp(invalidDate)).toThrow(
          'Invalid Date passed to toUnixTimestamp'
        );
      });
    });

    describe('fromUnixTimestamp', () => {
      it('should convert Unix timestamp to Date', () => {
        const timestamp = 1720000000000;
        const date = fromUnixTimestamp(timestamp as ReturnType<typeof now>);

        expect(date).toBeInstanceOf(Date);
        expect(date.getTime()).toBe(timestamp);
      });

      it('should handle timestamp 0 as Unix epoch', () => {
        const date = fromUnixTimestamp(0 as ReturnType<typeof now>);

        expect(date.toISOString()).toBe('1970-01-01T00:00:00.000Z');
      });

      it('should handle negative timestamps (pre-1970)', () => {
        const timestamp = -315619200000; // 1960-01-01
        const date = fromUnixTimestamp(timestamp as ReturnType<typeof now>);

        expect(date.getUTCFullYear()).toBe(1960);
      });

      it('should handle very large timestamps', () => {
        const timestamp = 4102444800000; // 2100-01-01
        const date = fromUnixTimestamp(timestamp as ReturnType<typeof now>);

        expect(date.getUTCFullYear()).toBe(2100);
      });
    });

    describe('toISODateString', () => {
      it('should format Date as YYYY-MM-DD in UTC', () => {
        const date = new Date('2024-07-15T00:00:00.000Z');
        const dateStr = toISODateString(date);

        expect(dateStr).toBe('2024-07-15');
      });

      it('should pad single-digit months', () => {
        const date = new Date('2024-01-05T00:00:00.000Z');
        const dateStr = toISODateString(date);

        expect(dateStr).toBe('2024-01-05');
      });

      it('should pad single-digit days', () => {
        const date = new Date('2024-12-09T00:00:00.000Z');
        const dateStr = toISODateString(date);

        expect(dateStr).toBe('2024-12-09');
      });

      it('should handle year boundaries correctly', () => {
        const newYearsEve = new Date('2024-12-31T23:59:59.999Z');
        const newYearsDay = new Date('2025-01-01T00:00:00.000Z');

        expect(toISODateString(newYearsEve)).toBe('2024-12-31');
        expect(toISODateString(newYearsDay)).toBe('2025-01-01');
      });

      it('should handle leap year date', () => {
        const leapDay = new Date('2024-02-29T12:00:00.000Z');
        const dateStr = toISODateString(leapDay);

        expect(dateStr).toBe('2024-02-29');
      });

      it('should throw Error for invalid Date', () => {
        const invalidDate = new Date('invalid');

        expect(() => toISODateString(invalidDate)).toThrow(
          'Invalid Date passed to toISODateString'
        );
      });

      it('should use UTC date regardless of local timezone', () => {
        // Date at UTC midnight should return same date
        const date = new Date('2024-07-15T00:00:00.000Z');
        const dateStr = toISODateString(date);

        expect(dateStr).toBe('2024-07-15');
      });
    });

    describe('toISODateTimeString', () => {
      it('should format Date as ISO 8601 with Z timezone', () => {
        const date = new Date('2024-07-15T14:30:00.000Z');
        const datetimeStr = toISODateTimeString(date);

        expect(datetimeStr).toBe('2024-07-15T14:30:00.000Z');
      });

      it('should include milliseconds', () => {
        const date = new Date('2024-07-15T14:30:00.123Z');
        const datetimeStr = toISODateTimeString(date);

        expect(datetimeStr).toContain('.123Z');
      });

      it('should handle midnight correctly', () => {
        const date = new Date('2024-07-15T00:00:00.000Z');
        const datetimeStr = toISODateTimeString(date);

        expect(datetimeStr).toBe('2024-07-15T00:00:00.000Z');
      });

      it('should handle end of day correctly', () => {
        const date = new Date('2024-07-15T23:59:59.999Z');
        const datetimeStr = toISODateTimeString(date);

        expect(datetimeStr).toBe('2024-07-15T23:59:59.999Z');
      });

      it('should throw Error for invalid Date', () => {
        const invalidDate = new Date('invalid');

        expect(() => toISODateTimeString(invalidDate)).toThrow(
          'Invalid Date passed to toISODateTimeString'
        );
      });
    });
  });

  // ==========================================================================
  // Validation Type Guards Tests
  // ==========================================================================

  describe('Validation Type Guards', () => {
    describe('isValidISODateString', () => {
      // Valid cases
      it('should return true for valid YYYY-MM-DD format', () => {
        expect(isValidISODateString('2024-07-15')).toBe(true);
        expect(isValidISODateString('2024-01-01')).toBe(true);
        expect(isValidISODateString('2024-12-31')).toBe(true);
      });

      it('should return true for leap year date (2024-02-29)', () => {
        expect(isValidISODateString('2024-02-29')).toBe(true);
      });

      it('should return true for century leap year (2000-02-29)', () => {
        expect(isValidISODateString('2000-02-29')).toBe(true);
      });

      // Invalid cases - format
      it('should return false for wrong format (MM-DD-YYYY)', () => {
        expect(isValidISODateString('07-15-2024')).toBe(false);
      });

      it('should return false for wrong format (DD/MM/YYYY)', () => {
        expect(isValidISODateString('15/07/2024')).toBe(false);
      });

      it('should return false for datetime string', () => {
        expect(isValidISODateString('2024-07-15T14:30:00.000Z')).toBe(false);
      });

      it('should return false for empty string', () => {
        expect(isValidISODateString('')).toBe(false);
      });

      it('should return false for whitespace-only string', () => {
        expect(isValidISODateString('   ')).toBe(false);
      });

      it('should return false for string with leading/trailing whitespace', () => {
        expect(isValidISODateString(' 2024-07-15 ')).toBe(false);
      });

      // Invalid cases - date values
      it('should return false for invalid month (2024-13-01)', () => {
        expect(isValidISODateString('2024-13-01')).toBe(false);
      });

      it('should return false for invalid month (2024-00-01)', () => {
        expect(isValidISODateString('2024-00-01')).toBe(false);
      });

      it('should return false for invalid day (2024-01-32)', () => {
        expect(isValidISODateString('2024-01-32')).toBe(false);
      });

      it('should return false for invalid day (2024-01-00)', () => {
        expect(isValidISODateString('2024-01-00')).toBe(false);
      });

      it('should return false for invalid leap year date (2023-02-29)', () => {
        expect(isValidISODateString('2023-02-29')).toBe(false);
      });

      it('should return false for invalid century non-leap year (1900-02-29)', () => {
        expect(isValidISODateString('1900-02-29')).toBe(false);
      });

      it('should return false for invalid day in 30-day month (2024-04-31)', () => {
        expect(isValidISODateString('2024-04-31')).toBe(false);
      });

      it('should return false for invalid February date (2024-02-30)', () => {
        expect(isValidISODateString('2024-02-30')).toBe(false);
      });

      // Edge cases
      it('should return false for partial date string', () => {
        expect(isValidISODateString('2024-07')).toBe(false);
        expect(isValidISODateString('2024')).toBe(false);
      });

      it('should return false for date with extra characters', () => {
        expect(isValidISODateString('2024-07-15abc')).toBe(false);
        expect(isValidISODateString('abc2024-07-15')).toBe(false);
      });

      it('should return a boolean true (not truthy)', () => {
        const result = isValidISODateString('2024-07-15');
        expect(result).toBe(true);
        expect(typeof result).toBe('boolean');
      });

      it('should return a boolean false (not falsy)', () => {
        const result = isValidISODateString('invalid');
        expect(result).toBe(false);
        expect(typeof result).toBe('boolean');
      });
    });

    describe('isValidISODateTimeString', () => {
      // Valid cases
      it('should return true for valid ISO 8601 datetime with Z', () => {
        expect(isValidISODateTimeString('2024-07-15T14:30:00.000Z')).toBe(true);
      });

      it('should return true for datetime without milliseconds', () => {
        expect(isValidISODateTimeString('2024-07-15T14:30:00Z')).toBe(true);
      });

      it('should return true for datetime with positive timezone offset', () => {
        expect(isValidISODateTimeString('2024-07-15T14:30:00+02:00')).toBe(true);
      });

      it('should return true for datetime with negative timezone offset', () => {
        expect(isValidISODateTimeString('2024-07-15T14:30:00-05:00')).toBe(true);
      });

      it('should return true for midnight datetime', () => {
        expect(isValidISODateTimeString('2024-07-15T00:00:00.000Z')).toBe(true);
      });

      it('should return true for end of day datetime', () => {
        expect(isValidISODateTimeString('2024-07-15T23:59:59.999Z')).toBe(true);
      });

      // Invalid cases
      it('should return false for date-only string', () => {
        expect(isValidISODateTimeString('2024-07-15')).toBe(false);
      });

      it('should return true for datetime without timezone (implementation allows it)', () => {
        // The regex makes timezone optional: (?:Z|[+-]...)?$
        expect(isValidISODateTimeString('2024-07-15T14:30:00')).toBe(true);
      });

      it('should return false for invalid time (25:00:00)', () => {
        expect(isValidISODateTimeString('2024-07-15T25:00:00Z')).toBe(false);
      });

      it('should return false for invalid minutes (14:60:00)', () => {
        expect(isValidISODateTimeString('2024-07-15T14:60:00Z')).toBe(false);
      });

      it('should return false for invalid seconds (14:30:60)', () => {
        expect(isValidISODateTimeString('2024-07-15T14:30:60Z')).toBe(false);
      });

      it('should return false for empty string', () => {
        expect(isValidISODateTimeString('')).toBe(false);
      });

      it('should return false for random string', () => {
        expect(isValidISODateTimeString('not a datetime')).toBe(false);
      });

      it('should return a boolean type', () => {
        const result = isValidISODateTimeString('2024-07-15T14:30:00.000Z');
        expect(typeof result).toBe('boolean');
      });
    });

    describe('isValidHexColor', () => {
      // Valid cases - #RRGGBB format only (per implementation)
      it('should return true for valid #RRGGBB format', () => {
        expect(isValidHexColor('#ff0000')).toBe(true);
        expect(isValidHexColor('#00ff00')).toBe(true);
        expect(isValidHexColor('#0000ff')).toBe(true);
        expect(isValidHexColor('#ffffff')).toBe(true);
        expect(isValidHexColor('#000000')).toBe(true);
      });

      it('should be case-insensitive', () => {
        expect(isValidHexColor('#FF0000')).toBe(true);
        expect(isValidHexColor('#Ff0000')).toBe(true);
        expect(isValidHexColor('#fF0000')).toBe(true);
      });

      it('should return true for typical UI colors', () => {
        expect(isValidHexColor('#ef4444')).toBe(true); // Red
        expect(isValidHexColor('#3b82f6')).toBe(true); // Blue
        expect(isValidHexColor('#22c55e')).toBe(true); // Green
      });

      // Invalid cases
      it('should return false for #RGB format (3 chars)', () => {
        expect(isValidHexColor('#f00')).toBe(false);
        expect(isValidHexColor('#abc')).toBe(false);
      });

      it('should return false for #RRGGBBAA format (8 chars)', () => {
        expect(isValidHexColor('#ff0000ff')).toBe(false);
        expect(isValidHexColor('#00000080')).toBe(false);
      });

      it('should return false for missing hash', () => {
        expect(isValidHexColor('ff0000')).toBe(false);
        expect(isValidHexColor('ffffff')).toBe(false);
      });

      it('should return false for invalid characters', () => {
        expect(isValidHexColor('#gggggg')).toBe(false);
        expect(isValidHexColor('#zzzzzz')).toBe(false);
        expect(isValidHexColor('#12345g')).toBe(false);
      });

      it('should return false for wrong length', () => {
        expect(isValidHexColor('#fff00')).toBe(false); // 5 chars
        expect(isValidHexColor('#fff0000')).toBe(false); // 7 chars
      });

      it('should return false for empty string', () => {
        expect(isValidHexColor('')).toBe(false);
      });

      it('should return false for hash only', () => {
        expect(isValidHexColor('#')).toBe(false);
      });

      it('should return false for color names', () => {
        expect(isValidHexColor('red')).toBe(false);
        expect(isValidHexColor('blue')).toBe(false);
      });

      it('should return false for rgb() format', () => {
        expect(isValidHexColor('rgb(255, 0, 0)')).toBe(false);
      });

      it('should return a boolean type', () => {
        const result = isValidHexColor('#ff0000');
        expect(typeof result).toBe('boolean');
      });
    });
  });

  // ==========================================================================
  // Parsing Functions Tests
  // ==========================================================================

  describe('Parsing Functions', () => {
    describe('parseISODateString', () => {
      // Valid cases
      it('should return Date for valid YYYY-MM-DD input', () => {
        const result = parseISODateString('2024-07-15');

        expect(result).toBeInstanceOf(Date);
        expect(result).not.toBeNull();
      });

      it('should set time to midnight UTC', () => {
        const result = parseISODateString('2024-07-15');

        expect(result?.toISOString()).toBe('2024-07-15T00:00:00.000Z');
      });

      it('should correctly parse year, month, and day', () => {
        const result = parseISODateString('2024-07-15');

        expect(result?.getUTCFullYear()).toBe(2024);
        expect(result?.getUTCMonth()).toBe(6); // 0-indexed
        expect(result?.getUTCDate()).toBe(15);
      });

      it('should handle first day of year', () => {
        const result = parseISODateString('2024-01-01');

        expect(result?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
      });

      it('should handle last day of year', () => {
        const result = parseISODateString('2024-12-31');

        expect(result?.toISOString()).toBe('2024-12-31T00:00:00.000Z');
      });

      it('should handle leap year date', () => {
        const result = parseISODateString('2024-02-29');

        expect(result?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
      });

      // Invalid cases - format
      it('should return null for invalid format', () => {
        expect(parseISODateString('07-15-2024')).toBeNull();
        expect(parseISODateString('2024/07/15')).toBeNull();
        expect(parseISODateString('20240715')).toBeNull();
      });

      it('should return null for empty string', () => {
        expect(parseISODateString('')).toBeNull();
      });

      it('should return null for datetime string', () => {
        expect(parseISODateString('2024-07-15T14:30:00.000Z')).toBeNull();
      });

      // Invalid cases - date values
      it('should return null for invalid date values', () => {
        expect(parseISODateString('2024-13-01')).toBeNull(); // Invalid month
        expect(parseISODateString('2024-00-01')).toBeNull(); // Invalid month
        expect(parseISODateString('2024-01-32')).toBeNull(); // Invalid day
        expect(parseISODateString('2024-01-00')).toBeNull(); // Invalid day
      });

      it('should return null for invalid leap year date', () => {
        expect(parseISODateString('2023-02-29')).toBeNull();
      });

      it('should return null for Feb 30', () => {
        expect(parseISODateString('2024-02-30')).toBeNull();
      });

      it('should return null for Apr 31', () => {
        expect(parseISODateString('2024-04-31')).toBeNull();
      });

      // Edge cases
      it('should return null for string with extra characters', () => {
        expect(parseISODateString('2024-07-15extra')).toBeNull();
        expect(parseISODateString('extra2024-07-15')).toBeNull();
      });

      it('should return null for whitespace', () => {
        expect(parseISODateString('   ')).toBeNull();
        expect(parseISODateString(' 2024-07-15 ')).toBeNull();
      });
    });

    describe('parseISODateTimeString', () => {
      // Valid cases
      it('should return Date for valid ISO 8601 input', () => {
        const result = parseISODateTimeString('2024-07-15T14:30:00.000Z');

        expect(result).toBeInstanceOf(Date);
        expect(result).not.toBeNull();
      });

      it('should correctly parse the datetime', () => {
        const result = parseISODateTimeString('2024-07-15T14:30:00.000Z');

        expect(result?.getUTCFullYear()).toBe(2024);
        expect(result?.getUTCMonth()).toBe(6); // 0-indexed
        expect(result?.getUTCDate()).toBe(15);
        expect(result?.getUTCHours()).toBe(14);
        expect(result?.getUTCMinutes()).toBe(30);
        expect(result?.getUTCSeconds()).toBe(0);
      });

      it('should handle Z timezone correctly', () => {
        const result = parseISODateTimeString('2024-07-15T14:30:00Z');

        expect(result?.toISOString()).toBe('2024-07-15T14:30:00.000Z');
      });

      it('should handle positive timezone offset', () => {
        const result = parseISODateTimeString('2024-07-15T16:30:00+02:00');

        // +02:00 means 2 hours ahead of UTC, so UTC time is 14:30
        expect(result?.getUTCHours()).toBe(14);
        expect(result?.getUTCMinutes()).toBe(30);
      });

      it('should handle negative timezone offset', () => {
        const result = parseISODateTimeString('2024-07-15T09:30:00-05:00');

        // -05:00 means 5 hours behind UTC, so UTC time is 14:30
        expect(result?.getUTCHours()).toBe(14);
        expect(result?.getUTCMinutes()).toBe(30);
      });

      it('should handle datetime without milliseconds', () => {
        const result = parseISODateTimeString('2024-07-15T14:30:00Z');

        expect(result).not.toBeNull();
        expect(result?.getUTCMilliseconds()).toBe(0);
      });

      it('should handle datetime with milliseconds', () => {
        const result = parseISODateTimeString('2024-07-15T14:30:00.123Z');

        expect(result?.getUTCMilliseconds()).toBe(123);
      });

      // Invalid cases
      it('should return null for invalid input', () => {
        expect(parseISODateTimeString('invalid')).toBeNull();
        expect(parseISODateTimeString('')).toBeNull();
      });

      it('should return null for date-only string', () => {
        expect(parseISODateTimeString('2024-07-15')).toBeNull();
      });

      it('should return Date for datetime without timezone (implementation allows it)', () => {
        // The regex makes timezone optional: (?:Z|[+-]...)?$
        // Without timezone, JavaScript parses as local time
        const result = parseISODateTimeString('2024-07-15T14:30:00');
        expect(result).not.toBeNull();
        expect(result).toBeInstanceOf(Date);
      });

      it('should return null for invalid time values', () => {
        expect(parseISODateTimeString('2024-07-15T25:00:00Z')).toBeNull();
        expect(parseISODateTimeString('2024-07-15T14:60:00Z')).toBeNull();
      });
    });
  });

  // ==========================================================================
  // Database Helpers Tests
  // ==========================================================================

  describe('Database Helpers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe('createTimestamps', () => {
      it('should return object with createdAt and updatedAt', () => {
        const timestamps = createTimestamps();

        expect(timestamps).toHaveProperty('createdAt');
        expect(timestamps).toHaveProperty('updatedAt');
      });

      it('should set both timestamps to current time', () => {
        const testTime = new Date('2024-07-15T10:30:00.000Z').getTime();
        vi.setSystemTime(testTime);

        const timestamps = createTimestamps();

        expect(timestamps.createdAt).toBe(testTime);
        expect(timestamps.updatedAt).toBe(testTime);
      });

      it('should set createdAt and updatedAt to same value', () => {
        const timestamps = createTimestamps();

        expect(timestamps.createdAt).toBe(timestamps.updatedAt);
      });

      it('should return Unix timestamps as numbers', () => {
        const timestamps = createTimestamps();

        expect(typeof timestamps.createdAt).toBe('number');
        expect(typeof timestamps.updatedAt).toBe('number');
      });

      it('should return integer values', () => {
        const timestamps = createTimestamps();

        expect(Number.isInteger(timestamps.createdAt)).toBe(true);
        expect(Number.isInteger(timestamps.updatedAt)).toBe(true);
      });

      it('should return only createdAt and updatedAt keys', () => {
        const timestamps = createTimestamps();
        const keys = Object.keys(timestamps);

        expect(keys).toHaveLength(2);
        expect(keys).toContain('createdAt');
        expect(keys).toContain('updatedAt');
      });
    });

    describe('updateTimestamp', () => {
      it('should return object with updatedAt only', () => {
        const timestamp = updateTimestamp();

        expect(timestamp).toHaveProperty('updatedAt');
        expect(timestamp).not.toHaveProperty('createdAt');
      });

      it('should set updatedAt to current time', () => {
        const testTime = new Date('2024-07-15T10:30:00.000Z').getTime();
        vi.setSystemTime(testTime);

        const timestamp = updateTimestamp();

        expect(timestamp.updatedAt).toBe(testTime);
      });

      it('should return Unix timestamp as number', () => {
        const timestamp = updateTimestamp();

        expect(typeof timestamp.updatedAt).toBe('number');
      });

      it('should return integer value', () => {
        const timestamp = updateTimestamp();

        expect(Number.isInteger(timestamp.updatedAt)).toBe(true);
      });

      it('should return only updatedAt key', () => {
        const timestamp = updateTimestamp();
        const keys = Object.keys(timestamp);

        expect(keys).toHaveLength(1);
        expect(keys[0]).toBe('updatedAt');
      });

      it('should update when time advances', () => {
        vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
        const timestamp1 = updateTimestamp();

        vi.advanceTimersByTime(60000); // Advance 1 minute
        const timestamp2 = updateTimestamp();

        expect(timestamp2.updatedAt - timestamp1.updatedAt).toBe(60000);
      });
    });
  });
});
