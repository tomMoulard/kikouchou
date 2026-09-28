/**
 * @fileoverview Tests for the colour palette picker and the seasonal toggle
 * beside it.
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
import { PaletteSync } from '@/components/shared/PaletteSync';
import {
  PALETTE_ATTRIBUTE,
  PALETTE_STORAGE_KEY,
  SEASONAL_PALETTES_STORAGE_KEY,
} from '@/lib/palette';

import { PalettePicker } from '../PalettePicker';
import { SeasonalPalettesToggle } from '../SeasonalPalettesToggle';

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

/**
 * The settings row as the theme card renders it, plus the app-level painter.
 */
function SettingsRow(): React.ReactElement {
  return (
    <>
      <PalettePicker />
      <SeasonalPalettesToggle />
      <PaletteSync />
    </>
  );
}

function painted(): string | null {
  return document.documentElement.getAttribute(PALETTE_ATTRIBUTE);
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

  it('offers only the year-round palettes, even in October', async () => {
    pretendItIs(new Date(2026, 9, 12));

    await renderWithRealI18n(<PalettePicker />, { withProviders: false });

    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual(
      ['Sunset', 'Ocean', 'Forest'],
    );
    expect(screen.getByRole('radio', { name: 'Sunset' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('names the options and the toggle in French', async () => {
    await renderWithRealI18n(<SettingsRow />, {
      language: 'fr',
      withProviders: false,
    });

    expect(screen.getByRole('radiogroup', { name: 'Couleurs' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Soleil couchant' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Thèmes de saison' })).toBeInTheDocument();
  });

  it('paints, stores and reports a pick', async () => {
    pretendItIs(new Date(2026, 8, 27));

    const { user } = await renderWithRealI18n(<SettingsRow />, {
      withProviders: false,
    });

    await user.click(screen.getByRole('radio', { name: 'Ocean' }));

    expect(painted()).toBe('ocean');
    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('ocean');
    expect(screen.getByRole('radio', { name: 'Ocean' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      captureEvent.mock.calls.find(([event]) => event === 'palette_changed'),
    ).toEqual(['palette_changed', { palette: 'ocean' }]);
  });

  it('moves the selection with the arrow keys and wraps around', async () => {
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
});

describe('SeasonalPalettesToggle', () => {
  beforeEach(() => {
    installLocalStorage();
    captureEvent.mockClear();
    document.documentElement.removeAttribute(PALETTE_ATTRIBUTE);
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'localStorage');
  });

  it('is off by default, and October stays in the chosen colors', async () => {
    pretendItIs(new Date(2026, 9, 12));
    window.localStorage.setItem(PALETTE_STORAGE_KEY, 'forest');

    await renderWithRealI18n(<SettingsRow />, { withProviders: false });

    expect(screen.getByRole('switch', { name: 'Seasonal themes' })).not.toBeChecked();
    expect(painted()).toBe('forest');
    expect(screen.queryByText(/This month:/)).toBeNull();
  });

  it("switches to the month's palette when turned on, and back when turned off", async () => {
    pretendItIs(new Date(2026, 9, 12));
    window.localStorage.setItem(PALETTE_STORAGE_KEY, 'forest');

    const { user } = await renderWithRealI18n(<SettingsRow />, {
      withProviders: false,
    });
    const toggle = screen.getByRole('switch', { name: 'Seasonal themes' });

    await user.click(toggle);

    expect(toggle).toBeChecked();
    expect(painted()).toBe('halloween');
    expect(window.localStorage.getItem(SEASONAL_PALETTES_STORAGE_KEY)).toBe('on');
    expect(screen.getByText('This month: Halloween')).toBeInTheDocument();
    // The picker still shows the user's own choice under the seasonal one.
    expect(screen.getByRole('radio', { name: 'Forest' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      captureEvent.mock.calls.find(([event]) => event === 'seasonal_palettes_toggled'),
    ).toEqual(['seasonal_palettes_toggled', { enabled: true }]);

    await user.click(toggle);

    expect(painted()).toBe('forest');
    expect(window.localStorage.getItem(SEASONAL_PALETTES_STORAGE_KEY)).toBeNull();
  });

  it('keeps the chosen colors in an ordinary month when on', async () => {
    pretendItIs(new Date(2026, 8, 27));
    window.localStorage.setItem(PALETTE_STORAGE_KEY, 'ocean');
    window.localStorage.setItem(SEASONAL_PALETTES_STORAGE_KEY, 'on');

    await renderWithRealI18n(<SettingsRow />, { withProviders: false });

    expect(screen.getByRole('switch', { name: 'Seasonal themes' })).toBeChecked();
    expect(painted()).toBe('ocean');
    expect(screen.queryByText(/This month:/)).toBeNull();
  });

  it("brings the month's palette in at midnight, and hands the colors back a month later", async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59));
    window.localStorage.setItem(PALETTE_STORAGE_KEY, 'ocean');
    window.localStorage.setItem(SEASONAL_PALETTES_STORAGE_KEY, 'on');

    await renderWithRealI18n(<PaletteSync />, { withProviders: false });
    expect(painted()).toBe('ocean');

    await act(async () => {
      vi.setSystemTime(new Date(2026, 9, 1, 0, 1));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(painted()).toBe('halloween');

    await act(async () => {
      vi.setSystemTime(new Date(2026, 10, 1, 0, 1));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(painted()).toBe('ocean');
  });
});
