/**
 * @fileoverview Tests for dividing one bill by the person nights.
 * @module features/money/lib/__tests__/amount-split.test
 */

import { describe, expect, it } from 'vitest';

import { splitAmountByPersonNights } from '@/features/money/lib/amount-split';
import type { NightSplitGuest } from '@/features/money/lib/night-split';
import type { PersonId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

function guest(id: string, personNights: number): NightSplitGuest {
  return {
    personId: id as PersonId,
    name: id,
    headcount: 1,
    nights: personNights,
    personNights,
    share: 0,
  };
}

/** The amounts alone, in the order the guests were given. */
function amounts(rows: readonly { readonly amount: number }[]): readonly number[] {
  return rows.map((row) => row.amount);
}

// ============================================================================
// Tests
// ============================================================================

describe('splitAmountByPersonNights', () => {
  it('divides in proportion to the person nights', () => {
    const rows = splitAmountByPersonNights([guest('a', 6), guest('b', 2)], 800);

    expect(amounts(rows)).toEqual([600, 200]);
  });

  it('gives every cent of the bill to somebody', () => {
    // 100 / 3 is 33.333…, and three rounded shares add up to 99.99. The lost
    // cent has to land on a row rather than nowhere.
    const rows = splitAmountByPersonNights(
      [guest('a', 1), guest('b', 1), guest('c', 1)],
      100,
    );

    expect(amounts(rows).reduce((total, amount) => total + amount, 0)).toBe(100);
    expect(amounts(rows)).toEqual([33.34, 33.33, 33.33]);
  });

  it('rounds the bill to the cent before it divides', () => {
    const rows = splitAmountByPersonNights([guest('a', 1), guest('b', 1)], 10.005);

    expect(amounts(rows).reduce((total, amount) => total + amount, 0)).toBe(10.01);
  });

  it('charges nobody when nobody slept there', () => {
    const rows = splitAmountByPersonNights([guest('a', 0), guest('b', 0)], 800);

    expect(amounts(rows)).toEqual([0, 0]);
  });

  it('charges nobody for a bill of nothing', () => {
    const rows = splitAmountByPersonNights([guest('a', 4), guest('b', 2)], 0);

    expect(amounts(rows)).toEqual([0, 0]);
  });

  it('refuses a bill that is not a number it can divide', () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, -50]) {
      expect(amounts(splitAmountByPersonNights([guest('a', 4)], amount))).toEqual([0]);
    }
  });

  it('keeps each guest with their own amount', () => {
    const rows = splitAmountByPersonNights([guest('a', 3), guest('b', 1)], 400);

    expect(rows).toEqual([
      { personId: 'a', amount: 300 },
      { personId: 'b', amount: 100 },
    ]);
  });
});
