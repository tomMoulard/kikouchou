/**
 * @fileoverview Tests for the spend chart's bucketing.
 * @module features/analytics/lib/__tests__/spend-timeline.test
 */

import { describe, expect, it } from 'vitest';

import { buildSpendTimeline } from '@/features/analytics/lib/spend-timeline';
import type { Expense, ExpenseKind, ISODateString, TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP = 'trip-a' as TripId;

let counter = 0;

function line(
  date: string,
  amount: number,
  kind: ExpenseKind = 'expense',
): Expense {
  counter += 1;
  return {
    id: `exp-${counter}`,
    tripId: TRIP,
    kind,
    category: 'other',
    title: `line ${counter}`,
    date: date as ISODateString,
    amount,
    payerId: 'person-1',
    splitMode: 'equal',
    splits: [],
  } as unknown as Expense;
}

/** Adds `days` to a `YYYY-MM-DD` key without touching the machine's offset. */
function plusDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

// ============================================================================
// Tests
// ============================================================================

describe('buildSpendTimeline', () => {
  it('returns null when nothing is dated', () => {
    expect(buildSpendTimeline([])).toBeNull();
    expect(buildSpendTimeline([line('', 20)])).toBeNull();
  });

  it('puts one bar on each day of the span, gaps included', () => {
    const timeline = buildSpendTimeline([
      line('2026-07-01', 100),
      line('2026-07-04', 40),
    ]);

    expect(timeline).not.toBeNull();
    expect(timeline?.unit).toBe('day');
    expect(timeline?.buckets.map((bucket) => bucket.amount)).toEqual([
      100, 0, 0, 40,
    ]);
    expect(timeline?.buckets[0]?.start).toBe('2026-07-01');
    expect(timeline?.buckets[3]?.end).toBe('2026-07-04');
  });

  it('sums a day and nets an income off it', () => {
    const timeline = buildSpendTimeline([
      line('2026-07-01', 100),
      line('2026-07-01', 20),
      line('2026-07-01', 30, 'income'),
    ]);

    expect(timeline?.buckets).toHaveLength(1);
    expect(timeline?.buckets[0]?.amount).toBe(90);
    expect(timeline?.total).toBe(90);
  });

  it('leaves a transfer out, as the Spent card does', () => {
    const timeline = buildSpendTimeline([
      line('2026-07-01', 100),
      line('2026-07-02', 60, 'transfer'),
    ]);

    expect(timeline?.total).toBe(100);
    // And it does not stretch the axis either: a settling payment on the last
    // day would otherwise add a day of "spending" worth nothing.
    expect(timeline?.buckets).toHaveLength(1);
  });

  it('adds up to the same total whatever the bar width', () => {
    const lines = Array.from({ length: 90 }, (_, index) =>
      line(plusDays('2026-01-01', index), 10.01),
    );

    const timeline = buildSpendTimeline(lines);

    // Cents, not floats: ninety additions of 10.01 drift as doubles.
    expect(timeline?.total).toBe(900.9);
  });

  it('widens the bars rather than drawing more of them', () => {
    const day = buildSpendTimeline([
      line('2026-01-01', 10),
      line(plusDays('2026-01-01', 20), 10),
    ]);
    const week = buildSpendTimeline([
      line('2026-01-01', 10),
      line(plusDays('2026-01-01', 60), 10),
    ]);
    const month = buildSpendTimeline([
      line('2026-01-01', 10),
      line(plusDays('2026-01-01', 400), 10),
    ]);

    expect(day?.unit).toBe('day');
    expect(week?.unit).toBe('week');
    expect(month?.unit).toBe('month');
    for (const timeline of [day, week, month]) {
      expect(timeline?.buckets.length).toBeLessThanOrEqual(32);
      expect(timeline?.total).toBe(20);
    }
  });

  it('reports the tallest bar and the deepest refund', () => {
    const timeline = buildSpendTimeline([
      line('2026-07-01', 100),
      line('2026-07-02', 250),
      line('2026-07-03', 40, 'income'),
    ]);

    expect(timeline?.peak).toBe(250);
    expect(timeline?.trough).toBe(40);
  });

  it('reports no refund when every bar is spending', () => {
    const timeline = buildSpendTimeline([line('2026-07-01', 100)]);

    expect(timeline?.trough).toBe(0);
  });
});
