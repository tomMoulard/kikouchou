import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyStoredTheme,
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  readStoredThemePreference,
  resolveThemePreference,
  THEME_STORAGE_KEY,
} from '@/lib/theme';

/**
 * jsdom in this suite exposes no `localStorage` at all (see the other test
 * files that stub it), which is itself one of the states the module has to
 * survive. Tests that need a working store install this one.
 *
 * @returns The installed store, for direct inspection
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

/**
 * Replaces the global `matchMedia` mock with one that answers the
 * prefers-color-scheme query.
 *
 * @param prefersDark - What the operating system should claim to prefer
 */
function mockPrefersDark(prefersDark: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: prefersDark && query.includes('prefers-color-scheme: dark'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('lib/theme', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    installLocalStorage();
    document.documentElement.className = '';
    document.documentElement.style.colorScheme = '';
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'localStorage');
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  describe('isThemePreference', () => {
    it('accepts the three supported preferences', () => {
      expect(isThemePreference('light')).toBe(true);
      expect(isThemePreference('dark')).toBe(true);
      expect(isThemePreference('system')).toBe(true);
    });

    it('rejects anything else', () => {
      expect(isThemePreference('sepia')).toBe(false);
      expect(isThemePreference(null)).toBe(false);
      expect(isThemePreference(undefined)).toBe(false);
      expect(isThemePreference(1)).toBe(false);
    });
  });

  describe('readStoredThemePreference', () => {
    it('returns the stored preference', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      expect(readStoredThemePreference()).toBe('dark');
    });

    it('falls back to the default when nothing is stored', () => {
      expect(readStoredThemePreference()).toBe(DEFAULT_THEME_PREFERENCE);
    });

    it('falls back to the default on an unrecognised stored value', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'solarized');
      expect(readStoredThemePreference()).toBe(DEFAULT_THEME_PREFERENCE);
    });

    it('falls back to the default when reading storage throws', () => {
      vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
        throw new Error('The operation is insecure.');
      });

      expect(readStoredThemePreference()).toBe(DEFAULT_THEME_PREFERENCE);
    });

    it('falls back to the default when there is no storage at all', () => {
      Reflect.deleteProperty(window, 'localStorage');

      expect(readStoredThemePreference()).toBe(DEFAULT_THEME_PREFERENCE);
    });
  });

  describe('resolveThemePreference', () => {
    it('passes an explicit preference straight through', () => {
      mockPrefersDark(true);
      expect(resolveThemePreference('light')).toBe('light');

      mockPrefersDark(false);
      expect(resolveThemePreference('dark')).toBe('dark');
    });

    it('follows the operating system for "system"', () => {
      mockPrefersDark(true);
      expect(resolveThemePreference('system')).toBe('dark');

      mockPrefersDark(false);
      expect(resolveThemePreference('system')).toBe('light');
    });

    it('resolves to light when matchMedia is unavailable', () => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: undefined,
      });

      expect(resolveThemePreference('system')).toBe('light');
    });
  });

  describe('applyStoredTheme', () => {
    it('writes the resolved class and colour scheme onto the root element', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      mockPrefersDark(false);

      applyStoredTheme();

      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });

    it('resolves "system" against the operating system', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
      mockPrefersDark(true);

      applyStoredTheme();

      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('removes the previous theme class instead of stacking classes', () => {
      document.documentElement.classList.add('dark');
      window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
      mockPrefersDark(true);

      applyStoredTheme();

      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });

    it('normalises an unrecognised stored value so next-themes cannot diverge', () => {
      // next-themes reads `localStorage.getItem(key) || defaultTheme` with no
      // validation, so leaving 'sepia' in storage would have it add a `sepia`
      // class and strip the one applied here.
      window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
      mockPrefersDark(false);

      applyStoredTheme();

      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(
        DEFAULT_THEME_PREFERENCE,
      );
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });

    it('leaves a valid stored value untouched', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      mockPrefersDark(false);

      applyStoredTheme();

      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });

    it('does not throw when the root element cannot be written to', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      mockPrefersDark(false);
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      vi.spyOn(document.documentElement.classList, 'add').mockImplementation(
        () => {
          throw new Error('read-only');
        },
      );

      // App.tsx calls this at module scope on the boot path, so a throw here
      // would blank the app before React renders.
      expect(() => applyStoredTheme()).not.toThrow();
      expect(consoleError).toHaveBeenCalled();
    });

    it('leaves unrelated classes on the root element alone', () => {
      document.documentElement.classList.add('js-enabled');
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      mockPrefersDark(false);

      applyStoredTheme();

      expect(document.documentElement.classList.contains('js-enabled')).toBe(
        true,
      );
    });
  });
});
