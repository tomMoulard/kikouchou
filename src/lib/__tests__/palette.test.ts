/**
 * @fileoverview Tests for the palette preference and the calendar that gates
 * the seasonal palettes.
 *
 * Dates are built from local components (`new Date(y, m, d)`), because the
 * module reads the local month. A `Z`-suffixed fixture would pass or fail by
 * the machine's offset on the first and last day of a month.
 *
 * @module lib/__tests__/palette.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyStoredPalette,
  DEFAULT_PALETTE,
  isPalette,
  isPaletteAvailable,
  listAvailablePalettes,
  PALETTE_ATTRIBUTE,
  PALETTE_STORAGE_KEY,
  PALETTES,
  readStoredPalette,
  resolvePalette,
  SEASONAL_PALETTE_MONTHS,
  storePalette,
} from '@/lib/palette';

/**
 * jsdom in this suite exposes no `localStorage`; install a working one.
 *
 * @returns The installed store
 */
function installLocalStorage(): Storage {
  const entries = new Map<string, string>(),
    store: Storage = {
      get length(): number {
        return entries.size;
      },
      clear: () => entries.clear(),
      getItem: (key) => entries.get(key) ?? null,
      key: (index) => [...entries.keys()][index] ?? null,
      removeItem: (key) => {
        entries.delete(key);
      },
      setItem: (key, value) => {
        entries.set(key, value);
      },
    };

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: store,
  });

  return store;
}

const OCTOBER_FIRST = new Date(2026, 9, 1),
  OCTOBER_LAST = new Date(2026, 9, 31, 23, 59),
  NOVEMBER_FIRST = new Date(2026, 10, 1, 0, 0);

describe('isPalette', () => {
  it('accepts every declared palette and nothing else', () => {
    for (const palette of PALETTES) {
      expect(isPalette(palette)).toBe(true);
    }
    expect(isPalette('sepia')).toBe(false);
    expect(isPalette(null)).toBe(false);
    expect(isPalette(3)).toBe(false);
  });
});

describe('isPaletteAvailable', () => {
  it('offers the year-round palettes every month', () => {
    for (let month = 0; month < 12; month += 1) {
      const date = new Date(2026, month, 15);

      expect(isPaletteAvailable('default', date)).toBe(true);
      expect(isPaletteAvailable('ocean', date)).toBe(true);
      expect(isPaletteAvailable('forest', date)).toBe(true);
    }
  });

  it('offers Halloween from the first to the last minute of October', () => {
    expect(isPaletteAvailable('halloween', OCTOBER_FIRST)).toBe(true);
    expect(isPaletteAvailable('halloween', OCTOBER_LAST)).toBe(true);
    expect(isPaletteAvailable('halloween', NOVEMBER_FIRST)).toBe(false);
    expect(isPaletteAvailable('halloween', new Date(2026, 8, 30, 23, 59))).toBe(
      false,
    );
  });

  it('offers each seasonal palette in exactly one month', () => {
    for (const [palette, month] of Object.entries(SEASONAL_PALETTE_MONTHS)) {
      const months = Array.from({ length: 12 }, (_, index) => index).filter(
        (index) =>
          isPalette(palette) &&
          isPaletteAvailable(palette, new Date(2026, index, 10)),
      );

      expect(months).toEqual([(month ?? 0) - 1]);
    }
  });

  it('puts the four occasions in their months', () => {
    expect(SEASONAL_PALETTE_MONTHS).toEqual({
      valentine: 2,
      stpatrick: 3,
      halloween: 10,
      christmas: 12,
    });
  });
});

describe('listAvailablePalettes', () => {
  it('lists only the year-round palettes in September', () => {
    expect(listAvailablePalettes(new Date(2026, 8, 27))).toEqual([
      'default',
      'ocean',
      'forest',
    ]);
  });

  it('adds Christmas in December, after the year-round ones', () => {
    expect(listAvailablePalettes(new Date(2026, 11, 24))).toEqual([
      'default',
      'ocean',
      'forest',
      'christmas',
    ]);
  });
});

describe('resolvePalette', () => {
  it('keeps a valid palette in season', () => {
    expect(resolvePalette('halloween', OCTOBER_FIRST)).toBe('halloween');
    expect(resolvePalette('ocean', NOVEMBER_FIRST)).toBe('ocean');
  });

  it('falls back when the season is over or the value is unknown', () => {
    expect(resolvePalette('halloween', NOVEMBER_FIRST)).toBe(DEFAULT_PALETTE);
    expect(resolvePalette('sepia', OCTOBER_FIRST)).toBe(DEFAULT_PALETTE);
    expect(resolvePalette(null, OCTOBER_FIRST)).toBe(DEFAULT_PALETTE);
  });
});

describe('storage', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(PALETTE_ATTRIBUTE);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'localStorage');
    vi.useRealTimers();
  });

  it('reads the default when storage is missing', () => {
    Reflect.deleteProperty(window, 'localStorage');

    expect(readStoredPalette(OCTOBER_FIRST)).toBe(DEFAULT_PALETTE);
  });

  it('paints and persists a picked palette, and removes the key for the default', () => {
    const store = installLocalStorage();

    storePalette('ocean');
    expect(store.getItem(PALETTE_STORAGE_KEY)).toBe('ocean');
    expect(document.documentElement.getAttribute(PALETTE_ATTRIBUTE)).toBe(
      'ocean',
    );

    storePalette('default');
    expect(store.getItem(PALETTE_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.getAttribute(PALETTE_ATTRIBUTE)).toBe(
      'default',
    );
  });

  it('paints the stored seasonal palette in its month', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(OCTOBER_FIRST);
    const store = installLocalStorage();
    store.setItem(PALETTE_STORAGE_KEY, 'halloween');

    applyStoredPalette();

    expect(document.documentElement.getAttribute(PALETTE_ATTRIBUTE)).toBe(
      'halloween',
    );
    expect(store.getItem(PALETTE_STORAGE_KEY)).toBe('halloween');
  });

  it('forgets a seasonal palette once its month is over, so it does not return next year', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOVEMBER_FIRST);
    const store = installLocalStorage();
    store.setItem(PALETTE_STORAGE_KEY, 'halloween');

    applyStoredPalette();

    expect(document.documentElement.getAttribute(PALETTE_ATTRIBUTE)).toBe(
      'default',
    );
    expect(store.getItem(PALETTE_STORAGE_KEY)).toBeNull();
  });

  it('does not throw when storage throws', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });

    expect(() => applyStoredPalette()).not.toThrow();
    expect(document.documentElement.getAttribute(PALETTE_ATTRIBUTE)).toBe(
      'default',
    );
  });
});
