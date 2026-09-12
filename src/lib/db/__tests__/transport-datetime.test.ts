/**
 * Unit tests for the transport datetime normaliser.
 *
 * The assertions derive every ambiguous value from a known instant instead of
 * hard-coding one, so they hold in any zone the suite is run under.
 *
 * @module lib/db/__tests__/transport-datetime.test
 */
import { describe, it, expect } from 'vitest';

import {
  requireCanonicalDatetime,
  toCanonicalDatetime,
} from '@/lib/db/transport-datetime';

const pad = (value: number): string => String(value).padStart(2, '0');

/** The value a `datetime-local` input holds for an instant, in the local zone. */
function asLocalInputValue(instant: Date): string {
  return [
    `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`,
    `${pad(instant.getHours())}:${pad(instant.getMinutes())}`,
  ].join('T');
}

describe('toCanonicalDatetime', () => {
  it('reads an offset-less value as local time and returns its UTC instant', () => {
    const instant = new Date('2026-09-03T12:30:00.000Z');

    expect(toCanonicalDatetime(asLocalInputValue(instant))).toBe(
      instant.toISOString(),
    );
  });

  it('re-expresses an offset-carrying value in UTC', () => {
    expect(toCanonicalDatetime('2026-09-03T14:30:00+02:00')).toBe(
      '2026-09-03T12:30:00.000Z',
    );
    expect(toCanonicalDatetime('2026-09-03T01:30:00-11:00')).toBe(
      '2026-09-03T12:30:00.000Z',
    );
  });

  it('is idempotent on an already canonical value', () => {
    const canonical = '2026-09-03T12:30:00.000Z';

    expect(toCanonicalDatetime(canonical)).toBe(canonical);
    expect(toCanonicalDatetime(toCanonicalDatetime(canonical) ?? '')).toBe(canonical);
  });

  it('reads a date-only value as local midnight, agreeing with pickup-utils', () => {
    const localMidnight = new Date(2026, 8, 3);

    expect(toCanonicalDatetime('2026-09-03')).toBe(localMidnight.toISOString());
  });

  it('returns undefined for an unparseable or empty value', () => {
    expect(toCanonicalDatetime('')).toBeUndefined();
    expect(toCanonicalDatetime('   ')).toBeUndefined();
    expect(toCanonicalDatetime('not-a-date')).toBeUndefined();
    expect(toCanonicalDatetime('2026-13-45T99:99')).toBeUndefined();
  });
});

describe('requireCanonicalDatetime', () => {
  it('returns the instant for a parseable value', () => {
    expect(requireCanonicalDatetime('2026-09-03T14:30:00+02:00')).toBe(
      '2026-09-03T12:30:00.000Z',
    );
  });

  it('throws with the offending value for an unparseable one', () => {
    expect(() => requireCanonicalDatetime('tomorrow-ish')).toThrow(
      'Invalid transport datetime: "tomorrow-ish"',
    );
  });
});
