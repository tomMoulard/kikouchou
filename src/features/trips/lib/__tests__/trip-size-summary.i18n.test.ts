/**
 * @fileoverview Resolves the create form's summary line against the real
 * catalogues.
 *
 * The suite-wide `react-i18next` mock returns keys verbatim, so a component
 * test can prove the line is there and cannot prove it reads as a sentence.
 * This one renders the actual words, in both languages, for the trip in the
 * bug report: six guests, seven beds, seven nights.
 *
 * @module features/trips/lib/__tests__/trip-size-summary.i18n.test
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { i18n as I18nInstance } from 'i18next';

import enTranslation from '@/locales/en/translation.json';
import frTranslation from '@/locales/fr/translation.json';
import {
  formatTripSizeSummary,
  summarizeTripSize,
} from '@/features/trips/lib/trip-size-summary';

vi.unmock('i18next');

let i18n: I18nInstance;

beforeAll(async () => {
  const { createInstance } = await vi.importActual<typeof import('i18next')>('i18next');
  i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr'],
    resources: {
      en: { translation: enTranslation },
      fr: { translation: frTranslation },
    },
    interpolation: { escapeValue: false },
  });
});

/** The trip in the bug report. */
const REPORTED_TRIP = {
  rooms: [{ capacity: 2 }, { capacity: 3 }, { capacity: 2 }],
  guests: [{}, {}, {}, {}, {}, {}],
  startDate: '2026-07-11',
  endDate: '2026-07-18',
} as const;

/** Formats a summary through the real catalogue of the current language. */
function line(input: Parameters<typeof summarizeTripSize>[0]): string {
  return formatTripSizeSummary(summarizeTripSize(input), (key, options) =>
    i18n.t(key, options ?? {}),
  );
}

describe('the create form summary line, in words', () => {
  it('says what the reported trip adds up to, in English', async () => {
    await i18n.changeLanguage('en');

    expect(line(REPORTED_TRIP)).toBe('7 beds for 6 guests, 7 nights');
  });

  it('says it in French', async () => {
    await i18n.changeLanguage('fr');

    expect(line(REPORTED_TRIP)).toBe('7 lits pour 6 invités, 7 nuits');
  });

  it('keeps every count singular where the count is one', async () => {
    await i18n.changeLanguage('en');

    expect(
      line({
        rooms: [{ capacity: 1 }],
        guests: [{}],
        startDate: '2026-07-11',
        endDate: '2026-07-12',
      }),
    ).toBe('1 bed for 1 guest, 1 night');
  });

  it('drops the nights while the dates do not answer', async () => {
    await i18n.changeLanguage('en');

    expect(
      line({ rooms: [{ capacity: 4 }], guests: [{}, {}], startDate: '', endDate: '' }),
    ).toBe('4 beds for 2 guests');
  });

  it('names the shortfall in words, not only in amber', async () => {
    await i18n.changeLanguage('en');

    expect(
      line({
        rooms: [{ capacity: 2 }, { capacity: 3 }],
        guests: [{}, {}, {}, {}, {}, {}],
        startDate: '2026-07-11',
        endDate: '2026-07-18',
      }),
    ).toBe('5 beds for 6 guests, 7 nights · not enough beds');
  });
});
