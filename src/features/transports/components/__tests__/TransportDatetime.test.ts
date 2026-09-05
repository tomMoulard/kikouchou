/**
 * @fileoverview Regression tests for transport datetime handling.
 *
 * BUG-2: a transport must display the time that was entered, whatever timezone
 * the viewer is in.
 *
 * Datetime flow:
 * 1. The user enters a wall clock in the form's `datetime-local` input.
 * 2. `toISODatetime` reads it as local time and stores the UTC instant.
 * 3. `formatTransportDatetimeParts` renders that instant back in local time.
 * 4. `formatDatetimeLocal` feeds it back into the input for edit mode.
 *
 * Every function under test here is the **shipped** one. This file used to
 * declare private copies of all three and assert those, so reintroducing the
 * UTC-slicing bug in the app left the whole file green — a regression guard
 * that exercises its own reimplementation guards nothing. The two form-side
 * conversions now live in `features/transports/utils/datetime-input`, which
 * exists so they cannot be duplicated by accident again.
 *
 * Fixtures are built with `new Date(y, m, d, h, min)` rather than written as
 * literal UTC strings: a local constructor pins the *wall clock*, which reads
 * the same in every timezone, so nothing here encodes the machine's offset.
 * The one place the offset is unavoidable — telling a correct local rendering
 * apart from a naive UTC slice — is guarded explicitly and explained there.
 */

import { describe, it, expect } from 'vitest';

import {
  formatDatetimeLocal,
  toISODatetime,
} from '@/features/transports/utils/datetime-input';
import { formatTransportDatetimeParts } from '@/lib/utils/datetime-format';

// ============================================================================
// Helpers
// ============================================================================

/**
 * The UTC instant of a local wall clock, the way the form stores one.
 *
 * @param year - Full year
 * @param month - 1-based month
 * @param day - Day of month
 * @param hours - Local hour
 * @param minutes - Local minute
 * @returns The stored ISO instant
 */
