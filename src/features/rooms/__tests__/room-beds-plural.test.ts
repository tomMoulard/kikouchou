/**
 * @fileoverview Resolves `rooms.beds` against the real catalogues.
 *
 * The catalogue used to ship the legacy i18next **v3** suffix (`beds_plural`).
 * This app runs i18next v25 with v4 JSON plurals and no `compatibilityJSON`, so
 * `_plural` was unreachable and `t('rooms.beds', { count: 4 })` rendered
 * "4 bed". The setup-wide `react-i18next` mock returns keys verbatim, so no
 * component test can catch that — only resolving through i18next itself can.
 *
 * @module features/rooms/__tests__/room-beds-plural.test
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { i18n as I18nInstance } from 'i18next';

import enTranslation from '@/locales/en/translation.json';
import frTranslation from '@/locales/fr/translation.json';

// The shared setup stubs i18next so components render translation keys. This
// suite is specifically about how the real library resolves plural suffixes.
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

describe('rooms.beds pluralisation', () => {
  it('renders the English singular and plural', async () => {
    await i18n.changeLanguage('en');

    expect(i18n.t('rooms.beds', { count: 1 })).toBe('1 bed');
    expect(i18n.t('rooms.beds', { count: 4 })).toBe('4 beds');
  });

  it('renders the French singular and plural, where zero is singular', async () => {
    await i18n.changeLanguage('fr');

    expect(i18n.t('rooms.beds', { count: 1 })).toBe('1 lit');
    expect(i18n.t('rooms.beds', { count: 4 })).toBe('4 lits');
    // CLDR puts 0 in French's `one` category.
    expect(i18n.t('rooms.beds', { count: 0 })).toBe('0 lit');
  });

  it('leaves no legacy v3 plural suffix in the rooms namespace', async () => {
    for (const catalogue of [enTranslation, frTranslation]) {
      const rooms = (catalogue as { rooms: Record<string, unknown> }).rooms;
      expect(Object.keys(rooms).filter((key) => key.endsWith('_plural'))).toEqual([]);
    }
  });
});
