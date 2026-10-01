/**
 * @fileoverview Tests for the single transport datetime renderer.
 *
 * The assertions never encode the machine's UTC offset: inputs are either
 * offset-free (so `parseISO` reads them as local wall-clock time) or checked
 * against a value derived from the same instant.
 *
 * @module lib/utils/__tests__/datetime-format
 */

import { describe, expect, it } from 'vitest';
import { format, parseISO } from 'date-fns';
import { enUS, fr } from 'date-fns/locale';

import {
  TRANSPORT_DATETIME_VARIANTS,
  formatTransportDatetime,
  formatTransportDatetimeParts,
  type TransportDatetimeVariant,
} from '@/lib/utils/datetime-format';

/** A local wall-clock time: no offset, so it means 14:30 wherever it is read. */
const LOCAL_AFTERNOON = '2026-07-15T14:30:00';

/** The same day expressed as a UTC instant, whose local rendering varies. */
const UTC_INSTANT = '2026-07-15T12:30:00.000Z';

const ALL_VARIANTS: readonly TransportDatetimeVariant[] = [
  TRANSPORT_DATETIME_VARIANTS.timeOnly,
  TRANSPORT_DATETIME_VARIANTS.dayAndTime,
  TRANSPORT_DATETIME_VARIANTS.fullDayAndTime,
];

describe('formatTransportDatetimeParts', () => {
  describe('timeOnly', () => {
    it('renders a 24-hour clock and no date', () => {
      const parts = formatTransportDatetimeParts(LOCAL_AFTERNOON, enUS, 'timeOnly');
      expect(parts).toEqual({ date: '', time: '14:30', full: '14:30' });
    });
  });

  describe('dayAndTime', () => {
    it('renders the weekday, day, month and clock', () => {
      const parts = formatTransportDatetimeParts(LOCAL_AFTERNOON, enUS, 'dayAndTime');
      expect(parts.date).toBe('Wed 15 Jul');
      expect(parts.time).toBe('14:30');
      expect(parts.full).toBe('Wed 15 Jul, 14:30');
    });

    it('is the default variant', () => {
      expect(formatTransportDatetimeParts(LOCAL_AFTERNOON, enUS)).toEqual(
        formatTransportDatetimeParts(LOCAL_AFTERNOON, enUS, 'dayAndTime'),
      );
    });

    it('renders the date in the given locale', () => {
      const french = formatTransportDatetimeParts(LOCAL_AFTERNOON, fr, 'dayAndTime');
      expect(french.date).toContain('juil.');
      expect(french.time).toBe('14:30');
    });

    it('falls back to English when no locale is given', () => {
      expect(formatTransportDatetimeParts(LOCAL_AFTERNOON, undefined, 'dayAndTime')).toEqual(
        formatTransportDatetimeParts(LOCAL_AFTERNOON, enUS, 'dayAndTime'),
      );
    });
  });

  describe('fullDayAndTime', () => {
    it('spells the date out with the year', () => {
      const parts = formatTransportDatetimeParts(LOCAL_AFTERNOON, enUS, 'fullDayAndTime');
      expect(parts.date).toContain('July');
      expect(parts.date).toContain('2026');
      expect(parts.time).toBe('14:30');
      expect(parts.full).toBe(`${parts.date}, 14:30`);
    });
  });

  describe('invalid input', () => {
    it.each(['', 'not-a-date', '2026-13-45T99:99', 'undefined'])(
      'returns empty pieces for %j',
      (datetime) => {
        expect(formatTransportDatetimeParts(datetime, enUS, 'dayAndTime')).toEqual({
          date: '',
          time: '',
          full: '',
        });
      },
    );

    it('returns empty pieces for every variant', () => {
      for (const variant of ALL_VARIANTS) {
        expect(formatTransportDatetimeParts('nonsense', enUS, variant).full).toBe('');
      }
    });
  });
});

describe('formatTransportDatetime', () => {
  it('returns the joined pieces', () => {
    for (const variant of ALL_VARIANTS) {
      expect(formatTransportDatetime(LOCAL_AFTERNOON, enUS, variant)).toBe(
        formatTransportDatetimeParts(LOCAL_AFTERNOON, enUS, variant).full,
      );
    }
  });

  it('defaults to dayAndTime', () => {
    expect(formatTransportDatetime(LOCAL_AFTERNOON, enUS)).toBe('Wed 15 Jul, 14:30');
  });
});

describe('a stored UTC instant', () => {
  it('renders in the viewer local timezone, not in UTC', () => {
    const expected = format(parseISO(UTC_INSTANT), 'HH:mm');
    for (const variant of ALL_VARIANTS) {
      expect(formatTransportDatetimeParts(UTC_INSTANT, enUS, variant).time).toBe(expected);
    }
  });

  it('shows the same clock time in every variant', () => {
    const times = ALL_VARIANTS.map(
      (variant) => formatTransportDatetimeParts(UTC_INSTANT, enUS, variant).time,
    );
    expect(new Set(times).size).toBe(1);
  });

  it('shows the same clock time in every locale', () => {
    expect(formatTransportDatetimeParts(UTC_INSTANT, fr, 'dayAndTime').time).toBe(
      formatTransportDatetimeParts(UTC_INSTANT, enUS, 'dayAndTime').time,
    );
  });

  it('shows back the wall-clock time the form was given', () => {
    // TransportForm stores `new Date(localDatetime).toISOString()`; whatever the
    // machine offset, the entered time must come back out.
    const entered = ['00:00', '06:30', '12:00', '18:45', '23:59'];
    for (const time of entered) {
      const stored = new Date(`2026-07-15T${time}`).toISOString();
      expect(formatTransportDatetimeParts(stored, enUS, 'timeOnly').time).toBe(time);
    }
  });
});
