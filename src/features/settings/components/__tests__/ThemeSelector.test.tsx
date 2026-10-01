/**
 * @fileoverview Tests for the theme preference card.
 *
 * Rendered through a real i18next rather than the suite-wide mock, because the
 * three radios are icons and their accessible names are all that tells them
 * apart. Those names come from a *computed* key —
 * `t(`settings.themes.${preference}`, preference)` — which no grep for string
 * literals will find in the catalogue, and whose inline default is the raw
 * preference value. Lose `settings.themes.dark` and the control reads "dark"
 * (or, once English falls back to French, "Sombre"); assert the key and the
 * test cannot tell.
 *
 * @module features/settings/components/__tests__/ThemeSelector.test
 */

import type { ReactElement, ReactNode } from 'react';

import { ThemeProvider } from 'next-themes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen, waitFor } from '@/test/utils';
import { THEME_STORAGE_KEY } from '@/lib/theme';

import { ThemeSelector } from '../ThemeSelector';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered — for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

/**
 * jsdom in this suite exposes no `localStorage`, and `next-themes` swallows the
 * resulting error, so without a store the persistence assertions below would
 * pass vacuously.
 */
function installLocalStorage(): void {
  const entries = new Map<string, string>();

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      get length(): number {
        return entries.size;
      },
      clear: () => entries.clear(),
      getItem: (key: string) => entries.get(key) ?? null,
      key: (index: number) => [...entries.keys()][index] ?? null,
      removeItem: (key: string) => {
        entries.delete(key);
      },
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
    } satisfies Storage,
  });
}

/**
 * Wraps the selector in the same provider `App.tsx` mounts, with the same
 * props, so the test exercises the real storage and class-writing behaviour
 * rather than a stub.
 *
 * `disableTransitionOnChange` is repeated deliberately even though it looks
 * cosmetic: it is the one prop with side effects, appending a
 * `*{transition:none}` style element to `document.head` and removing it on a
 * timer at every theme change. Omitting it here would have the tests exercise
 * a code path production never takes.
 *
 * @param children - Element under test
 * @returns The wrapped element
 */
function withTheme(children: ReactNode): ReactElement {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      storageKey={THEME_STORAGE_KEY}
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}

describe('ThemeSelector', () => {
  beforeEach(() => {
    installLocalStorage();
    document.documentElement.className = '';
  });

  afterEach(() => {
    Reflect.deleteProperty(window, 'localStorage');
  });

  it('offers light, dark and system', async () => {
    await renderWithRealI18n(withTheme(<ThemeSelector />), {
      withProviders: false,
    });

    expect(
      screen.getByRole('radio', { name: 'Light' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Dark' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'System' }),
    ).toBeInTheDocument();
  });

  it('names the group so the radios are not anonymous', async () => {
    await renderWithRealI18n(withTheme(<ThemeSelector />), {
      withProviders: false,
    });

    expect(
      screen.getByRole('radiogroup', { name: 'Theme' }),
    ).toBeInTheDocument();
  });

  it('names all three options in French', async () => {
    await renderWithRealI18n(withTheme(<ThemeSelector />), {
      language: 'fr',
      withProviders: false,
    });

    // The suite-wide mock hardcodes `language: 'en'`, so this is the only kind
    // of assertion in the repo that can catch a missing French option label —
    // and French is the app's fallback, so it is what a key gap surfaces as.
    expect(screen.getByRole('radio', { name: 'Clair' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Sombre' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Système' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Thème' })).toBeInTheDocument();
  });

  it('selects the stored preference', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    await renderWithRealI18n(withTheme(<ThemeSelector />), {
      withProviders: false,
    });

    expect(
      screen.getByRole('radio', { name: 'Dark' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('radio', { name: 'Light' }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('defaults to system when nothing is stored', async () => {
    await renderWithRealI18n(withTheme(<ThemeSelector />), {
      withProviders: false,
    });

    expect(
      screen.getByRole('radio', { name: 'System' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('applies the dark class and persists the choice when dark is picked', async () => {
    const { user } = await renderWithRealI18n(withTheme(<ThemeSelector />), {
      withProviders: false,
    });

    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(
      screen.getByRole('radio', { name: 'Dark' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('drops the dark class again when light is picked', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    const { user } = await renderWithRealI18n(withTheme(<ThemeSelector />), {
      withProviders: false,
    });

    await user.click(
      screen.getByRole('radio', { name: 'Light' }),
    );

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('renders without a ThemeProvider instead of showing nothing selected', async () => {
    await renderWithRealI18n(<ThemeSelector />, { withProviders: false });

    expect(
      screen.getByRole('radio', { name: 'System' }),
    ).toHaveAttribute('aria-checked', 'true');
  });
});
