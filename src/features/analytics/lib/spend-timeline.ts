/**
 * @fileoverview Turns a trip's money lines into a series a chart can draw.
 *
 * The analytics page already says what the trip cost; it could not say *when*
 * the money went. One total hides a deposit paid in March and a fortnight of
 * daily groceries behind the same figure.
 *
 * Two rules are inherited from `trip-stats` rather than reinvented, so the bars
 * always add up to the "Spent" card above them: an income counts against the
 * spend, and a transfer counts for nothing, because a guest paying another back
 * moves the group's own money without the group spending any.
 *
 * @module features/analytics/lib/spend-timeline
 */

import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

import { toLocalISODateString } from '@/lib/db/utils';
import type { Expense, ISODateString } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** How wide one bar is. */
export type SpendBucketUnit = 'day' | 'week' | 'month';

/** One bar: what the trip spent over one stretch of the calendar. */
export interface SpendBucket {
  /** First day the bar covers. */
  readonly start: ISODateString;
  /** Last day the bar covers, inclusive. */
  readonly end: ISODateString;
  /**
   * Net spend over those days — expenses less incomes.
   *
   * Can be negative: a refund landing on a day nothing was bought gives money
   * back, and hiding that would make the bars stop adding up to the total.
   */
  readonly amount: number;
}

/** Everything the chart needs, already bucketed. */
export interface SpendTimeline {
  /** How wide each bar is, so the chart can label the axis honestly. */
  readonly unit: SpendBucketUnit;
  /** The bars, in calendar order, gaps included as zeros. */
  readonly buckets: readonly SpendBucket[];
  /** The largest bar, as a distance from zero — never below zero. */
  readonly peak: number;
  /** The most money any single bucket gave back, as a positive number. */
  readonly trough: number;
  /** Every bucket added up: the same figure as `TripStats.spendTotal`. */
  readonly total: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * How many bars the chart is allowed to draw.
 *
 * A phone gives the chart about 320 device pixels of width, so past this the
 * bars are thinner than the gaps between them and the shape stops being
 * readable. The bucket unit widens instead of the bar count growing.
 */
const MAX_BUCKETS = 32;

/** Monday. A week of a trip reads as Monday to Sunday in both locales. */
const WEEK_STARTS_ON = 1;

// ============================================================================
// Bucketing
// ============================================================================

/**
 * Picks the bar width that keeps the whole span under {@link MAX_BUCKETS}.
 *
 * @param dayCount - Days from the first money line to the last, inclusive.
 * @returns The widest bar the span needs.
 */
function chooseUnit(dayCount: number): SpendBucketUnit {
  if (dayCount <= MAX_BUCKETS) {
    return 'day';
  }
  if (dayCount <= MAX_BUCKETS * 7) {
    return 'week';
  }
  return 'month';
}

/**
 * Moves a date to the first day of the bucket it falls in.
 *
 * @param date - Any day inside the bucket.
 * @param unit - The bar width.
 * @returns The bucket's first day.
 */
function toBucketStart(date: Date, unit: SpendBucketUnit): Date {
  if (unit === 'week') {
    return startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON });
  }
  if (unit === 'month') {
    return startOfMonth(date);
  }
  return date;
}

/**
 * Steps to the first day of the next bucket.
 *
 * @param date - A bucket's first day.
 * @param unit - The bar width.
 * @returns The next bucket's first day.
 */
function toNextBucketStart(date: Date, unit: SpendBucketUnit): Date {
  if (unit === 'week') {
    return addWeeks(date, 1);
  }
  if (unit === 'month') {
    return addMonths(date, 1);
  }
  return addDays(date, 1);
}

// ============================================================================
// Build
// ============================================================================

/**
 * Buckets a trip's money lines into the bars of the spend chart.
 *
 * Empty stretches are kept as zero-height bars rather than dropped, so the
 * horizontal axis is time and not "days that happen to have a receipt": a week
 * where nobody spent anything is a fact about the trip, and closing the gap
 * would draw it as a week of spending.
 *
 * Arithmetic runs in cents. Summing a page of euro amounts as floats drifts,
 * and this total sits directly under a "Spent" card the reader compares it to.
 *
 * @param expenses - Every money line of one trip, in any order.
 * @returns The bars, or `null` when no line has a usable date.
 *
 * @example
 * ```ts
 * const timeline = buildSpendTimeline(expenses);
 * timeline?.unit;            // 'day' for a fortnight, 'week' for a season
 * timeline?.buckets.length;  // never more than 32
 * ```
 */
export function buildSpendTimeline(
  expenses: readonly Expense[],
): SpendTimeline | null {
  // Cents per calendar day, keyed on the day the payer remembers.
  const centsByDay = new Map<string, number>();

  for (const expense of expenses) {
    // A transfer is the group moving its own money: it belongs to nobody's
    // spending, exactly as in `loadTripStats`.
    if (expense.kind !== 'expense' && expense.kind !== 'income') {
      continue;
    }
    const day = expense.date;
    if (typeof day !== 'string' || day === '') {
      continue;
    }
    const parsed = parseISO(day);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }
    const cents = Math.round(expense.amount * 100);
    const signed = expense.kind === 'expense' ? cents : -cents;
    centsByDay.set(day, (centsByDay.get(day) ?? 0) + signed);
  }

  if (centsByDay.size === 0) {
    return null;
  }

  const days = [...centsByDay.keys()].sort();
  // Both ends exist: the map is not empty and the keys parsed above.
  const firstDay = parseISO(days[0]!);
  const lastDay = parseISO(days[days.length - 1]!);

  const unit = chooseUnit(differenceInCalendarDays(lastDay, firstDay) + 1);

  const buckets: SpendBucket[] = [];
  let peakCents = 0;
  let troughCents = 0;
  let totalCents = 0;

  let bucketStart = toBucketStart(firstDay, unit);
  while (bucketStart.getTime() <= lastDay.getTime()) {
    const nextStart = toNextBucketStart(bucketStart, unit);
    const end = addDays(nextStart, -1);

    let cents = 0;
    for (
      let day = bucketStart;
      day.getTime() < nextStart.getTime();
      day = addDays(day, 1)
    ) {
      cents += centsByDay.get(toLocalISODateString(day)) ?? 0;
    }

    buckets.push({
      start: toLocalISODateString(bucketStart),
      end: toLocalISODateString(end),
      amount: cents / 100,
    });

    peakCents = Math.max(peakCents, cents);
    troughCents = Math.max(troughCents, -cents);
    totalCents += cents;
    bucketStart = nextStart;
  }

  return {
    unit,
    buckets,
    peak: peakCents / 100,
    trough: troughCents / 100,
    total: totalCents / 100,
  };
}
