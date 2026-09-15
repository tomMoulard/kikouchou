/**
 * @fileoverview One amount divided by weights, to the cent.
 * @module features/money/lib/__tests__/weighted-split.test
 */

import { describe, expect, it } from 'vitest';

import { roundToCents, splitAmountByWeights } from '@/features/money/lib/weighted-split';

// ============================================================================
// Tests
// ============================================================================

describe('splitAmountByWeights', () => {
  it('divides in proportion to the weights', () => {
    expect(splitAmountByWeights([6, 2], 800)).toEqual([600, 200]);
  });

  it('hands out the leftover cents so the shares add up to the amount', () => {
    const shares = splitAmountByWeights([1, 1, 1], 100);

    expect(shares).toEqual([33.34, 33.33, 33.33]);
    expect(shares.reduce((total, share) => total + share, 0)).toBeCloseTo(100, 10);
  });

  it('splits the example from the brief: one, five and three parts of 100', () => {
    expect(splitAmountByWeights([1, 5, 3], 100)).toEqual([11.11, 55.56, 33.33]);
  });

  it('gives every share to the only positive weight', () => {
    expect(splitAmountByWeights([0, 4, 0], 90)).toEqual([0, 90, 0]);
  });

  it('answers zero when nothing carries a weight', () => {
    expect(splitAmountByWeights([0, 0], 800)).toEqual([0, 0]);
  });

  it('answers zero for an amount that is not a positive, finite number', () => {
    for (const amount of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(splitAmountByWeights([4, 1], amount)).toEqual([0, 0]);
    }
  });

  it('counts a negative or non-finite weight as no weight at all', () => {
    expect(splitAmountByWeights([-5, 1, Number.NaN], 10)).toEqual([0, 10, 0]);
  });

  it('keeps a half cent from disappearing between two shares', () => {
    const shares = splitAmountByWeights([1, 1], 10.005);

    expect(shares.reduce((total, share) => total + share, 0)).toBeCloseTo(10.01, 10);
  });

  it('returns one share per weight, empty included', () => {
    expect(splitAmountByWeights([], 100)).toEqual([]);
  });
});

describe('roundToCents', () => {
  it('rounds to two decimals', () => {
    expect(roundToCents(10.005)).toBe(10.01);
    expect(roundToCents(1 / 3)).toBe(0.33);
  });

  it('answers zero for a value that is not finite', () => {
    expect(roundToCents(Number.NaN)).toBe(0);
  });
});
