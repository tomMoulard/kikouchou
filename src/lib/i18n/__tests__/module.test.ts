/**
 * @fileoverview The real `@/lib/i18n`, driven for once instead of stubbed.
 *
 * `src/test/setup.ts` replaces this module, `i18next` and `react-i18next` with
 * stubs for the whole suite, so component tests see translation keys rather than
 * prose. That is the right default — and it meant nothing in `src/` ever
 * executed `getCurrentLanguage`, `isLanguageSupported`, `changeLanguage` or the
 * `init()` call at module scope. The suite that claimed to cover them
 * `await import`ed the stub and asserted `typeof isLanguageSupported ===
 * 'function'`, with a comment admitting "the mock always returns true, but we
 * test the interface".
 *
 * The three `vi.unmock` calls below are hoisted above the imports, so this file
 * — and only this file — gets the shipped module, initialised exactly as
 * `main.tsx` initialises it.
 *
 * What that buys, and what nothing else in the repo checks:
 *
 * - `fallbackLng` really is French. An unknown language must fall back to
 *   French prose, not English; the constant alone cannot show that.
 * - `LANGUAGE_STORAGE_KEY` is the string the detector was actually initialised
 *   with, and that string is still `i18nextLng`. Renaming it silently strands
 *   the stored preference of every existing user. (jsdom here exposes no
 *   `localStorage` at all — see `ThemeSelector.test.tsx` — and the detector
 *   memoises that on first use at import time, so the write itself cannot be
 *   observed from a test; the initialised options can.)
 * - `getCurrentLanguage` normalises what i18next actually puts in
 *   `i18n.language`, including a regional tag and an unsupported one.
 *
 * Bundle contents are the sibling suites' job and are not repeated here.
 *
 * @see ./index.test.ts — en/fr key parity and translation quality
 * @see ./plurals.test.ts — counted strings against a real i18next instance
 * @module lib/i18n/__tests__/module.test
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Hoisted above the imports by Vitest, lifting the suite-wide stubs that
// `setupFiles` registered — for this file only.
vi.unmock('@/lib/i18n');
vi.unmock('i18next');
vi.unmock('react-i18next');

import i18n, {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  changeLanguage,
  getCurrentLanguage,
  i18nReady,
  isI18nInitialized,
  isLanguageSupported,
} from '@/lib/i18n';

// ============================================================================
// Tests
// ============================================================================

describe('the shipped i18n module', () => {
  beforeAll(async () => {
    await i18nReady;
  });

  afterEach(async () => {
    // The instance is a module singleton, so a test that switches language
    // would otherwise decide what the next one starts in.
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  describe('initialisation', () => {
    it('really initialises, rather than resolving an empty promise', () => {
      // The stub exported `i18nReady: Promise.resolve()` and
      // `isI18nInitialized: () => true`, so the old assertions held even with
      // `init()` never called.
      expect(isI18nInitialized()).toBe(true);
      expect(i18n.isInitialized).toBe(true);
    });

    it('serves the shipped bundles through the app instance', () => {
      expect(i18n.getFixedT('en')('common.save')).toBe('Save');
      expect(i18n.getFixedT('fr')('common.save')).toBe('Enregistrer');
    });

    it('falls back to French, not English, for an unknown language', () => {
      // `DEFAULT_LANGUAGE` is what `fallbackLng` is set from; this is the only
      // check that the wiring took effect. English prose here would mean French
      // users silently read English whenever a key is missing from `fr`.
      expect(i18n.getFixedT('de')('common.save')).toBe('Enregistrer');
      expect(DEFAULT_LANGUAGE).toBe('fr');
    });

    it('restricts itself to the languages it ships bundles for', () => {
      expect([...SUPPORTED_LANGUAGES].sort()).toEqual(
        Object.keys(i18n.options.resources ?? {}).sort(),
      );
    });
  });

  describe('changeLanguage', () => {
    it('switches the prose the instance returns', async () => {
      await changeLanguage('en');
      expect(i18n.t('common.save')).toBe('Save');

      await changeLanguage('fr');
      expect(i18n.t('common.save')).toBe('Enregistrer');
    });

    it('caches the choice under the exact key the app has always used', () => {
      // Two failure modes, both silent: the detector being wired to some other
      // string than the exported constant, and the constant itself being
      // renamed. A rename loses the stored preference of every existing user,
      // so the literal is spelled out rather than compared to itself.
      expect(i18n.options.detection?.lookupLocalStorage).toBe(LANGUAGE_STORAGE_KEY);
      expect(LANGUAGE_STORAGE_KEY).toBe('i18nextLng');
    });
  });

  describe('getCurrentLanguage', () => {
    it('reports the active language', async () => {
      await changeLanguage('en');
      expect(getCurrentLanguage()).toBe('en');

      await changeLanguage('fr');
      expect(getCurrentLanguage()).toBe('fr');
    });

    // The three cases below assign `i18n.language` rather than going through
    // `changeLanguage`, because `supportedLngs` makes i18next normalise every
    // one of them away before they land: `changeLanguage('en-GB')` leaves
    // `i18n.language === 'en'` and `changeLanguage('de')` leaves it `'fr'`.
    // (Written the obvious way, these tests pass with the normalisation in
    // `getCurrentLanguage` deleted — measured.) The guards are still load
    // bearing: the function is declared to return `Language`, so TypeScript
    // trusts whatever it hands back, and every caller that compares the result
    // against `SUPPORTED_LANGUAGES` breaks on a raw tag.

    it('narrows a regional tag to its base language', () => {
      i18n.language = 'en-GB';
      expect(getCurrentLanguage()).toBe('en');

      i18n.language = 'fr-CA';
      expect(getCurrentLanguage()).toBe('fr');
    });

    it('reports the default when the active language is not supported', () => {
      i18n.language = 'de';
      expect(getCurrentLanguage()).toBe('fr');

      i18n.language = '';
      expect(getCurrentLanguage()).toBe('fr');
    });

    it('reports the default before initialisation finishes', () => {
      // `main.tsx` awaits `i18nReady`, but anything imported at module scope
      // can read this earlier; the getter must not report i18next's own
      // pre-init value.
      i18n.isInitialized = false;
      try {
        i18n.language = 'en';
        expect(getCurrentLanguage()).toBe('fr');
      } finally {
        i18n.isInitialized = true;
      }
    });
  });

  describe('isLanguageSupported', () => {
    it('accepts exactly the supported tags', () => {
      expect(isLanguageSupported('en')).toBe(true);
      expect(isLanguageSupported('fr')).toBe(true);
    });

    it('rejects anything else, including near misses', () => {
      // The old suite asserted `typeof isLanguageSupported('de') === 'boolean'`
      // because the stub could only ever return true.
      expect(isLanguageSupported('de')).toBe(false);
      expect(isLanguageSupported('es')).toBe(false);
      expect(isLanguageSupported('')).toBe(false);
      // Matching is exact: neither case-insensitive nor prefix-based.
      expect(isLanguageSupported('EN')).toBe(false);
      expect(isLanguageSupported('en-US')).toBe(false);
      expect(isLanguageSupported('frr')).toBe(false);
    });
  });
});
