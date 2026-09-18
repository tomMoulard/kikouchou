/**
 * @fileoverview What each guest owes on one money line, under each split rule.
 * @module features/money/lib/__tests__/expense-split.test
 */

import { describe, expect, it } from 'vitest';

import { computeExpenseShares, movesMoney } from '@/features/money/lib/expense-split';
import type { Expense, ExpenseSplitMode, PersonId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const ALICE = 'alice' as PersonId;
const BOB = 'bob' as PersonId;
const CLAIRE = 'claire' as PersonId;

function line(
  splitMode: ExpenseSplitMode,
  amount: number,
  splits: readonly { personId: PersonId; value: number }[],
): Pick<Expense, 'amount' | 'splitMode' | 'splits'> {
  return { amount, splitMode, splits: [...splits] };
}

const NIGHTS = new Map<PersonId, number>([
  [ALICE, 6],
  [BOB, 2],
  [CLAIRE, 0],
]);

function amounts(
  shares: readonly { readonly amount: number }[],
): readonly number[] {
  return shares.map((share) => share.amount);
}

// ============================================================================
// Tests
// ============================================================================

describe('computeExpenseShares', () => {
  it('gives one share each under the equal rule, whatever the values say', () => {
    const shares = computeExpenseShares(
      line('equal', 90, [
        { personId: ALICE, value: 7 },
        { personId: BOB, value: 0 },
        { personId: CLAIRE, value: 1 },
      ]),
    );

    expect(amounts(shares)).toEqual([30, 30, 30]);
  });

  it('divides by the parts under the shares rule', () => {
    // The example from the brief: A paid 100 for A, B and C in parts 1, 5, 3.
    const shares = computeExpenseShares(
      line('shares', 100, [
        { personId: ALICE, value: 1 },
        { personId: BOB, value: 5 },
        { personId: CLAIRE, value: 3 },
      ]),
    );

    expect(amounts(shares)).toEqual([11.11, 55.56, 33.33]);
  });

  it('divides by the person nights under the nights rule', () => {
    const shares = computeExpenseShares(
      line('nights', 800, [
        { personId: ALICE, value: 1 },
        { personId: BOB, value: 1 },
      ]),
      NIGHTS,
    );

    expect(amounts(shares)).toEqual([600, 200]);
  });

  it('keeps the typed figures under the amounts rule when they add up', () => {
    const shares = computeExpenseShares(
      line('amounts', 100, [
        { personId: ALICE, value: 70 },
        { personId: BOB, value: 30 },
      ]),
    );

    expect(amounts(shares)).toEqual([70, 30]);
  });

  it('scales typed figures that do not add up, so the line still totals its amount', () => {
    // A line from a peer that no form checked. Treating the figures as weights
    // keeps the page's one invariant true rather than showing a line whose
    // shares contradict its own amount.
    const shares = computeExpenseShares(
      line('amounts', 100, [
        { personId: ALICE, value: 30 },
        { personId: BOB, value: 10 },
      ]),
    );

    expect(amounts(shares)).toEqual([75, 25]);
  });

  it('answers zero for everybody when nobody slept a night', () => {
    const shares = computeExpenseShares(
      line('nights', 500, [{ personId: CLAIRE, value: 1 }]),
      NIGHTS,
    );

    expect(amounts(shares)).toEqual([0]);
  });

  it('answers nothing at all when the line is for nobody', () => {
    expect(computeExpenseShares(line('equal', 500, []))).toEqual([]);
  });

  it('counts a guest missing from the night counts as no nights', () => {
    const shares = computeExpenseShares(
      line('nights', 100, [
        { personId: ALICE, value: 1 },
        { personId: 'nobody' as PersonId, value: 1 },
      ]),
      NIGHTS,
    );

    expect(amounts(shares)).toEqual([100, 0]);
  });
});

describe('movesMoney', () => {
  it('is true for a line with an amount and somebody to divide it between', () => {
    expect(movesMoney({ amount: 10, splits: [{ personId: ALICE, value: 1 }] })).toBe(true);
  });

  it('is false for a line with no amount or nobody it was for', () => {
    expect(movesMoney({ amount: 0, splits: [{ personId: ALICE, value: 1 }] })).toBe(false);
    expect(movesMoney({ amount: 10, splits: [] })).toBe(false);
  });
});
