/**
 * @fileoverview The single datetime representation transports are stored in.
 *
 * A transport's `datetime` is ordered, bucketed and compared as a plain
 * string — by the `[tripId+datetime]` Dexie index, by every `localeCompare`
 * sort in the repository, and by the day keys readers slice out of it. All of
 * that is only meaningful if every row uses the *same* representation, so the
 * repository stores exactly one: a UTC ISO instant (`…Z`).
 *
 * A `datetime-local` input hands the app `2026-09-03T14:30` — no `Z`, no
 * offset — and a synced or imported row may carry `2026-09-03T16:30:00+02:00`.
 * Both parse, both render, and both sort by their literal characters rather
 * than by the instant they denote. Everything that writes a transport must run
 * its value through {@link toTransportInstant} first.
 *
 * @module lib/db/transport-datetime
 */

import type { ISODateTimeString } from '@/types';

/**
 * Normalises any parseable datetime into a UTC ISO instant.
 *
 * An offset-less value (`2026-09-03T14:30`) is read as **local** time, which
 * is what a `datetime-local` input means; a value carrying `Z` or an offset is
 * read as the instant it states and re-expressed in UTC.
 *
 * @param value - A datetime string, with or without an offset
 * @returns The UTC ISO instant, or undefined when the value is unparseable
 *
 * @example
 * ```typescript
 * toTransportInstant('2026-09-03T14:30');            // in UTC+2 → '2026-09-03T12:30:00.000Z'
 * toTransportInstant('2026-09-03T16:30:00+02:00');   // → '2026-09-03T14:30:00.000Z'
 * toTransportInstant('not a date');                  // → undefined
 * ```
 */
export function toTransportInstant(
  value: string,
): ISODateTimeString | undefined {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? undefined
    : (parsed.toISOString() as ISODateTimeString);
}

/**
 * Normalises a datetime for a write, rejecting anything unparseable.
 *
 * Storing a value no reader can turn into an instant is never useful: it sorts
 * arbitrarily against every other row and buckets into a day that does not
 * exist. Write paths fail loudly instead.
 *
 * @param value - A datetime string, with or without an offset
 * @returns The UTC ISO instant
 * @throws {Error} If the value cannot be parsed as a datetime
 */
export function requireTransportInstant(value: string): ISODateTimeString {
  const instant = toTransportInstant(value);

  if (instant === undefined) {
    throw new Error(
      `Invalid transport datetime: "${value}". Expected a parseable date-time.`,
    );
  }

  return instant;
}
