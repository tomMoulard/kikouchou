/**
 * @fileoverview The shipped en/fr bundles, read as data.
 *
 * Everything here parses the two `translation.json` files and compares them:
 * key parity in both directions, no empty or non-string values, matching
 * interpolation variables, the namespaces the app expects, and a handful of
 * quality rules a reviewer would otherwise have to remember.
 *
 * Three describe blocks used to sit alongside them and tested `src/test/setup.ts`
 * instead of the app:
 *
 * - "i18n Module Exports" `await import`ed `@/lib/i18n` — which `setup.ts`
 *   replaces with a stub — and asserted the stub's own literals back, four times
 *   over as `typeof isLanguageSupported === 'function'`. One of them carried the
 *   comment "the mock always returns true, but we test the interface". The real
 *   module is now driven for real in `./module.test.ts`.
 * - "useTranslation Hook (mocked)" asserted that the identity `t` in `setup.ts`
 *   returns its argument.
 * - "Date Formatting with Locales" asserted that date-fns formats French dates
 *   in French. No `src/` code ran in it; its `await import('date-fns/locale')`
 *   pulled the whole locale barrel through Vite's transform and timed out at
 *   10s roughly half the time. The app's own locale lookup is covered by
 *   `./date-locale.test.ts`.
 *
 * @see ./module.test.ts — the real `@/lib/i18n`, unmocked
 * @see ./plurals.test.ts — counted strings against a real i18next instance
 * @see ./translationKeys.test.ts — every key referenced from `src/` resolves
 * @module lib/i18n/__tests__/index.test
 */

import { describe, it, expect } from 'vitest';

// Import translation files directly for key comparison
import enTranslations from '@/locales/en/translation.json';
import frTranslations from '@/locales/fr/translation.json';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Recursively extracts all keys from a nested object.
 * Returns keys in dot notation (e.g., "app.name", "common.save").
 */
function getAllKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];

  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively get keys from nested objects
      keys.push(...getAllKeys(value as Record<string, unknown>, fullKey));
    } else {
      // Leaf node - add the key
      keys.push(fullKey);
    }
  }

  return keys;
}

