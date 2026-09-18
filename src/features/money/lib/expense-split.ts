/**
 * @fileoverview What each guest owes on one money line.
 *
 * A line says how much moved and who it was for; the split mode says how to
 * divide it. All four modes end in the same weighted division (`./weighted-split`),
 * so the shares of any line always add back up to its amount, to the cent:
 *
 * - `equal` — one part each;
 * - `shares` — the parts somebody typed;
 * - `nights` — each guest's person nights on this trip;
 * - `amounts` — the figures themselves, kept as typed.
 *
 * `amounts` is the one mode that does not divide anything, and it is still
 * bounded here rather than trusted: the form makes the figures add up, and a
 * line arriving from a peer does not have to. When they do not add up, they are
 * treated as weights on the line's amount, which keeps the page's one invariant
 * — every line's shares add up to its amount — true for every line the group can
 * see, however it was written.
 *
 * @module features/money/lib/expense-split
 */

import { splitAmountByWeights } from '@/features/money/lib/weighted-split';
import type { Expense, ExpenseSplit, PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * What one guest owes on one line.
 */
export interface ExpenseShare {
  /** The guest this share belongs to. */
  readonly personId: PersonId;
  /** The amount owed, rounded to the cent. */
  readonly amount: number;
}

/**
 * What the `nights` split mode needs to know about the trip.
 *
 * Passed in rather than read here: the counts come from the stays
 * (`./night-split`), and a division that went to the database on its own could
 * not be run over a line the caller is still typing.
 */
export type PersonNightCounts = ReadonlyMap<PersonId, number>;

// ============================================================================
// Split
// ============================================================================

/**
 * Divides one money line between the guests it was for.
 *
 * @param expense - The line, or the fields of one being typed
 * @param personNights - Each guest's person nights, for the `nights` mode. A
 *   guest missing from the map counts as zero nights.
 * @returns One share per split entry, in the order the line lists them. Every
 *   share is zero when the line has no amount, no beneficiary, or no weight to
 *   divide by — a night split of a line whose guests all slept elsewhere, for
 *   instance.
 *
 * @example
 * ```ts
 * // A paid 100 for A, B and C, in parts 1 / 5 / 3
 * computeExpenseShares(expense, nights); // 11.11, 55.56, 33.33
 * ```
 */
export function computeExpenseShares(
  expense: Pick<Expense, 'amount' | 'splitMode' | 'splits'>,
  personNights: PersonNightCounts = new Map(),
): ExpenseShare[] {
  const splits = expense.splits ?? [];
  const weights = splits.map((split) => weightOf(split, expense.splitMode, personNights));

  const amounts = splitAmountByWeights(weights, expense.amount);

  return splits.map((split, index) => ({
    personId: split.personId,
    amount: amounts[index] ?? 0,
  }));
}

/**
 * The weight one share carries under a given split mode.
 *
 * @param split - The share as it was written down
 * @param mode - The line's split mode
 * @param personNights - Each guest's person nights
 * @returns A weight, never negative
 */
function weightOf(
  split: ExpenseSplit,
  mode: Expense['splitMode'],
  personNights: PersonNightCounts,
): number {
  switch (mode) {
    case 'equal':
      return 1;
    case 'nights':
      return personNights.get(split.personId) ?? 0;
    case 'shares':
    case 'amounts':
      return Number.isFinite(split.value) && split.value > 0 ? split.value : 0;
  }
}

/**
 * Whether a line moves money at all.
 *
 * A line with no amount or nobody to divide it between leaves every balance
 * where it was, and the money page says so rather than showing a row of zeroes.
 *
 * @param expense - The line to check
 * @returns True when the line changes somebody's balance
 */
export function movesMoney(
  expense: Pick<Expense, 'amount' | 'splits'>,
): boolean {
  return expense.amount > 0 && (expense.splits?.length ?? 0) > 0;
}
