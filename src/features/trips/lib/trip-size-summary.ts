/**
 * @fileoverview The arithmetic the create form used to leave to the user:
 * beds, guests and nights, and whether the beds run short.
 *
 * Three rooms of two, three and two beds is seven beds, and six guests fit in
 * them — but the form asked for all of it and added none of it up, so the one
 * question a host actually has ("does everybody have a bed?") was theirs to do
 * in their head, on a screen that already knew both numbers.
 *
 * Nights come from `listStayNights`, the single source of truth for the nights
 * model: a trip that starts and ends on the same day holds no night, and that
 * is a real trip rather than a data error.
 *
 * @module features/trips/lib/trip-size-summary
 */

import { listStayNights } from '@/features/rooms/utils/capacity-utils';
import { getPersonHeadcount } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** The three totals the create form shows under its room list. */
export interface TripSizeSummary {
  /** Beds across every named room. */
  readonly beds: number;
  /** People, not rows: a guest row can stand for a couple or a family. */
  readonly guests: number;
  /**
   * Nights the dates enclose, or null when they do not answer yet.
   *
   * Null covers a missing bound and an end before the start. Zero is an
   * answer: a start and an end on one day is a day out, and nobody sleeps
   * there.
   */
  readonly nights: number | null;
  /** True when there are fewer beds than guests to put in them. */
  readonly bedsShort: boolean;
}

/**
 * The part of i18next's `t` this module needs.
 *
 * Narrowed to one call shape so the formatter is a plain function the tests can
 * resolve against the real catalogues, rather than something only a rendered
 * component can exercise.
 */
export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

/** What the form holds when it asks for the totals. */
export interface TripSizeInput {
  /** The rooms the form will save — blank rows are already dropped. */
  readonly rooms: readonly { readonly capacity: number }[];
  /** The guests the form will save, each carrying its own headcount. */
  readonly guests: readonly { readonly headcount?: number }[];
  /** Trip start, `YYYY-MM-DD`, as the date field holds it. */
  readonly startDate: string;
  /** Trip end, `YYYY-MM-DD`, as the date field holds it. */
  readonly endDate: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Adds up the beds, the guests and the nights of a trip being created.
 *
 * @param input - See {@link TripSizeInput}
 * @returns The totals, and whether the beds run short
 *
 * @example
 * ```typescript
 * summarizeTripSize({
 *   rooms: [{ capacity: 2 }, { capacity: 3 }, { capacity: 2 }],
 *   guests: [{}, {}, {}, {}, {}, {}],
 *   startDate: '2026-07-11',
 *   endDate: '2026-07-18',
 * });
 * // { beds: 7, guests: 6, nights: 7, bedsShort: false }
 * ```
 */
export function summarizeTripSize(input: TripSizeInput): TripSizeSummary {
  const beds = input.rooms.reduce((total, room) => total + room.capacity, 0);
  const guests = input.guests.reduce(
    (total, guest) => total + getPersonHeadcount(guest),
    0,
  );

  return {
    beds,
    guests,
    nights: countNights(input.startDate, input.endDate),
    // Nobody is short of a bed on a trip with no guests yet, and a house with
    // no rooms typed in is not a warning either — it is the starting state.
    bedsShort: guests > 0 && beds > 0 && beds < guests,
  };
}

/**
 * The one line the form shows for those totals.
 *
 * Every number goes through a plural key, so "1 bed" never comes out as
 * "1 beds" and French keeps zero in its singular. The shortfall is said in
 * words as well as in amber: a colour is not an answer to anyone who cannot
 * see it.
 *
 * @param summary - Totals from {@link summarizeTripSize}
 * @param translate - The `t` of the calling component
 * @returns The sentence to render
 *
 * @example
 * ```typescript
 * // "7 beds for 6 guests, 7 nights"
 * formatTripSizeSummary({ beds: 7, guests: 6, nights: 7, bedsShort: false }, t);
 * ```
 */
export function formatTripSizeSummary(
  summary: TripSizeSummary,
  translate: TranslateFn,
): string {
  const parts = {
    beds: translate('rooms.beds', { count: summary.beds }),
    guests: translate('trips.guestCount', { count: summary.guests }),
  };

  const line =
    summary.nights === null
      ? translate('trips.sizeSummary', parts)
      : translate('trips.sizeSummaryWithNights', {
          ...parts,
          nights: translate('trips.nightCount', { count: summary.nights }),
        });

  return summary.bedsShort ? `${line} · ${translate('trips.bedsShortNote')}` : line;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Nights between two date-field values, or null when they do not answer.
 *
 * @param startDate - Trip start, `YYYY-MM-DD`
 * @param endDate - Trip end, `YYYY-MM-DD`
 * @returns The night count, or null
 */
function countNights(startDate: string, endDate: string): number | null {
  if (!startDate || !endDate || startDate > endDate) {
    return null;
  }

  if (startDate === endDate) {
    return 0;
  }

  const nights = listStayNights(startDate, endDate).length;
  return nights > 0 ? nights : null;
}
