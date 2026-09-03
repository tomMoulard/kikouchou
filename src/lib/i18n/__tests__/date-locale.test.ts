/**
 * @fileoverview Unit tests for the canonical date-fns locale lookup.
 *
 * @module lib/i18n/__tests__/date-locale.test
 */

import { describe, it, expect } from 'vitest';
import { enUS, fr } from 'date-fns/locale';

import { getDateLocale } from '../date-locale';

describe('getDateLocale', () => {
  it('returns the French locale for "fr"', () => {
    expect(getDateLocale('fr')).toBe(fr);
  });

  it('returns the English locale for "en"', () => {
    expect(getDateLocale('en')).toBe(enUS);
  });

  it('returns the French locale for a regional French tag', () => {
    // `supportedLngs` normally narrows `i18n.language` to a bare tag, but a
    // stale `i18nextLng` value or a test's i18n mock can still deliver one.
    expect(getDateLocale('fr-FR')).toBe(fr);
    expect(getDateLocale('fr-CA')).toBe(fr);
    expect(getDateLocale('FR')).toBe(fr);
  });

  it('falls back to English when the language is missing entirely', () => {
    expect(getDateLocale(undefined as unknown as string)).toBe(enUS);
  });

  it('returns the English locale for regional English tags', () => {
    expect(getDateLocale('en-US')).toBe(enUS);
    expect(getDateLocale('en-GB')).toBe(enUS);
  });

  it('falls back to English for unsupported and empty languages', () => {
    expect(getDateLocale('de')).toBe(enUS);
    expect(getDateLocale('es')).toBe(enUS);
    expect(getDateLocale('')).toBe(enUS);
  });

  it('does not treat another language beginning with "fr" as French', () => {
    expect(getDateLocale('frr')).toBe(enUS);
  });
});
