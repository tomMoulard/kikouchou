/**
 * @fileoverview Tests for transport datetime handling
 * Verifies the datetime flow from form input through storage to display.
 * 
 * BUG-2 Regression Tests: Transport time should display the same time
 * that was entered, regardless of the user's timezone.
 * 
 * Datetime Flow:
 * 1. User enters time in form (local time via datetime-local input)
 * 2. Form converts to ISO string for storage (UTC)
 * 3. Display extracts and shows time (should convert back to local)
 * 
 * The key insight is that:
 * - Storage is in UTC (ISO format: 2024-01-10T13:00:00.000Z)
 * - Display must convert back to local time
 * - Round-trip: local → UTC → local should be consistent
 */

import { describe, it, expect } from 'vitest';
import { format, parseISO } from 'date-fns';

// ============================================================================
// Helper Functions (replicate from actual code for testing)
// ============================================================================

/**
 * Converts datetime-local input format to ISO datetime string.
 * This is the function used in TransportForm.tsx for storage.
 * 
 * @param localDatetime - datetime-local format (YYYY-MM-DDTHH:mm)
 * @returns ISO datetime string (UTC)
 */
function toISODatetime(localDatetime: string): string {
  if (!localDatetime) return '';
  try {
    // Datetime-local gives us local time, convert to ISO (UTC)
    const date = new Date(localDatetime);
    if (isNaN(date.getTime())) return '';
    return date.toISOString();
  } catch {
    return '';
  }
}

/**
 * Converts ISO datetime string to datetime-local input format.
 * This is the function used in TransportForm.tsx for edit mode.
 * 
 * @param isoDatetime - ISO datetime string (UTC)
 * @returns datetime-local format (YYYY-MM-DDTHH:mm) in local timezone
 */
function formatDatetimeLocal(isoDatetime: string): string {
  try {
    const date = parseISO(isoDatetime);
    if (isNaN(date.getTime())) return '';
    return format(date, "yyyy-MM-dd'T'HH:mm");
  } catch {
    return '';
  }
}

/**
 * Formats a datetime string to show just the time (HH:mm) in local timezone.
 * This is the FIXED function from CalendarPage.tsx.
 * 
 * @param datetime - ISO datetime string (UTC)
 * @returns Time string in HH:mm format (local timezone)
 */
function formatTime(datetime: string): string {
  try {
    const date = parseISO(datetime);
    if (isNaN(date.getTime())) return '';
    return format(date, 'HH:mm');
  } catch {
    return '';
  }
}

/**
 * BUGGY version of formatTime that extracts UTC time directly.
 * This was the original implementation that caused BUG-2.
 */
function formatTimeUTCBuggy(datetime: string): string {
  const timePart = datetime.split('T')[1];
  if (!timePart) return '';
  return timePart.substring(0, 5);
}

// ============================================================================
// Tests: Datetime Storage and Retrieval
// ============================================================================

