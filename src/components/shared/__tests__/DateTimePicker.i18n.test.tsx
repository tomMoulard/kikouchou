/**
 * @fileoverview The date and time control's long date, in the reader's own
 * language.
 *
 * The suite-wide i18n mock pins the language to English, so only the real
 * catalogue can show that the date follows the reader's locale.
 *
 * @module components/shared/__tests__/DateTimePicker.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { renderSwitchingLanguage, renderWithRealI18n, screen } from '@/test/utils';

import { DateTimePicker } from '../DateTimePicker';

// Hoisted above the imports: the real i18next, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

describe('DateTimePicker in French', () => {
  it('writes the date out the French way', async () => {
    await renderWithRealI18n(
      <DateTimePicker
        id="pickup"
        value="2026-03-10T09:30"
        onChange={vi.fn()}
        dateLabel="Date de prise en charge"
        timeLabel="Heure de prise en charge"
      />,
      { language: 'fr', withProviders: false },
    );

    expect(screen.getByRole('button', { name: 'Date de prise en charge' })).toHaveTextContent('10 mars 2026');
  });
});

describe('DateTimePicker across a language switch', () => {
  it('rewrites the date in the new language without being remounted', async () => {
    const { switchTo } = await renderSwitchingLanguage(
      <DateTimePicker
        id="pickup"
        value="2026-03-10T09:30"
        onChange={vi.fn()}
        dateLabel="Pickup date"
        timeLabel="Pickup time"
      />,
      { withProviders: false },
    );
    expect(screen.getByRole('button', { name: 'Pickup date' })).toHaveTextContent('March 10th, 2026');

    await switchTo('fr');

    expect(screen.getByRole('button', { name: 'Pickup date' })).toHaveTextContent('10 mars 2026');
  });
});
