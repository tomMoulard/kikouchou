/**
 * @fileoverview Tests for the colour palette picker.
 *
 * Rendered through a real i18next, as `ThemeSelector.test.tsx` is: the option
 * names come from computed keys (`settings.palettes.${palette}`) that no grep
 * for string literals finds.
 *
 * @module features/settings/components/__tests__/PalettePicker.test
 */

import { act } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen } from '@/test/utils';
import { PALETTE_ATTRIBUTE, PALETTE_STORAGE_KEY } from '@/lib/palette';

import { PalettePicker } from '../PalettePicker';

vi.unmock('i18next');
vi.unmock('react-i18next');

const captureEvent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  captureEvent,
}));

/**
 * jsdom in this suite exposes no `localStorage`; install a working one.
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
 * Pins the clock to a local day, so the seasonal gate is deterministic.
 *
 * @param date - The day to pretend it is
 */
function pretendItIs(date: Date): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(date);
}

describe('PalettePicker', () => {
  beforeEach(() => {
    installLocalStorage();
    captureEvent.mockClear();
    document.documentElement.removeAttribute(PALETTE_ATTRIBUTE);
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'localStorage');
  });

  it('offers only the year-round palettes out of season', async () => {
    pretendItIs(new Date(2026, 8, 27));

    await renderWithRealI18n(<PalettePicker />, { withProviders: false });

    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual(
      ['Sunset', 'Ocean', 'Forest'],
    );
    expect(screen.getByRole('radio', { name: 'Sunset' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('reveals Halloween in October, marked as seasonal', async () => {
    pretendItIs(new Date(2026, 9, 12));

    await renderWithRealI18n(<PalettePicker />, { withProviders: false });

    expect(
      screen.getByRole('radio', { name: /Halloween.*This month only/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Christmas/ })).toBeNull();
  });

  it('names the options in French', async () => {
    pretendItIs(new Date(2026, 11, 3));

    await renderWithRealI18n(<PalettePicker />, {
      language: 'fr',
      withProviders: false,
    });

    expect(screen.getByRole('radiogroup', { name: 'Couleurs' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Soleil couchant' })).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /Noël.*Ce mois-ci seulement/ }),
    ).toBeInTheDocument();
  });

  it('paints, stores and reports a pick', async () => {
    pretendItIs(new Date(2026, 9, 12));

    const { user } = await renderWithRealI18n(<PalettePicker />, {
      withProviders: false,
    });

    await user.click(screen.getByRole('radio', { name: /Halloween/ }));

    expect(document.documentElement.getAttribute(PALETTE_ATTRIBUTE)).toBe(
      'halloween',
    );
    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('halloween');
    expect(screen.getByRole('radio', { name: /Halloween/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      captureEvent.mock.calls.find(([event]) => event === 'palette_changed'),
    ).toEqual(['palette_changed', { palette: 'halloween', seasonal: true }]);
  });

  it('shows a stored seasonal palette as the default once its month is over', async () => {
    pretendItIs(new Date(2026, 10, 1));
    window.localStorage.setItem(PALETTE_STORAGE_KEY, 'halloween');

    await renderWithRealI18n(<PalettePicker />, { withProviders: false });

    expect(screen.getByRole('radio', { name: 'Sunset' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('moves the selection with the arrow keys and wraps around', async () => {
    pretendItIs(new Date(2026, 8, 27));

    const { user } = await renderWithRealI18n(<PalettePicker />, {
      withProviders: false,
    });

    await user.click(screen.getByRole('radio', { name: 'Forest' }));
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('radio', { name: 'Sunset' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Sunset' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}');

    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('forest');
  });

  it('drops Halloween at midnight on 31 October without a reload', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2026, 9, 31, 23, 59));
    window.localStorage.setItem(PALETTE_STORAGE_KEY, 'halloween');

    await renderWithRealI18n(<PalettePicker />, { withProviders: false });
    expect(screen.getByRole('radio', { name: /Halloween/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await act(async () => {
      vi.setSystemTime(new Date(2026, 10, 1, 0, 1));
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.queryByRole('radio', { name: /Halloween/ })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Sunset' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(document.documentElement.getAttribute(PALETTE_ATTRIBUTE)).toBe(
      'default',
    );
    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBeNull();
  });
});