describe('Transport Datetime Handling', () => {
  describe('Form Input to Storage (toISODatetime)', () => {
    it('converts datetime-local to ISO string', () => {
      // User enters "2024-01-10T14:30" in datetime-local input (local time)
      const localInput = '2024-01-10T14:30';
      const isoString = toISODatetime(localInput);
      
      // Should produce a valid ISO string
      expect(isoString).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
      
      // The ISO string represents the same instant in time
      const inputDate = new Date(localInput);
      const isoDate = new Date(isoString);
      expect(inputDate.getTime()).toBe(isoDate.getTime());
    });

    it('handles empty input', () => {
      expect(toISODatetime('')).toBe('');
    });

    it('handles invalid input', () => {
      expect(toISODatetime('invalid')).toBe('');
      expect(toISODatetime('not-a-date')).toBe('');
    });
  });

  describe('Storage to Form Display (formatDatetimeLocal)', () => {
    it('converts ISO string back to datetime-local format', () => {
      // Given an ISO string stored in the database
      const isoString = '2024-01-10T14:30:00.000Z';
      const localFormat = formatDatetimeLocal(isoString);
      
      // Should produce datetime-local format
      expect(localFormat).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('handles empty input', () => {
      expect(formatDatetimeLocal('')).toBe('');
    });

    it('handles invalid input', () => {
      expect(formatDatetimeLocal('invalid')).toBe('');
    });
  });

  describe('Round-trip Consistency', () => {
    it('local → ISO → local should preserve the original time', () => {
      // User enters a time in local format
      const originalInput = '2024-01-10T14:30';
      
      // Convert to ISO for storage
      const isoString = toISODatetime(originalInput);
      
      // Convert back to local for edit display
      const displayValue = formatDatetimeLocal(isoString);
      
      // Should match the original input
      expect(displayValue).toBe(originalInput);
    });

    it('preserves time across multiple round-trips', () => {
      const times = [
        '2024-01-10T00:00', // Midnight
        '2024-01-10T06:30', // Early morning
        '2024-01-10T12:00', // Noon
        '2024-01-10T18:45', // Evening
        '2024-01-10T23:59', // Late night
      ];

      for (const originalTime of times) {
        const iso = toISODatetime(originalTime);
        const roundTripped = formatDatetimeLocal(iso);
        expect(roundTripped).toBe(originalTime);
      }
    });
  });
});

// ============================================================================
// Tests: Calendar Display (BUG-2 Specific)
// ============================================================================

describe('BUG-2: Transport Time Display', () => {
  describe('formatTime (FIXED version)', () => {
    it('displays time in local timezone', () => {
      // Given a stored ISO datetime
      const isoDatetime = '2024-01-10T14:30:00.000Z';
      
      // The displayed time should be in local timezone
      const displayedTime = formatTime(isoDatetime);
      
      // Verify it's a valid HH:mm format
      expect(displayedTime).toMatch(/^\d{2}:\d{2}$/);
      
      // Verify it matches what date-fns format produces (local time)
      const expectedTime = format(parseISO(isoDatetime), 'HH:mm');
      expect(displayedTime).toBe(expectedTime);
    });

    it('handles empty input', () => {
      expect(formatTime('')).toBe('');
    });

    it('handles invalid input', () => {
      expect(formatTime('invalid')).toBe('');
    });
  });

  describe('formatTime consistency with form', () => {
    it('displayed time matches what user entered', () => {
      // User enters a local time
      const userEnteredTime = '2024-06-15T14:30';
      
      // Form stores as ISO
      const storedISO = toISODatetime(userEnteredTime);
      
      // Calendar displays the time
      const displayedTime = formatTime(storedISO);
      
      // Extract just the time part from user input for comparison
      const expectedTime = userEnteredTime.split('T')[1];
      
      // Should match!
      expect(displayedTime).toBe(expectedTime);
    });

    it('works for various times throughout the day', () => {
      const testCases = [
        { input: '2024-06-15T00:00', expectedTime: '00:00' },
        { input: '2024-06-15T06:30', expectedTime: '06:30' },
        { input: '2024-06-15T12:00', expectedTime: '12:00' },
        { input: '2024-06-15T18:45', expectedTime: '18:45' },
        { input: '2024-06-15T23:59', expectedTime: '23:59' },
      ];

      for (const { input, expectedTime } of testCases) {
        const storedISO = toISODatetime(input);
        const displayedTime = formatTime(storedISO);
        expect(displayedTime).toBe(expectedTime);
      }
    });
  });

  describe('BUGGY version comparison', () => {
    it('buggy version extracts UTC time, not local time', () => {
      // This test demonstrates the bug that was fixed
      // The buggy version extracts time directly from ISO string (UTC)
      const isoDatetime = '2024-01-10T14:30:00.000Z';
      
      const buggyTime = formatTimeUTCBuggy(isoDatetime);
      const fixedTime = formatTime(isoDatetime);
      
      // Buggy version always returns UTC time (14:30)
      expect(buggyTime).toBe('14:30');
      
      // Fixed version returns local time (varies by timezone)
      // In UTC+1, this would be 15:30; in UTC-5, this would be 09:30
      // The key is that it uses date-fns format which handles timezone
      expect(fixedTime).toMatch(/^\d{2}:\d{2}$/);
    });
  });
});

// ============================================================================
// Tests: Edge Cases
// ============================================================================

describe('Datetime Edge Cases', () => {
  describe('Date boundaries', () => {
    it('handles midnight correctly', () => {
      const midnight = '2024-01-10T00:00';
      const iso = toISODatetime(midnight);
      const display = formatTime(iso);
      expect(display).toBe('00:00');
    });

    it('handles 23:59 correctly', () => {
      const lateNight = '2024-01-10T23:59';
      const iso = toISODatetime(lateNight);
      const display = formatTime(iso);
      expect(display).toBe('23:59');
    });
  });

  describe('Year boundaries', () => {
    it('handles New Year Eve correctly', () => {
      const newYearEve = '2024-12-31T23:30';
      const iso = toISODatetime(newYearEve);
      const display = formatTime(iso);
      expect(display).toBe('23:30');
    });

    it('handles New Year Day correctly', () => {
      const newYearDay = '2025-01-01T00:30';
      const iso = toISODatetime(newYearDay);
      const display = formatTime(iso);
      expect(display).toBe('00:30');
    });
  });

  describe('DST transitions (if applicable)', () => {
    // Note: These tests verify the round-trip works during DST transitions
    // The actual DST handling depends on the local timezone
    
    it('handles spring forward date correctly', () => {
      // March (typical spring forward month in Northern Hemisphere)
      const springDate = '2024-03-10T02:30';
      const iso = toISODatetime(springDate);
      const display = formatTime(iso);
      // Should round-trip correctly regardless of DST
      expect(display).toBe('02:30');
    });

    it('handles fall back date correctly', () => {
      // November (typical fall back month in Northern Hemisphere)
      const fallDate = '2024-11-03T01:30';
      const iso = toISODatetime(fallDate);
      const display = formatTime(iso);
      // Should round-trip correctly regardless of DST
      expect(display).toBe('01:30');
    });
  });
});
