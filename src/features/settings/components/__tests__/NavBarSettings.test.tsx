/**
 * @fileoverview Tests for the phone navigation card on the settings page.
 *
 * Rendered through a real i18next, like the theme card beside it: the mode
 * names and their hints come from computed keys
 * (`settings.navBar.modes.${mode}`) that no grep for string literals finds,
 * so only a real catalogue can say they exist in both languages.
 *
 * The drag itself is not driven here. dnd-kit measures rows with
 * `getBoundingClientRect`, which jsdom answers with zeros, so a simulated drag
 * proves nothing; `e2e/mobile-nav-settings.spec.ts` drags in a real browser.
 *
 * @module features/settings/components/__tests__/NavBarSettings.test
 */

import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen, waitFor, within } from '@/test/utils';
import { db } from '@/lib/db';
import { DEFAULT_SETTINGS } from '@/types';

import { NavBarSettings } from '../NavBarSettings';

vi.unmock('i18next');
vi.unmock('react-i18next');

/** The page labels, top to bottom, as the list shows them. */
function rowLabels(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((row) => row.textContent ?? '');
}

describe('NavBarSettings', () => {
  it('shows the default order, four in the bar and the rest in More', async () => {
    await renderWithRealI18n(<NavBarSettings />, { language: 'en' });

    const bar = screen.getByText('In the bottom bar').parentElement as HTMLElement,
      more = screen.getByText('In More').parentElement as HTMLElement;
    expect(within(bar).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Calendar',
      'Rooms',
      'Guests',
      'Money',
    ]);
    expect(within(more).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Activities',
      'Transport',
      'Analytics',
      'Trip settings',
    ]);
    expect(screen.getByRole('button', { name: /restore the default order/i })).toBeDisabled();
  });

  it('follows the stored order', async () => {
    await db.settings.put({
      ...DEFAULT_SETTINGS,
      mobileNavOrder: ['transports', 'calendar', 'rooms', 'persons', 'money', 'activities', 'analytics', 'edit'],
    });

    await renderWithRealI18n(<NavBarSettings />, { language: 'en' });

    await waitFor(() => {
      expect(rowLabels()[0]).toBe('Transport');
    });
    expect(rowLabels()[4]).toBe('Money');
    expect(
      screen.getByRole('button', { name: 'Move Transport, position 1' }),
    ).toBeInTheDocument();
  });

  it('puts the default order back', async () => {
    const user = userEvent.setup();
    await db.settings.put({
      ...DEFAULT_SETTINGS,
      mobileNavOrder: ['transports', 'calendar', 'rooms', 'persons', 'money', 'activities', 'analytics', 'edit'],
    });
    await renderWithRealI18n(<NavBarSettings />, { language: 'en' });
    const restore = screen.getByRole('button', { name: /restore the default order/i });
    await waitFor(() => {
      expect(restore).toBeEnabled();
    });

    await user.click(restore);

    await waitFor(async () => {
      expect((await db.settings.get('settings'))?.mobileNavOrder?.[0]).toBe('calendar');
    });
    await waitFor(() => {
      expect(rowLabels()[0]).toBe('Calendar');
    });
  });

  it('starts on Automatic and saves another mode', async () => {
    const user = userEvent.setup();
    await renderWithRealI18n(<NavBarSettings />, { language: 'en' });

    expect(screen.getByRole('radio', { name: 'Automatic' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Menu button' }));

    await waitFor(async () => {
      expect((await db.settings.get('settings'))?.mobileNavMode).toBe('menu');
    });
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Menu button' })).toBeChecked();
    });
    expect(screen.getByText(/A menu button at the top opens every page/)).toBeInTheDocument();
  });

  it('has every mode and its hint in French', async () => {
    await renderWithRealI18n(<NavBarSettings />, { language: 'fr' });

    for (const name of ['Automatique', 'Barre du bas', 'Bouton menu']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/sauf sur un écran très étroit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Déplacer Calendrier, position 1' })).toBeInTheDocument();
  });
});
