/**
 * @fileoverview One amount divided by weights, to the cent.
 *
 * Every split on the money page is the same arithmetic with different weights:
 * one part each for an equal split, the parts somebody typed for a share split,
 * each guest's person nights for a night split. This is that arithmetic, once.
 *
 * It runs in cents. Money in a float drifts — `0.1 + 0.2` is not `0.3` — and
 * three equal shares of 100 rounded on their own add up to 99.99, which is the
 * kind of missing cent that makes a group re-count everything by hand. Cents are
 * integers, and the cents that rounding leaves over are handed out one by one,
 * largest remainder first, so the shares always add back up to the amount.
 *
 * @module features/money/lib/weighted-split
 */

// ============================================================================
// Split
// ============================================================================

/**
 * Divides one amount in proportion to a list of weights.
 *
 * @param weights - One weight per share, in the order the shares are wanted.
 *   A negative or non-finite weight counts as zero.
 * @param amount - The amount to divide, in any single currency
 * @returns One amount per weight, in the same order, adding up exactly to
 *   `amount`. Every share is zero when the amount is not a positive, finite
 *   number, or when every weight is zero.
 *
 * @example
 * ```ts
 * splitAmountByWeights([1, 5, 3], 100); // [11.11, 55.56, 33.33]
 * ```
 */
export function splitAmountByWeights(
  weights: readonly number[],
  amount: number,
): number[] {
  const nothing = weights.map(() => 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    return nothing;
  }

  const usable = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0,
  );

  let totalWeight = 0;
  for (const weight of usable) {
    totalWeight += weight;
  }
  if (totalWeight <= 0) {
    return nothing;
  }

  const totalCents = Math.round(amount * 100);
  if (totalCents <= 0) {
    return nothing;
  }

  // Everybody's floor first, then the leftover cents to the rows the floor cut
  // the most. This is the largest remainder method, and it is what makes the
  // shares add back up to the amount.
  const floored = usable.map((weight, index) => {
    const exact = (totalCents * weight) / totalWeight;
    const cents = Math.floor(exact);
    return { index, cents, remainder: exact - cents };
  });

  let handedOut = 0;
  for (const row of floored) {
    handedOut += row.cents;
  }

  const byRemainder = [...floored].sort(
    (left, right) => right.remainder - left.remainder || left.index - right.index,
  );
  // One cent each to the most-cut rows. There are fewer leftover cents than
  // rows, because each row was cut by less than a cent.
  const leftover = totalCents - handedOut;
  for (let taken = 0; taken < leftover; taken += 1) {
    const row = byRemainder[taken % byRemainder.length];
    if (row !== undefined) {
      row.cents += 1;
    }
  }

  return floored.map((row) => row.cents / 100);
}

/**
 * Rounds one amount of money to the cent.
 *
 * Used wherever a figure the user typed meets a figure this module computed, so
 * the two are compared and displayed on the same grid.
 *
 * @param amount - Any finite amount
 * @returns The amount rounded to two decimals, or 0 when it is not finite
 */
export function roundToCents(amount: number): number {
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.round(amount * 100) / 100;
}