function storedInstantOf(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
): string {
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

/**
 * The time as the app actually renders it: the shipped single renderer, in its
 * `timeOnly` variant. Every surface showing a bare clock goes through this.
 *
 * @param datetime - ISO datetime string (a UTC instant)
 * @returns Time string in HH:mm, in the viewer's timezone
 */
function formatTime(datetime: string): string {
  return formatTransportDatetimeParts(datetime, undefined, 'timeOnly').time;
}

/**
 * BUG-2 itself: the original renderer, which sliced the characters after the
 * `T` out of the stored UTC string and called that the time.
 *
 * @param datetime - ISO datetime string
 * @returns The UTC time, whatever timezone the viewer is in
 */
function formatTimeUTCBuggy(datetime: string): string {
  const timePart = datetime.split('T')[1];
  if (!timePart) return '';
  return timePart.substring(0, 5);
}

/** Whether the machine running these tests is offset from UTC. */
const HAS_UTC_OFFSET = new Date().getTimezoneOffset() !== 0;

// ============================================================================
// Tests: Datetime Storage and Retrieval
// ============================================================================

describe('Transport Datetime Handling', () => {
  describe('Form input to storage (toISODatetime)', () => {
    it('stores the UTC instant of the wall clock the user typed', () => {
      // The user types 14:30 on 10 January 2024 into a datetime-local input,
      // which has no offset and therefore means 14:30 where they are standing.
      expect(toISODatetime('2024-01-10T14:30')).toBe(
        storedInstantOf(2024, 1, 10, 14, 30),
      );
    });

    it('stores midnight and the last minute of the day', () => {
      expect(toISODatetime('2024-01-10T00:00')).toBe(
        storedInstantOf(2024, 1, 10, 0, 0),
      );
      expect(toISODatetime('2024-01-10T23:59')).toBe(
        storedInstantOf(2024, 1, 10, 23, 59),
      );
    });

    it('returns an empty string for empty input', () => {
      expect(toISODatetime('')).toBe('');
    });

    it('returns an empty string for unparseable input', () => {
      expect(toISODatetime('invalid')).toBe('');
      expect(toISODatetime('not-a-date')).toBe('');
      expect(toISODatetime('2024-13-45T99:99')).toBe('');
    });
  });

  describe('Storage to form input (formatDatetimeLocal)', () => {
    it('renders the stored instant as the local wall clock', () => {
      expect(formatDatetimeLocal(storedInstantOf(2024, 1, 10, 14, 30))).toBe(
        '2024-01-10T14:30',
      );
    });

    it('renders an instant that falls on another UTC day', () => {
      // 23:30 local is the previous or next UTC day in most of the world, so a
      // renderer that trusted the stored string's date half would slip a day.
      expect(formatDatetimeLocal(storedInstantOf(2024, 6, 30, 23, 30))).toBe(
        '2024-06-30T23:30',
      );
      expect(formatDatetimeLocal(storedInstantOf(2024, 6, 30, 0, 30))).toBe(
        '2024-06-30T00:30',
      );
    });

    it('returns an empty string for empty input', () => {
      expect(formatDatetimeLocal('')).toBe('');
    });

    it('returns an empty string for unparseable input', () => {
      expect(formatDatetimeLocal('invalid')).toBe('');
    });
  });

  describe('Round-trip consistency', () => {
    it('local → ISO → local preserves the original wall clock', () => {
      const originalInput = '2024-01-10T14:30';

      expect(formatDatetimeLocal(toISODatetime(originalInput))).toBe(
        originalInput,
      );
    });

    it('preserves the wall clock across the whole day', () => {
      const times = [
        '2024-01-10T00:00', // Midnight
        '2024-01-10T06:30', // Early morning
        '2024-01-10T12:00', // Noon
        '2024-01-10T18:45', // Evening
        '2024-01-10T23:59', // Late night
      ];

      for (const originalTime of times) {
        expect(formatDatetimeLocal(toISODatetime(originalTime))).toBe(
          originalTime,
        );
      }
    });
  });
});

// ============================================================================
// Tests: Display (BUG-2)
// ============================================================================

describe('BUG-2: Transport Time Display', () => {
  describe('the shipped renderer', () => {
    it('renders the stored instant as the local wall clock', () => {
      expect(formatTime(storedInstantOf(2024, 1, 10, 14, 30))).toBe('14:30');
    });

    it('renders an empty time for empty input', () => {
      expect(formatTime('')).toBe('');
    });

    it('renders an empty time for unparseable input', () => {
      expect(formatTime('invalid')).toBe('');
    });
  });

  describe('consistency with the form', () => {
    it('displays the time the user entered', () => {
      const userEnteredTime = '2024-06-15T14:30';

      expect(formatTime(toISODatetime(userEnteredTime))).toBe('14:30');
    });

    it('works for times throughout the day', () => {
      const testCases = [
        { input: '2024-06-15T00:00', expectedTime: '00:00' },
        { input: '2024-06-15T06:30', expectedTime: '06:30' },
        { input: '2024-06-15T12:00', expectedTime: '12:00' },
        { input: '2024-06-15T18:45', expectedTime: '18:45' },
        { input: '2024-06-15T23:59', expectedTime: '23:59' },
      ];

      for (const { input, expectedTime } of testCases) {
        expect(formatTime(toISODatetime(input))).toBe(expectedTime);
      }
    });
  });

  describe('versus the UTC-slicing bug', () => {
    /**
     * The assertion that actually fails if BUG-2 comes back.
     *
     * A stored instant only differs from its local wall clock when the viewer
     * is offset from UTC, so under `TZ=UTC` a correct renderer and a
     * character-slicing one are indistinguishable *by construction* — nothing
     * written here can change that. The suite is therefore run under
     * `Pacific/Kiritimati` (UTC+14) and `Pacific/Midway` (UTC-11) as well, and
     * the divergence half of this test only asserts where an offset exists.
     */
    it('renders local time where slicing the stored string would not', () => {
      const stored = storedInstantOf(2024, 1, 10, 14, 30);

      // The shipped renderer gives back the wall clock that was entered.
      expect(formatTime(stored)).toBe('14:30');

      if (HAS_UTC_OFFSET) {
        // The bug gives back the UTC clock, which is a different time.
        expect(formatTimeUTCBuggy(stored)).not.toBe('14:30');
        expect(formatTimeUTCBuggy(stored)).not.toBe(formatTime(stored));
      } else {
        // Under UTC the two agree; that is the whole reason for the matrix.
        expect(formatTimeUTCBuggy(stored)).toBe(formatTime(stored));
      }
    });

    it('renders the day the viewer experiences, not the stored UTC day', () => {
      // 23:30 local on 30 June: UTC has already rolled over east of Greenwich
      // and has not reached it yet to the west, so a renderer reading the
      // stored string's date half shows the wrong day for most of the planet.
      const { date, time } = formatTransportDatetimeParts(
        storedInstantOf(2024, 6, 30, 23, 30),
        undefined,
        'dayAndTime',
      );

      expect(time).toBe('23:30');
      expect(date).toBe('Sun 30 Jun');
    });
  });
});

// ============================================================================
// Tests: Edge Cases
// ============================================================================

describe('Datetime Edge Cases', () => {
  describe('Date boundaries', () => {
    it('handles midnight correctly', () => {
      expect(formatTime(toISODatetime('2024-01-10T00:00'))).toBe('00:00');
    });

    it('handles 23:59 correctly', () => {
      expect(formatTime(toISODatetime('2024-01-10T23:59'))).toBe('23:59');
    });
  });

  describe('Year boundaries', () => {
    it('handles New Year Eve correctly', () => {
      expect(formatTime(toISODatetime('2024-12-31T23:30'))).toBe('23:30');
    });

    it('handles New Year Day correctly', () => {
      expect(formatTime(toISODatetime('2025-01-01T00:30'))).toBe('00:30');
    });
  });

  describe('DST transitions', () => {
    it('handles the spring-forward date correctly', () => {
      // 2024-03-10 is the US spring-forward day, where 02:00-03:00 local time
      // DOES NOT EXIST: `new Date('2024-03-10T02:30')` normalises to 03:30, so
      // asserting a 02:30 round-trip only held in zones that shift on another
      // date (Europe shifts on the 31st). 04:30 exists everywhere on that date
      // and still exercises the transition day.
      expect(formatTime(toISODatetime('2024-03-10T04:30'))).toBe('04:30');
    });

    it('handles the fall-back date correctly', () => {
      // November: the repeated hour in the Northern Hemisphere. 01:30 is
      // ambiguous where it falls back, and `Date` resolves it to the first of
      // the two — a round trip has to land back on the same wall clock either
      // way.
      expect(formatTime(toISODatetime('2024-11-03T01:30'))).toBe('01:30');
    });
  });
});
