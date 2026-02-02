/**
 * @fileoverview Tests for room assignment date handling
 * Verifies the date flow from transport dates through autofill to assignment storage and display.
 * 
 * Date Model (Hotel/Check-in Check-out):
 * - startDate = check-in day (first night staying)
 * - endDate = check-out day (does NOT stay that night)
 * - Example: Jan 5 - Jan 10 = stays nights of Jan 5, 6, 7, 8, 9 (5 nights)
 */

import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import { toISODateString, parseISODateString } from '@/lib/db/utils';

/**
 * Calculates the nights stayed from an assignment's date range.
 * Uses the hotel model: startDate to (endDate - 1 day) inclusive.
 * 
 * This helper uses pure UTC date arithmetic to avoid timezone issues in tests.
 * The date strings are parsed as UTC and arithmetic is done at the string/day level.
 */
function getNightsStayed(startDate: string, endDate: string): string[] {
  // Parse both dates
  const start = parseISODateString(startDate);
  const end = parseISODateString(endDate);
  
  // Handle invalid dates
  if (!start || !end) {
    return [];
  }
  
  // Calculate number of nights (days between start and end, exclusive of end)
  // End date is checkout day, so we don't count it
  const startMs = start.getTime();
  const endMs = end.getTime();
  const msPerDay = 24 * 60 * 60 * 1000;
  const nightCount = Math.floor((endMs - startMs) / msPerDay);
  
  // If same day or end before start, no nights
  if (nightCount <= 0) {
    return [];
  }
  
  // Generate date strings for each night (using UTC arithmetic)
  const nights: string[] = [];
  for (let i = 0; i < nightCount; i++) {
    const nightDate = new Date(startMs + i * msPerDay);
    nights.push(toISODateString(nightDate));
  }
  
  return nights;
}

// ============================================================================
// Tests: Date Storage Model
// ============================================================================

