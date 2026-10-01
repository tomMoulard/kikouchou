/**
 * @fileoverview Tests for calendar utility functions.
 *
 * @module features/calendar/utils/__tests__/calendar-utils.test
 */

import { describe, it, expect } from 'vitest';

import type { HexColor } from '@/types';
import {
  getLuminance,
  getContrastTextColor,
  getSegmentBorderRadiusClasses,
  formatTime,
  EMPTY_EVENTS,
  EMPTY_TRANSPORTS,
  MAX_VISIBLE_EVENT_SLOTS,
} from '../calendar-utils';

// ============================================================================
// Constants
// ============================================================================

describe('Constants', () => {
  it('EMPTY_EVENTS is a frozen empty array', () => {
    expect(EMPTY_EVENTS).toEqual([]);
    expect(EMPTY_EVENTS.length).toBe(0);
  });

  it('EMPTY_TRANSPORTS is a frozen empty array', () => {
    expect(EMPTY_TRANSPORTS).toEqual([]);
    expect(EMPTY_TRANSPORTS.length).toBe(0);
  });

  it('MAX_VISIBLE_EVENT_SLOTS is 3', () => {
    expect(MAX_VISIBLE_EVENT_SLOTS).toBe(3);
  });
});

// ============================================================================
// getLuminance
// ============================================================================

describe('getLuminance', () => {
  it('returns 0 for black (#000000)', () => {
    expect(getLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('returns 1 for white (#ffffff)', () => {
    expect(getLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('handles shorthand hex (#fff)', () => {
    expect(getLuminance('#fff')).toBeCloseTo(1, 5);
  });

  it('handles shorthand hex without # (000)', () => {
    expect(getLuminance('000')).toBeCloseTo(0, 5);
  });

  it('handles hex without # prefix', () => {
    expect(getLuminance('ffffff')).toBeCloseTo(1, 5);
  });

  it('returns 0.5 for invalid hex', () => {
    expect(getLuminance('xyz')).toBe(0.5);
    expect(getLuminance('#gg0000')).toBe(0.5);
    expect(getLuminance('')).toBe(0.5);
  });

  it('calculates luminance for mid-range colors', () => {
    // Pure red: luminance ~0.2126
    const redLuminance = getLuminance('#ff0000');
    expect(redLuminance).toBeGreaterThan(0.1);
    expect(redLuminance).toBeLessThan(0.3);

    // Pure green: luminance ~0.7152
    const greenLuminance = getLuminance('#00ff00');
    expect(greenLuminance).toBeGreaterThan(0.6);
    expect(greenLuminance).toBeLessThan(0.8);

    // Pure blue: luminance ~0.0722
    const blueLuminance = getLuminance('#0000ff');
    expect(blueLuminance).toBeGreaterThan(0.01);
    expect(blueLuminance).toBeLessThan(0.1);
  });
});

// ============================================================================
// getContrastTextColor
// ============================================================================

describe('getContrastTextColor', () => {
  it('returns white for dark backgrounds', () => {
    expect(getContrastTextColor('#000000' as HexColor)).toBe('white');
    expect(getContrastTextColor('#1a1a1a' as HexColor)).toBe('white');
    expect(getContrastTextColor('#0000ff' as HexColor)).toBe('white');
  });

  it('returns black for light backgrounds', () => {
    expect(getContrastTextColor('#ffffff' as HexColor)).toBe('black');
    expect(getContrastTextColor('#ffff00' as HexColor)).toBe('black');
    expect(getContrastTextColor('#00ff00' as HexColor)).toBe('black');
  });
});

// ============================================================================
// getSegmentBorderRadiusClasses
// ============================================================================

describe('getSegmentBorderRadiusClasses', () => {
  it('returns "rounded" for single-day events', () => {
    expect(getSegmentBorderRadiusClasses('single', false, false)).toBe('rounded');
    expect(getSegmentBorderRadiusClasses('single', true, true)).toBe('rounded');
  });

  it('returns "rounded-l" for start segment (not at row end)', () => {
    expect(getSegmentBorderRadiusClasses('start', false, false)).toBe('rounded-l');
  });

  it('returns "rounded-r" for end segment (not at row start)', () => {
    expect(getSegmentBorderRadiusClasses('end', false, false)).toBe('rounded-r');
  });

  it('returns "rounded-none" for middle segment', () => {
    expect(getSegmentBorderRadiusClasses('middle', false, false)).toBe('rounded-none');
  });

  it('returns "rounded" for start + row end', () => {
    expect(getSegmentBorderRadiusClasses('start', false, true)).toBe('rounded');
  });

  it('returns "rounded" for end + row start', () => {
    expect(getSegmentBorderRadiusClasses('end', true, false)).toBe('rounded');
  });

  it('returns "rounded-l" for middle at row start', () => {
    expect(getSegmentBorderRadiusClasses('middle', true, false)).toBe('rounded-l');
  });

  it('returns "rounded-r" for middle at row end', () => {
    expect(getSegmentBorderRadiusClasses('middle', false, true)).toBe('rounded-r');
  });

  it('returns "rounded" for middle at both row start and end', () => {
    expect(getSegmentBorderRadiusClasses('middle', true, true)).toBe('rounded');
  });
});

// ============================================================================
// formatTime
// ============================================================================

describe('formatTime', () => {
  it('formats an ISO datetime to HH:mm', () => {
    // Use a fixed local time (non-UTC to avoid timezone issues)
    const result = formatTime('2024-01-10T00:00:00');
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns empty string for invalid input', () => {
    expect(formatTime('not-a-date')).toBe('');
    expect(formatTime('')).toBe('');
  });
});

