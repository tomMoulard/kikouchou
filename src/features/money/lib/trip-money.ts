/**
 * @fileoverview Everything the money page reads, in one pass.
 *
 * The page shows three things that all rest on the same rows — the lines of the
 * accounts, the balance they add up to, and the nights a line can be split by —
 * so they are read together rather than in three live queries that would each
 * re-run on any write and disagree with each other in between.
 *
 * Like `loadTripNightSplit`, the read is keyed on the trip id in the URL rather
 * than on `currentTrip`, which lags the URL during a trip switch.
 *
 * @module features/money/lib/trip-money
 */

import { loadTripNightSplit } from '@/features/money/lib/night-split';
import type { TripNightSplit } from '@/features/money/lib/night-split';
import type { PersonNightCounts } from '@/features/money/lib/expense-split';
import { db } from '@/lib/db/database';
import { normalizeCurrency } from '@/types';
import type { CurrencyCode, Expense, Person, PersonId, TripId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The whole money page's data.
 */
export interface TripMoney {
  /** The night counts, and the trip they describe. */
  readonly split: TripNightSplit;
  /** Every money line of the trip, oldest day first. */
  readonly expenses: readonly Expense[];
  /** The trip's guests, for names, colours and the payer list. */
  readonly persons: readonly Person[];
  /** Each guest's person nights, ready for a line split by nights. */
  readonly personNights: PersonNightCounts;
  /** The currency every amount is in, as the trip declares it. */
  readonly currency: CurrencyCode;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Upper bound for a string component of a compound index range.
 * Matches the bound the other trip reads use, so the ranges select the same rows.
 */
const MAX_STRING_KEY = '￿';

// ============================================================================
// Reads
// ============================================================================

/**
 * Reads one trip's accounts.
 *
 * @param tripId - The trip to read, taken from the URL
 * @returns The page's data, or `null` when no trip carries that id
 *
 * @example
 * ```ts
 * const money = await loadTripMoney(tripId);
 * money?.expenses.length; // how many lines the group has entered
 * ```
 */
export async function loadTripMoney(tripId: TripId): Promise<TripMoney | null> {
  const split = await loadTripNightSplit(tripId);
  if (split === null) {
    return null;
  }

  const [trip, expenses, persons] = await Promise.all([
    db.trips.get(tripId),
    db.expenses
      .where('[tripId+date]')
      .between([tripId, ''], [tripId, MAX_STRING_KEY])
      .toArray(),
    db.persons
      .where('[tripId+name]')
      .between([tripId, ''], [tripId, MAX_STRING_KEY])
      .toArray(),
  ]);

  const personNights = new Map<PersonId, number>(
    split.guests.map((guest) => [guest.personId, guest.personNights]),
  );

  return {
    split,
    // Newest first: the line somebody wants to check is the one just entered.
    expenses: [...expenses].sort(
      (left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id),
    ),
    persons,
    personNights,
    currency: normalizeCurrency(trip?.currency),
  };
}