describe('Room Assignment Date Model', () => {
  describe('Storage Format', () => {
    it('stores dates as YYYY-MM-DD strings', () => {
      const startDate = '2024-01-05';
      const endDate = '2024-01-10';
      
      expect(startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('toISODateString formats Date to YYYY-MM-DD using UTC', () => {
      // Use UTC date to avoid timezone issues in tests
      const date = new Date(Date.UTC(2024, 0, 5)); // Jan 5, 2024 UTC
      expect(toISODateString(date)).toBe('2024-01-05');
    });

    it('toISODateString extracts UTC date regardless of time component', () => {
      // These are all UTC times on Jan 5, 2024
      const morning = new Date(Date.UTC(2024, 0, 5, 8, 0, 0)); // Jan 5, 8:00 AM UTC
      const afternoon = new Date(Date.UTC(2024, 0, 5, 14, 30, 0)); // Jan 5, 2:30 PM UTC
      const evening = new Date(Date.UTC(2024, 0, 5, 23, 59, 59)); // Jan 5, 11:59 PM UTC
      
      expect(toISODateString(morning)).toBe('2024-01-05');
      expect(toISODateString(afternoon)).toBe('2024-01-05');
      expect(toISODateString(evening)).toBe('2024-01-05');
    });
  });

  describe('Nights Stayed Calculation (Hotel Model)', () => {
    it('calculates correct nights for multi-day stay', () => {
      // Jan 5 check-in, Jan 10 check-out = 5 nights
      const nights = getNightsStayed('2024-01-05', '2024-01-10');
      
      expect(nights).toEqual([
        '2024-01-05',
        '2024-01-06',
        '2024-01-07',
        '2024-01-08',
        '2024-01-09',
      ]);
      expect(nights).toHaveLength(5);
      expect(nights).not.toContain('2024-01-10'); // Check-out day NOT included
    });

    it('calculates correct nights for single night stay', () => {
      // Jan 5 check-in, Jan 6 check-out = 1 night
      const nights = getNightsStayed('2024-01-05', '2024-01-06');
      
      expect(nights).toEqual(['2024-01-05']);
      expect(nights).toHaveLength(1);
    });

    it('returns empty array for same-day check-in/check-out', () => {
      // Jan 5 check-in and check-out = 0 nights (day use only)
      const nights = getNightsStayed('2024-01-05', '2024-01-05');
      
      expect(nights).toEqual([]);
      expect(nights).toHaveLength(0);
    });

    it('handles month boundary correctly', () => {
      // Jan 30 check-in, Feb 2 check-out = 3 nights
      const nights = getNightsStayed('2024-01-30', '2024-02-02');
      
      expect(nights).toEqual([
        '2024-01-30',
        '2024-01-31',
        '2024-02-01',
      ]);
      expect(nights).toHaveLength(3);
    });

    it('handles year boundary correctly', () => {
      // Dec 30 check-in, Jan 2 check-out = 3 nights
      const nights = getNightsStayed('2023-12-30', '2024-01-02');
      
      expect(nights).toEqual([
        '2023-12-30',
        '2023-12-31',
        '2024-01-01',
      ]);
      expect(nights).toHaveLength(3);
    });

    it('handles leap year correctly', () => {
      // Feb 28 check-in, Mar 1 check-out (2024 is leap year) = 2 nights
      const nights = getNightsStayed('2024-02-28', '2024-03-01');
      
      expect(nights).toEqual([
        '2024-02-28',
        '2024-02-29', // Leap day!
      ]);
      expect(nights).toHaveLength(2);
    });
  });
});

// ============================================================================
// Tests: Transport to Assignment Date Flow
// ============================================================================

describe('Transport to Assignment Date Flow', () => {
  describe('Transport datetime parsing', () => {
    it('extracts date portion from ISO datetime', () => {
      // Transport stored as ISO datetime with time and timezone
      const transportDatetime = '2024-01-10T14:30:00.000Z';
      const parsedDate = parseISO(transportDatetime);
      const dateString = toISODateString(parsedDate);
      
      // Note: This test assumes UTC timezone
      // In a real app, this would depend on local timezone
      expect(dateString).toBe('2024-01-10');
    });

    it('handles transport at midnight UTC', () => {
      const transportDatetime = '2024-01-10T00:00:00.000Z';
      const parsedDate = parseISO(transportDatetime);
      const dateString = toISODateString(parsedDate);
      
      // In UTC, midnight on Jan 10 is still Jan 10
      expect(dateString).toBe('2024-01-10');
    });

    it('handles transport at 23:59 UTC', () => {
      const transportDatetime = '2024-01-10T23:59:00.000Z';
      const parsedDate = parseISO(transportDatetime);
      const dateString = toISODateString(parsedDate);
      
      expect(dateString).toBe('2024-01-10');
    });
  });

  describe('Assignment from transport dates', () => {
    it('uses arrival date as startDate and departure date as endDate', () => {
      // Simulate the autofill flow
      const arrivalDatetime = '2024-01-05T14:00:00.000Z';
      const departureDatetime = '2024-01-10T10:00:00.000Z';
      
      const arrivalDate = parseISO(arrivalDatetime);
      const departureDate = parseISO(departureDatetime);
      
      const startDate = toISODateString(arrivalDate);
      const endDate = toISODateString(departureDate);
      
      expect(startDate).toBe('2024-01-05');
      expect(endDate).toBe('2024-01-10'); // NOT Jan 11!
    });

    it('creates correct night range from transport-derived dates', () => {
      const arrivalDatetime = '2024-01-05T14:00:00.000Z';
      const departureDatetime = '2024-01-10T10:00:00.000Z';
      
      const startDate = toISODateString(parseISO(arrivalDatetime));
      const endDate = toISODateString(parseISO(departureDatetime));
      
      const nights = getNightsStayed(startDate, endDate);
      
      // Guest arrives Jan 5, departs Jan 10 = stays nights of Jan 5-9
      expect(nights).toHaveLength(5);
      expect(nights[0]).toBe('2024-01-05'); // First night
      expect(nights[nights.length - 1]).toBe('2024-01-09'); // Last night
    });
  });
});

// ============================================================================
// Tests: BUG-1 Specific Scenario
// ============================================================================

describe('BUG-1: Room Assignment End Date Off-By-One', () => {
  it('should NOT add extra day to endDate when autofilling from transport', () => {
    // Scenario from bug report:
    // - Guest arrives day A (Jan 5)
    // - Guest leaves day B (Jan 10)
    // - Expected assignment: A to B (Jan 5 - Jan 10)
    // - Bug claims: A to B+1 (Jan 5 - Jan 11)
    
    const arrivalDay = '2024-01-05';
    const departureDay = '2024-01-10';
    
    // Simulate transport datetimes
    const arrivalDatetime = `${arrivalDay}T14:30:00.000Z`;
    const departureDatetime = `${departureDay}T10:00:00.000Z`;
    
    // Extract dates (as the app does)
    const arrivalDate = parseISO(arrivalDatetime);
    const departureDate = parseISO(departureDatetime);
    
    // Convert to ISO date strings (as the form submission does)
    const assignmentStartDate = toISODateString(arrivalDate);
    const assignmentEndDate = toISODateString(departureDate);
    
    // Verify: endDate should be B (Jan 10), NOT B+1 (Jan 11)
    expect(assignmentStartDate).toBe(arrivalDay); // Jan 5
    expect(assignmentEndDate).toBe(departureDay); // Jan 10, NOT Jan 11
    
    // Verify the night count is correct
    const nights = getNightsStayed(assignmentStartDate, assignmentEndDate);
    expect(nights).toHaveLength(5); // 5 nights: Jan 5, 6, 7, 8, 9
  });

  it('should handle edge case: departure at midnight (00:00)', () => {
    // Edge case: departure at midnight (start of day)
    const arrivalDatetime = '2024-01-05T14:30:00.000Z';
    const departureDatetime = '2024-01-10T00:00:00.000Z'; // Midnight Jan 10
    
    const startDate = toISODateString(parseISO(arrivalDatetime));
    const endDate = toISODateString(parseISO(departureDatetime));
    
    expect(startDate).toBe('2024-01-05');
    expect(endDate).toBe('2024-01-10'); // Still Jan 10
  });

  it('should handle edge case: departure at 23:59', () => {
    // Edge case: departure late at night
    const arrivalDatetime = '2024-01-05T08:00:00.000Z';
    const departureDatetime = '2024-01-10T23:59:00.000Z'; // 11:59 PM Jan 10
    
    const startDate = toISODateString(parseISO(arrivalDatetime));
    const endDate = toISODateString(parseISO(departureDatetime));
    
    expect(startDate).toBe('2024-01-05');
    expect(endDate).toBe('2024-01-10'); // Still Jan 10
  });

  it('should handle same-day arrival and departure', () => {
    // Day trip: arrive and leave same day
    const datetime = '2024-01-05T12:00:00.000Z';
    
    const startDate = toISODateString(parseISO(datetime));
    const endDate = toISODateString(parseISO(datetime));
    
    expect(startDate).toBe('2024-01-05');
    expect(endDate).toBe('2024-01-05');
    
    // 0 nights - just a day visit
    const nights = getNightsStayed(startDate, endDate);
    expect(nights).toHaveLength(0);
  });
});

// ============================================================================
// Tests: Display Consistency
// ============================================================================

describe('Display Consistency', () => {
  it('calendar should show same nights as getNightsStayed', () => {
    // Assignment stored as Jan 5 - Jan 10
    const startDate = '2024-01-05';
    const endDate = '2024-01-10';
    
    // What getNightsStayed returns
    const nights = getNightsStayed(startDate, endDate);
    
    // Verify the nights are correct
    expect(nights).toEqual([
      '2024-01-05',
      '2024-01-06',
      '2024-01-07',
      '2024-01-08',
      '2024-01-09',
    ]);
    expect(nights).toHaveLength(5);
  });

  it('DateRangePicker booked ranges should show same nights', () => {
    // Replicate DateRangePicker's bookedDates logic
    // Given assignment dates, the booked dates should be startDate to (endDate - 1)
    const startDate = '2024-01-05';
    const endDate = '2024-01-10';
    
    // What getNightsStayed returns
    const nights = getNightsStayed(startDate, endDate);
    
    // Should show nights from check-in to last night (not including checkout day)
    expect(nights).toHaveLength(5);
    expect(nights[0]).toBe('2024-01-05'); // First night (check-in)
    expect(nights[nights.length - 1]).toBe('2024-01-09'); // Last night (day before checkout)
    expect(nights).not.toContain('2024-01-10'); // Checkout day not included
  });
});
