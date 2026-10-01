/**
 * @fileoverview Unit tests for the canonical date display helpers.
 *
 * Every expectation here is offset-independent: `parseISO` yields local
 * midnight and `format` reads local components, so a `YYYY-MM-DD` input always
 * prints the day it names, whatever the machine's timezone.
 *
 * @module lib/utils/__tests__/date-format.test
 */

import { describe, it, expect } from 'vitest';
import { enUS, fr } from 'date-fns/locale';

import { formatDateRange, formatFullDate } from '../date-format';

// ============================================================================
// formatDateRange
// ============================================================================

describe('formatDateRange', () => {
  it('collapses a one-day range to a single date', () => {
    expect(formatDateRange('2024-07-15', '2024-07-15', enUS)).toBe('15 Jul 2024');
  });

  it('prints the month and year once for a same-month range', () => {
    expect(formatDateRange('2024-07-15', '2024-07-22', enUS)).toBe('15 - 22 Jul 2024');
  });

  it('prints both months but one year for a same-year range', () => {
    expect(formatDateRange('2024-07-28', '2024-08-05', enUS)).toBe('28 Jul - 5 Aug 2024');
  });

  it('prints both years for a range that crosses new year', () => {
    expect(formatDateRange('2024-12-28', '2025-01-05', enUS)).toBe(
      '28 Dec 2024 - 5 Jan 2025',
    );
  });

  it('uses French month names under the French locale', () => {
    expect(formatDateRange('2024-07-28', '2024-08-05', fr)).toBe(
      '28 juil. - 5 août 2024',
    );
  });

  it('echoes the raw input back when the start date is unparseable', () => {
    expect(formatDateRange('nope', '2024-07-22', enUS)).toBe('nope - 2024-07-22');
  });

  it('echoes the raw input back when both dates are unparseable', () => {
    expect(formatDateRange('bad', 'dates', enUS)).toBe('bad - dates');
  });

  it('does not throw when a stored row is missing its dates', () => {
    // `parseISO` calls `.split()` on its argument, so a missing field would
    // take down the whole trip list rather than render as text.
    const missing = undefined as unknown as string;

    expect(formatDateRange(missing, '2024-07-22', enUS)).toBe(
      'undefined - 2024-07-22',
    );
  });

  it('reads the local day, not the UTC one, from a plain date key', () => {
    // `new Date('2026-08-01')` is UTC midnight and renders as 31 July at any
    // negative offset. The day printed must match the day in the string.
    expect(formatDateRange('2026-08-01', '2026-08-01', enUS)).toBe('1 Aug 2026');
  });
});

// ============================================================================
// formatFullDate
// ============================================================================

describe('formatFullDate', () => {
  it('renders an English header with weekday, month and year', () => {
    expect(formatFullDate('2026-01-05', enUS)).toBe('Monday, January 5th, 2026');
  });

  it('renders a French header in French word order, without English commas', () => {
    const header = formatFullDate('2026-01-05', fr);

    expect(header).toBe('lundi 5 janvier 2026');
  });

  it('returns the raw key when it cannot be parsed', () => {
    expect(formatFullDate('nope', enUS)).toBe('nope');
  });
});
