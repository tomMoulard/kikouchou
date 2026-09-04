/**
 * @fileoverview The single datetime representation transports are stored in.
 *
 * A transport's `datetime` is ordered, bucketed and compared as a plain
 * string — by the `[tripId+datetime]` Dexie index, by the repository's sorts,
 * and by the day keys readers slice out of it. All of that is only meaningful
 * if every row uses the *same* representation, so the repository stores
 * exactly one: a UTC ISO instant (`…Z`).
 *
 * A `datetime-local` input hands the app `2026-09-03T14:30` — no `Z`, no
 * offset — and a synced or imported row may carry `2026-09-03T16:30:00+02:00`.
 * Both parse, both render, and both sort by their literal characters rather
 * than by the instant they denote. Everything that writes a transport must run
 * its value through {@link toCanonicalDatetime} first.
 *
 * Parsing goes through date-fns `parseISO`, the same parser
 * `features/transports/utils/pickup-utils` compares instants with, so a stored
 * value resolves the same way whichever of the two a caller reaches for.
 * `new Date` would not: it reads a date-only `2026-09-03` as UTC midnight
 * where `parseISO` reads it as local midnight, and the two would disagree by
 * up to a day.
 *
 * @module lib/db/transport-datetime
 */

import { isValid, parseISO } from 'date-fns';

import type { ISODateTimeString } from '@/types';

/**
 * Normalises any parseable datetime into a UTC ISO instant.
 *
 * An offset-less value (`2026-09-03T14:30`) is read as **local** time, which
 * is what a `datetime-local` input means; a value carrying `Z` or an offset is
 * read as the instant it states and re-expressed in UTC. A local wall clock
 * that does not exist — the hour a spring-forward DST transition skips — is
 * mapped the way the platform maps it rather than rejected, exactly as
 * `TransportForm` has always done with `new Date(local).toISOString()`.
 *
 * @param value - A datetime string, with or without an offset
 * @returns The UTC ISO instant, or undefined when the value is unparseable
 *
 * @example
 * ```typescript
 * toCanonicalDatetime('2026-09-03T14:30');           // in UTC+2 → '2026-09-03T12:30:00.000Z'
 * toCanonicalDatetime('2026-09-03T16:30:00+02:00');  // → '2026-09-03T14:30:00.000Z'
 * toCanonicalDatetime('not a date');                 // → undefined
 * ```
 */
export function toCanonicalDatetime(
  value: string,
): ISODateTimeString | undefined {
  const parsed = parseISO(value);

  return isValid(parsed)
    ? (parsed.toISOString() as ISODateTimeString)
    : undefined;
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
export function requireCanonicalDatetime(value: string): ISODateTimeString {
  const instant = toCanonicalDatetime(value);

  if (instant === undefined) {
    throw new Error(
      `Invalid transport datetime: "${value}". Expected a parseable date-time.`,
    );
  }

  return instant;
}