/**
 * Gets a value from a nested object using dot notation.
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// ============================================================================
// Translation Key Tests
// ============================================================================

describe('i18n Translation Coverage', () => {
  const enKeys = getAllKeys(enTranslations);
  const frKeys = getAllKeys(frTranslations);

  describe('Key Synchronization', () => {
    it('EN and FR have the same number of keys', () => {
      expect(enKeys.length).toBe(frKeys.length);
    });

    it('all EN keys exist in FR', () => {
      const missingInFr = enKeys.filter((key) => !frKeys.includes(key));

      if (missingInFr.length > 0) {
        console.log('Keys missing in FR:', missingInFr);
      }

      expect(missingInFr).toEqual([]);
    });

    it('all FR keys exist in EN', () => {
      const missingInEn = frKeys.filter((key) => !enKeys.includes(key));

      if (missingInEn.length > 0) {
        console.log('Keys missing in EN:', missingInEn);
      }

      expect(missingInEn).toEqual([]);
    });
  });

  describe('Translation Values', () => {
    it('no empty string values in EN', () => {
      const emptyKeys = enKeys.filter((key) => {
        const value = getNestedValue(enTranslations, key);
        return value === '';
      });

      if (emptyKeys.length > 0) {
        console.log('Empty values in EN:', emptyKeys);
      }

      expect(emptyKeys).toEqual([]);
    });

    it('no empty string values in FR', () => {
      const emptyKeys = frKeys.filter((key) => {
        const value = getNestedValue(frTranslations, key);
        return value === '';
      });

      if (emptyKeys.length > 0) {
        console.log('Empty values in FR:', emptyKeys);
      }

      expect(emptyKeys).toEqual([]);
    });

    it('all values are strings (no null or undefined)', () => {
      const invalidEnKeys = enKeys.filter((key) => {
        const value = getNestedValue(enTranslations, key);
        return typeof value !== 'string';
      });

      const invalidFrKeys = frKeys.filter((key) => {
        const value = getNestedValue(frTranslations, key);
        return typeof value !== 'string';
      });

      expect(invalidEnKeys).toEqual([]);
      expect(invalidFrKeys).toEqual([]);
    });
  });

  describe('Interpolation Variables', () => {
    it('interpolation variables match between EN and FR', () => {
      const interpolationRegex = /\{\{(\w+)\}\}/g;
      const mismatches: string[] = [];

      for (const key of enKeys) {
        const enValue = getNestedValue(enTranslations, key) as string;
        const frValue = getNestedValue(frTranslations, key) as string;

        if (typeof enValue !== 'string' || typeof frValue !== 'string') {
          continue;
        }

        const enVars = [...enValue.matchAll(interpolationRegex)].map((m) => m[1]).sort();
        const frVars = [...frValue.matchAll(interpolationRegex)].map((m) => m[1]).sort();

        if (JSON.stringify(enVars) !== JSON.stringify(frVars)) {
          mismatches.push(`${key}: EN has {${enVars.join(', ')}}, FR has {${frVars.join(', ')}}`);
        }
      }

      if (mismatches.length > 0) {
        console.log('Interpolation mismatches:', mismatches);
      }

      expect(mismatches).toEqual([]);
    });
  });

  describe('Pluralization', () => {
    it('pluralization keys are consistent', () => {
      // Check that if _plural exists, the base key exists
      const pluralKeys = enKeys.filter((key) => key.endsWith('_plural'));
      const issues: string[] = [];

      for (const pluralKey of pluralKeys) {
        const baseKey = pluralKey.replace('_plural', '');
        if (!enKeys.includes(baseKey)) {
          issues.push(`Missing base key for ${pluralKey}`);
        }
      }

      // Check that if _zero exists, base and plural exist
      const zeroKeys = enKeys.filter((key) => key.endsWith('_zero'));
      for (const zeroKey of zeroKeys) {
        const baseKey = zeroKey.replace('_zero', '');
        if (!enKeys.includes(baseKey)) {
          issues.push(`Missing base key for ${zeroKey}`);
        }
      }

      expect(issues).toEqual([]);
    });
  });
});

// ============================================================================
// Namespace Structure Tests
// ============================================================================

describe('i18n Namespace Structure', () => {
  const expectedNamespaces = [
    'app',
    'common',
    'nav',
    'trips',
    'rooms',
    'persons',
    'assignments',
    'transports',
    'upcomingPickups',
    'calendar',
    'sharing',
    'settings',
    'validation',
    'errors',
    'pwa',
    'dateRangePicker',
    'colors',
  ];

  it('EN has all expected namespaces', () => {
    const enNamespaces = Object.keys(enTranslations);

    for (const ns of expectedNamespaces) {
      expect(enNamespaces).toContain(ns);
    }
  });

  it('FR has all expected namespaces', () => {
    const frNamespaces = Object.keys(frTranslations);

    for (const ns of expectedNamespaces) {
      expect(frNamespaces).toContain(ns);
    }
  });

  it('app namespace has required keys', () => {
    expect(enTranslations.app).toHaveProperty('name');
    expect(enTranslations.app).toHaveProperty('tagline');
    expect(frTranslations.app).toHaveProperty('name');
    expect(frTranslations.app).toHaveProperty('tagline');
  });

  it('common namespace has all CRUD labels', () => {
    const crudKeys = ['save', 'cancel', 'delete', 'edit', 'add', 'close', 'confirm', 'back'];

    for (const key of crudKeys) {
      expect(enTranslations.common).toHaveProperty(key);
      expect(frTranslations.common).toHaveProperty(key);
    }
  });

  it('nav namespace has all navigation labels', () => {
    const navKeys = ['calendar', 'rooms', 'persons', 'transports', 'settings'];

    for (const key of navKeys) {
      expect(enTranslations.nav).toHaveProperty(key);
      expect(frTranslations.nav).toHaveProperty(key);
    }
  });

  it('transport modes are complete', () => {
    const modes = ['train', 'plane', 'car', 'bus', 'other'];

    for (const mode of modes) {
      expect(enTranslations.transports.modes).toHaveProperty(mode);
      expect(frTranslations.transports.modes).toHaveProperty(mode);
    }
  });

  it('all color names are translated', () => {
    const colors = [
      'red',
      'orange',
      'amber',
      'yellow',
      'lime',
      'green',
      'teal',
      'cyan',
      'blue',
      'indigo',
      'violet',
      'pink',
    ];

    for (const color of colors) {
      expect(enTranslations.colors).toHaveProperty(color);
      expect(frTranslations.colors).toHaveProperty(color);
    }
  });
});

// ============================================================================
// Translation Quality Tests
// ============================================================================

describe('Translation Quality', () => {
  it('app name is the same in both languages', () => {
    expect(enTranslations.app.name).toBe(frTranslations.app.name);
    expect(enTranslations.app.name).toBe('Kikouchou');
  });

  it('language names are in their native form', () => {
    expect(enTranslations.settings.languages.en).toBe('English');
    expect(enTranslations.settings.languages.fr).toBe('Français');
    expect(frTranslations.settings.languages.en).toBe('English');
    expect(frTranslations.settings.languages.fr).toBe('Français');
  });

  it('error messages are user-friendly (not technical)', () => {
    // Check that error messages don't contain technical jargon.
    // `errors.dev` is deliberately skipped: it holds the developer-facing
    // labels of the ErrorBoundary's dev-only details panel ("Stack trace:"),
    // which are never shown to a user.
    const technicalTerms = ['null', 'undefined', 'exception', 'stack', 'NaN'];

    for (const key of Object.keys(enTranslations.errors)) {
      // The only exemption: never rendered outside `import.meta.env.DEV`.
      if (key === 'dev') continue;
      const value = (enTranslations.errors as Record<string, unknown>)[key];
      if (typeof value === 'string') {
        for (const term of technicalTerms) {
          expect(value.toLowerCase()).not.toContain(term.toLowerCase());
        }
      }
    }
  });

  it('French translations contain natural French contractions', () => {
    // French text naturally uses apostrophes for contractions like "d'été", "l'application"
    // This test verifies that French text contains expected contractions
    const frText = JSON.stringify(frTranslations);

    // French should have apostrophes (contractions are part of the language)
    // Common patterns: d', l', n', s', c', qu'
    expect(frText).toMatch(/d'/); // e.g., "d'été", "d'arrivée"
    expect(frText).toMatch(/l'/); // e.g., "l'application", "l'attribution"
  });

  it('placeholders give helpful examples', () => {
    // Check that placeholder text provides examples
    expect(enTranslations.trips.namePlaceholder).toMatch(/e\.g\./);
    expect(enTranslations.trips.locationPlaceholder).toMatch(/e\.g\./);
    expect(frTranslations.trips.namePlaceholder).toMatch(/Ex/);
    expect(frTranslations.trips.locationPlaceholder).toMatch(/Ex/);
  });
});
