import type { ReactElement, ReactNode } from 'react';

import { ThemeProvider } from 'next-themes';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { render, screen, waitFor } from '@/test/utils';
import { THEME_STORAGE_KEY } from '@/lib/theme';

import { ThemeSelector } from '../ThemeSelector';

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

  it('offers light, dark and system', () => {
    render(withTheme(<ThemeSelector />), { withProviders: false });

    expect(
      screen.getByRole('radio', { name: 'settings.themes.light' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'settings.themes.dark' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'settings.themes.system' }),
    ).toBeInTheDocument();
  });

  it('names the group so the radios are not anonymous', () => {
    render(withTheme(<ThemeSelector />), { withProviders: false });

    expect(
      screen.getByRole('radiogroup', { name: 'settings.theme' }),
    ).toBeInTheDocument();
  });

  it('selects the stored preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    render(withTheme(<ThemeSelector />), { withProviders: false });

    expect(
      screen.getByRole('radio', { name: 'settings.themes.dark' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('radio', { name: 'settings.themes.light' }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('defaults to system when nothing is stored', () => {
    render(withTheme(<ThemeSelector />), { withProviders: false });

    expect(
      screen.getByRole('radio', { name: 'settings.themes.system' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('applies the dark class and persists the choice when dark is picked', async () => {
    const { user } = render(withTheme(<ThemeSelector />), {
      withProviders: false,
    });

    await user.click(screen.getByRole('radio', { name: 'settings.themes.dark' }));

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(
      screen.getByRole('radio', { name: 'settings.themes.dark' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('drops the dark class again when light is picked', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    const { user } = render(withTheme(<ThemeSelector />), {
      withProviders: false,
    });

    await user.click(
      screen.getByRole('radio', { name: 'settings.themes.light' }),
    );

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('renders without a ThemeProvider instead of showing nothing selected', () => {
    render(<ThemeSelector />, { withProviders: false });

    expect(
      screen.getByRole('radio', { name: 'settings.themes.system' }),
    ).toHaveAttribute('aria-checked', 'true');
  });
});
