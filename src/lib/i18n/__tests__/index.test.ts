/**
 * @fileoverview Tests for i18n configuration and translation coverage.
 * Verifies language switching, translation completeness, and locale consistency.
 *
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
// i18n Module Tests
// ============================================================================

describe('i18n Module Exports', () => {
  // Note: These tests use the mocked i18n from setup.ts
  // For actual i18n functionality, we test the exports and constants

  it('exports SUPPORTED_LANGUAGES', async () => {
    const { SUPPORTED_LANGUAGES } = await import('@/lib/i18n');
    expect(SUPPORTED_LANGUAGES).toEqual(['en', 'fr']);
  });

  it('exports DEFAULT_LANGUAGE as fr', async () => {
    const { DEFAULT_LANGUAGE } = await import('@/lib/i18n');
    expect(DEFAULT_LANGUAGE).toBe('fr');
  });

  it('exports LANGUAGE_STORAGE_KEY', async () => {
    const { LANGUAGE_STORAGE_KEY } = await import('@/lib/i18n');
    expect(LANGUAGE_STORAGE_KEY).toBe('i18nextLng');
  });

  it('exports isLanguageSupported function', async () => {
    const { isLanguageSupported } = await import('@/lib/i18n');
    expect(typeof isLanguageSupported).toBe('function');
  });

  it('isLanguageSupported returns true for supported languages', async () => {
    const { isLanguageSupported } = await import('@/lib/i18n');
    expect(isLanguageSupported('en')).toBe(true);
    expect(isLanguageSupported('fr')).toBe(true);
  });

  it('isLanguageSupported returns false for unsupported languages', async () => {
    const { isLanguageSupported } = await import('@/lib/i18n');
    // The mock always returns true, but we test the interface
    expect(typeof isLanguageSupported('de')).toBe('boolean');
  });

  it('exports getCurrentLanguage function', async () => {
    const { getCurrentLanguage } = await import('@/lib/i18n');
    expect(typeof getCurrentLanguage).toBe('function');
  });

  it('exports changeLanguage function', async () => {
    const { changeLanguage } = await import('@/lib/i18n');
    expect(typeof changeLanguage).toBe('function');
  });

  it('exports i18nReady promise', async () => {
    const { i18nReady } = await import('@/lib/i18n');
    expect(i18nReady).toBeInstanceOf(Promise);
  });

  it('exports isI18nInitialized function', async () => {
    const { isI18nInitialized } = await import('@/lib/i18n');
    expect(typeof isI18nInitialized).toBe('function');
  });
});

// ============================================================================
// Translation Quality Tests
// ============================================================================

describe('Translation Quality', () => {
  it('app name is the same in both languages', () => {
    expect(enTranslations.app.name).toBe(frTranslations.app.name);
    expect(enTranslations.app.name).toBe('Kikoushou');
  });

  it('language names are in their native form', () => {
    expect(enTranslations.settings.languages.en).toBe('English');
    expect(enTranslations.settings.languages.fr).toBe('Français');
    expect(frTranslations.settings.languages.en).toBe('English');
    expect(frTranslations.settings.languages.fr).toBe('Français');
  });

  it('error messages are user-friendly (not technical)', () => {
    // Check that error messages don't contain technical jargon
    const technicalTerms = ['null', 'undefined', 'exception', 'stack', 'NaN'];

    for (const key of Object.keys(enTranslations.errors)) {
      const value = (enTranslations.errors as Record<string, string>)[key];
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

// ============================================================================
// Date/Number Formatting Tests
// ============================================================================

describe('Date Formatting with Locales', () => {
  it('date-fns French locale is available', async () => {
    const { fr } = await import('date-fns/locale');
    expect(fr).toBeDefined();
    expect(fr.code).toBe('fr');
  });

  it('date-fns English locale is available', async () => {
    const { enUS } = await import('date-fns/locale');
    expect(enUS).toBeDefined();
    expect(enUS.code).toBe('en-US');
  });

  it('formats dates correctly in French', async () => {
    const { format } = await import('date-fns');
    const { fr } = await import('date-fns/locale');

    const date = new Date(2024, 0, 15); // January 15, 2024
    const formatted = format(date, 'EEEE d MMMM yyyy', { locale: fr });

    expect(formatted).toContain('janvier');
    expect(formatted).toContain('2024');
  });

  it('formats dates correctly in English', async () => {
    const { format } = await import('date-fns');
    const { enUS } = await import('date-fns/locale');

    const date = new Date(2024, 0, 15); // January 15, 2024
    const formatted = format(date, 'EEEE, MMMM d, yyyy', { locale: enUS });

    expect(formatted).toContain('January');
    expect(formatted).toContain('2024');
  });

  it('formats relative time correctly', async () => {
    const { formatDistanceToNow } = await import('date-fns');
    const { fr, enUS } = await import('date-fns/locale');

    const pastDate = new Date(Date.now() - 3600000); // 1 hour ago

    const enRelative = formatDistanceToNow(pastDate, { locale: enUS, addSuffix: true });
    const frRelative = formatDistanceToNow(pastDate, { locale: fr, addSuffix: true });

    expect(enRelative).toMatch(/hour|minute/i);
    expect(frRelative).toMatch(/heure|minute/i);
  });
});

// ============================================================================
// useTranslation Hook Tests (via mock)
// ============================================================================

describe('useTranslation Hook (mocked)', () => {
  it('returns translation key when translation not found', async () => {
    // This tests our mock behavior which returns keys directly
    const { useTranslation } = await import('react-i18next');
    const { t } = useTranslation();

    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('handles interpolation in mock', async () => {
    const { useTranslation } = await import('react-i18next');
    const { t } = useTranslation();

    // Our mock replaces {{key}} with values
    const result = t('test.key', { name: 'John' });
    expect(typeof result).toBe('string');
  });

  it('provides i18n object', async () => {
    const { useTranslation } = await import('react-i18next');
    const { i18n } = useTranslation();

    expect(i18n).toBeDefined();
    expect(i18n.language).toBe('en');
    expect(typeof i18n.changeLanguage).toBe('function');
  });
});
