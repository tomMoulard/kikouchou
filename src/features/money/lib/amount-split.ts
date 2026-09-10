/**
 * @fileoverview One bill divided by the person nights, to the cent.
 *
 * The rule the group agrees on out loud is "pay for the nights you slept
 * there", and that is the only rule here: each guest row owes the bill times
 * its person nights over the trip's person nights.
 *
 * The arithmetic runs in cents. Money in a float drifts — `0.1 + 0.2` is not
 * `0.3` — and three equal shares of 100 rounded on their own add up to 99.99,
 * which is the kind of missing cent that makes a group re-count everything by
 * hand. Cents are integers, and the cents that rounding leaves over are handed
 * out one by one, largest remainder first, so the shares always add back up to
 * the bill.
 *
 * @module features/money/lib/amount-split
 */

import type { NightSplitGuest } from '@/features/money/lib/night-split';
import type { PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * What one guest row owes.
 */
export interface AmountShare {
  /** The guest row this amount belongs to. */
  readonly personId: PersonId;
  /**
   * The amount owed, in the currency the caller typed, rounded to the cent.
   *
   * Zero when there is nothing to divide or no night to divide it by.
   */
  readonly amount: number;
}

// ============================================================================
// Split
// ============================================================================

/**
 * Divides one bill between the guests, in proportion to their person nights.
 *
 * @param guests - The guest rows and their person nights
 * @param amount - The bill to divide, in any single currency
 * @returns One share per guest, in the order the guests were given. Every share
 *   is zero when the bill is not a positive, finite number, or when nobody slept
 *   a single night.
 *
 * @example
 * ```ts
 * splitAmountByPersonNights(guests, 800); // [{ amount: 600 }, { amount: 200 }]
 * ```
 */
export function splitAmountByPersonNights(
  guests: readonly NightSplitGuest[],
  amount: number,
): readonly AmountShare[] {
  const nothing = guests.map((guest) => ({ personId: guest.personId, amount: 0 }));

  if (!Number.isFinite(amount) || amount <= 0) {
    return nothing;
  }

  let totalPersonNights = 0;
  for (const guest of guests) {
    totalPersonNights += guest.personNights;
  }
  if (totalPersonNights <= 0) {
    return nothing;
  }

  const totalCents = Math.round(amount * 100);
  if (totalCents <= 0) {
    return nothing;
  }

  // Everybody's floor first, then the leftover cents to the rows the floor cut
  // the most. This is the largest remainder method, and it is what makes the
  // shares add back up to the bill.
  const floored = guests.map((guest, index) => {
    const exact = (totalCents * guest.personNights) / totalPersonNights;
    const cents = Math.floor(exact);
    return { index, personId: guest.personId, cents, remainder: exact - cents };
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

  return floored.map((row) => ({
    personId: row.personId,
    amount: row.cents / 100,
  }));
}
