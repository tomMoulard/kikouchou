/**
 * @fileoverview Tests for the spend-over-time line.
 * @module features/analytics/components/__tests__/SpendTimelineChart.test
 */

import { describe, expect, it } from 'vitest';

import { render, screen } from '@/test/utils';
import { SpendTimelineChart } from '@/features/analytics/components/SpendTimelineChart';
import { buildSpendTimeline } from '@/features/analytics/lib/spend-timeline';
import type { Expense, ExpenseKind, ISODateString, TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP = 'trip-a' as TripId;

let counter = 0;

function line(date: string, amount: number, kind: ExpenseKind = 'expense'): Expense {
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

const formatMoney = (amount: number): string => `${amount.toFixed(2)} EUR`;

function renderChart(expenses: readonly Expense[]): void {
  const timeline = buildSpendTimeline(expenses);
  if (timeline === null) {
    throw new Error('fixture has no dated money line');
  }
  render(<SpendTimelineChart timeline={timeline} formatMoney={formatMoney} />);
}

/** The line's points, as `[x, y]` pairs read back off the path. */
function linePoints(): readonly (readonly [number, number])[] {
  const path = screen.getByTestId('spend-timeline-line').getAttribute('d') ?? '';
  return [...path.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map(
    (match) => [Number(match[1]), Number(match[2])] as const,
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('SpendTimelineChart', () => {
  it('draws one line through one point per bucket, gaps included', () => {
    renderChart([line('2026-07-01', 100), line('2026-07-04', 40)]);

    expect(screen.getAllByTestId('spend-timeline-point')).toHaveLength(4);
    expect(linePoints()).toHaveLength(4);
  });

  it('climbs with what the trip has cost so far, not with the day alone', () => {
    renderChart([
      line('2026-07-01', 100),
      line('2026-07-02', 25),
      line('2026-07-03', 25),
    ]);

    const totals = screen
      .getAllByTestId('spend-timeline-point')
      .map((point) => point.getAttribute('data-bucket-total'));

    expect(totals).toEqual(['100', '125', '150']);

    // A running total never falls while money is going out, so the line only
    // ever goes up — y counts downwards in the drawing.
    const ys = linePoints().map(([, y]) => y);
    expect(ys[0]).toBeGreaterThan(ys[1]!);
    expect(ys[1]).toBeGreaterThan(ys[2]!);
  });

  it('dips when money comes back', () => {
    renderChart([
      line('2026-07-01', 100),
      line('2026-07-02', 40, 'income'),
    ]);

    const ys = linePoints().map(([, y]) => y);
    expect(ys[1]).toBeGreaterThan(ys[0]!);
  });

  it('ends on the very figure the Spent card prints', () => {
    renderChart([line('2026-07-01', 10.01), line('2026-07-02', 20.02)]);

    const points = screen.getAllByTestId('spend-timeline-point');
    expect(points[points.length - 1]?.getAttribute('data-bucket-total')).toBe(
      '30.03',
    );
  });

  it('tells each point what its own bucket cost and what it came to', () => {
    renderChart([line('2026-07-01', 100), line('2026-07-02', 25)]);

    const [, second] = screen.getAllByTestId('spend-timeline-point');

    // The tooltip itself is a `t()` call, which the harness echoes back as its
    // key; the values it is given are what this asserts.
    expect(second?.getAttribute('data-bucket-start')).toBe('2026-07-02');
    expect(second?.getAttribute('data-bucket-amount')).toBe('25');
    expect(second?.getAttribute('data-bucket-total')).toBe('125');
  });

  it('carries the same numbers in a table a screen reader can walk', () => {
    renderChart([line('2026-07-01', 100), line('2026-07-02', 25)]);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      '100.00 EUR',
      '100.00 EUR',
      '25.00 EUR',
      '125.00 EUR',
    ]);
  });

  it('names the step so a season is not read as a fortnight', () => {
    renderChart([line('2026-01-01', 10), line('2026-06-01', 10)]);

    expect(screen.getByTestId('spend-timeline-unit').textContent).toContain(
      'analytics.spendTimelineCaption',
    );
  });

  it('puts a lone point in the middle rather than in a corner', () => {
    renderChart([line('2026-07-01', 100)]);

    expect(linePoints()).toEqual([[500, 120]]);
  });
});
