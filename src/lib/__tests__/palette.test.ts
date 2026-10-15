/**
 * @fileoverview Tests for the palette preferences and the calendar that
 * decides when a seasonal palette takes over.
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
  BASE_PALETTES,
  DEFAULT_PALETTE,
  getPalettePreferences,
  isBasePalette,
  isPalette,
  PALETTE_ATTRIBUTE,
  PALETTE_STORAGE_KEY,
  PALETTES,
  readStoredPalettePreferences,
  resolvePalette,
  SEASONAL_PALETTE_MONTHS,
  SEASONAL_PALETTES_STORAGE_KEY,
  seasonalPaletteFor,
  storeBasePalette,
  storeSeasonalPalettes,
  subscribePalettePreferences,
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

const SEPTEMBER = new Date(2026, 8, 27),
  OCTOBER_FIRST = new Date(2026, 9, 1, 0, 0),
  OCTOBER_LAST = new Date(2026, 9, 31, 23, 59),
  NOVEMBER_FIRST = new Date(2026, 10, 1, 0, 0);

describe('palette identifiers', () => {
  it('accepts every declared palette and nothing else', () => {
    for (const palette of PALETTES) {
      expect(isPalette(palette)).toBe(true);
    }
    expect(isPalette('sepia')).toBe(false);
    expect(isPalette(null)).toBe(false);
  });

  it('offers only the year-round palettes as a base', () => {
    expect(BASE_PALETTES).toEqual(['default', 'ocean', 'forest']);
    expect(isBasePalette('ocean')).toBe(true);
    expect(isBasePalette('halloween')).toBe(false);
  });
});

describe('seasonalPaletteFor', () => {
  it('puts the four occasions in their months', () => {
    expect(SEASONAL_PALETTE_MONTHS).toEqual({
      valentine: 2,
      stpatrick: 3,
      halloween: 10,
      christmas: 12,
    });
    expect(seasonalPaletteFor(new Date(2026, 1, 14))).toBe('valentine');
    expect(seasonalPaletteFor(new Date(2026, 2, 17))).toBe('stpatrick');
    expect(seasonalPaletteFor(new Date(2026, 11, 24))).toBe('christmas');
  });

  it('covers October from its first to its last minute, and nothing either side', () => {
    expect(seasonalPaletteFor(new Date(2026, 8, 30, 23, 59))).toBeUndefined();
    expect(seasonalPaletteFor(OCTOBER_FIRST)).toBe('halloween');
    expect(seasonalPaletteFor(OCTOBER_LAST)).toBe('halloween');
    expect(seasonalPaletteFor(NOVEMBER_FIRST)).toBeUndefined();
  });

  it('leaves the other eight months alone', () => {
    const ordinary = Array.from({ length: 12 }, (_, month) => month).filter(
      (month) => seasonalPaletteFor(new Date(2026, month, 10)) === undefined,
    );

    expect(ordinary).toEqual([0, 3, 4, 5, 6, 7, 8, 10]);
  });
});

describe('resolvePalette', () => {
  it('never paints a seasonal palette while the toggle is off', () => {
    for (let month = 0; month < 12; month += 1) {
      expect(
        resolvePalette({ base: 'ocean', seasonal: false }, new Date(2026, month, 10)),
      ).toBe('ocean');
    }
  });

  it("paints the month's palette over the base when the toggle is on", () => {
    expect(resolvePalette({ base: 'ocean', seasonal: true }, OCTOBER_FIRST)).toBe(
      'halloween',
    );
    expect(resolvePalette({ base: 'forest', seasonal: true }, new Date(2026, 11, 1))).toBe(
      'christmas',
    );
  });

  it('paints the base in an ordinary month even with the toggle on', () => {
    expect(resolvePalette({ base: 'forest', seasonal: true }, SEPTEMBER)).toBe(
      'forest',
    );
    expect(resolvePalette({ base: 'forest', seasonal: true }, NOVEMBER_FIRST)).toBe(
      'forest',
    );
  });
});

describe('stored preferences', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(PALETTE_ATTRIBUTE);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'localStorage');
    vi.useRealTimers();
  });

  it('defaults to the brand palette with seasonal palettes off', () => {
    installLocalStorage();

    expect(readStoredPalettePreferences()).toEqual({
      base: DEFAULT_PALETTE,
      seasonal: false,
    });
  });

  it('reads the defaults when storage is missing or throws', () => {
    expect(readStoredPalettePreferences()).toEqual({
      base: 'default',
      seasonal: false,
    });

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });

    expect(readStoredPalettePreferences()).toEqual({
      base: 'default',
      seasonal: false,
    });
    expect(() => applyStoredPalette()).not.toThrow();
  });

  it('reads a seasonal palette stored as the base by the earlier build as the default', () => {
    const store = installLocalStorage();
    store.setItem(PALETTE_STORAGE_KEY, 'halloween');

    expect(readStoredPalettePreferences().base).toBe('default');
  });

  it('stores each choice, and removes the key for its default', () => {
    const store = installLocalStorage();

    storeBasePalette('ocean');
    storeSeasonalPalettes(true);
    expect(store.getItem(PALETTE_STORAGE_KEY)).toBe('ocean');
    expect(store.getItem(SEASONAL_PALETTES_STORAGE_KEY)).toBe('on');

    storeBasePalette('default');
    storeSeasonalPalettes(false);
    expect(store.getItem(PALETTE_STORAGE_KEY)).toBeNull();
    expect(store.getItem(SEASONAL_PALETTES_STORAGE_KEY)).toBeNull();
  });

  it('tells subscribers about a write, and hands back the same object until one', () => {
    installLocalStorage();
    const listener = vi.fn(),
      unsubscribe = subscribePalettePreferences(listener),
      before = getPalettePreferences();

    expect(getPalettePreferences()).toBe(before);

    storeSeasonalPalettes(true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPalettePreferences()).toEqual({ base: 'default', seasonal: true });
    expect(getPalettePreferences()).not.toBe(before);

    unsubscribe();
  });

  it('follows a write made in another tab', () => {
    const store = installLocalStorage(),
      listener = vi.fn(),
      unsubscribe = subscribePalettePreferences(listener);

    store.setItem(PALETTE_STORAGE_KEY, 'forest');
    window.dispatchEvent(new StorageEvent('storage', { key: PALETTE_STORAGE_KEY }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPalettePreferences().base).toBe('forest');

    unsubscribe();
  });

  it("paints the month's palette before the first frame when the toggle is on", () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(OCTOBER_FIRST);
    const store = installLocalStorage();
    store.setItem(PALETTE_STORAGE_KEY, 'ocean');
    store.setItem(SEASONAL_PALETTES_STORAGE_KEY, 'on');

    applyStoredPalette();

    expect(document.documentElement.getAttribute(PALETTE_ATTRIBUTE)).toBe(
      'halloween',
    );
  });

  it('paints the base before the first frame when the toggle is off', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(OCTOBER_FIRST);
    const store = installLocalStorage();
    store.setItem(PALETTE_STORAGE_KEY, 'ocean');

    applyStoredPalette();

    expect(document.documentElement.getAttribute(PALETTE_ATTRIBUTE)).toBe(
      'ocean',
    );
  });
});
