/**
 * @fileoverview The date range picker's trigger text, through the shipped
 * catalogues and the reader's own date format.
 *
 * The suite-wide i18n mock pins the language to English and echoes keys, so
 * it can show neither that the dates are written in the reader's locale nor
 * that the start date reaches the "select end date" sentence.
 *
 * @module components/shared/__tests__/DateRangePicker.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { renderSwitchingLanguage, renderWithRealI18n, screen } from '@/test/utils';

import { DateRangePicker } from '../DateRangePicker';

// Hoisted above the imports: the real i18next, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

describe('DateRangePicker in French', () => {
  it('writes a range in the French date format', async () => {
    await renderWithRealI18n(
      <DateRangePicker
        value={{ from: new Date(2024, 6, 15), to: new Date(2024, 6, 18) }}
        onChange={vi.fn()}
      />,
      { language: 'fr', withProviders: false },
    );

    expect(screen.getByText('15 juil. 2024 → 18 juil. 2024')).toBeInTheDocument();
  });

  it('puts the French start date into the "select end date" sentence', async () => {
    await renderWithRealI18n(
      <DateRangePicker value={{ from: new Date(2024, 6, 15), to: undefined }} onChange={vi.fn()} />,
      { language: 'fr', withProviders: false },
    );

    expect(screen.getByText('15 juil. 2024 → sélectionner la fin')).toBeInTheDocument();
  });
});

describe('DateRangePicker across a language switch', () => {
  it('rewrites the range in the new language without being remounted', async () => {
    const { switchTo } = await renderSwitchingLanguage(
      <DateRangePicker value={{ from: new Date(2024, 6, 15), to: new Date(2024, 6, 18) }} onChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByText('Jul 15, 2024 → Jul 18, 2024')).toBeInTheDocument();

    await switchTo('fr');

    expect(screen.getByText('15 juil. 2024 → 18 juil. 2024')).toBeInTheDocument();
  });
});
