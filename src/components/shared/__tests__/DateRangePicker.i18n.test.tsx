/**
 * @fileoverview The date range picker's labels and booked ranges, through the
 * shipped catalogues and the reader's own date format.
 *
 * The suite-wide i18n mock pins the language to English and echoes keys, so
 * it can show neither the shipped labels nor that the booked ranges are
 * written in the reader's locale.
 *
 * @module components/shared/__tests__/DateRangePicker.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { renderSwitchingLanguage, renderWithRealI18n, screen } from '@/test/utils';

import { DateRangePicker } from '../DateRangePicker';

// Hoisted above the imports: the real i18next, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

const BOOKED = [{ from: new Date(2024, 6, 15), to: new Date(2024, 6, 18), label: 'Alice' }];

describe('DateRangePicker in French', () => {
  it('labels the two inputs in French', async () => {
    await renderWithRealI18n(
      <DateRangePicker value={undefined} onChange={vi.fn()} />,
      { language: 'fr', withProviders: false },
    );

    expect(screen.getByLabelText('Du')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Au')).toHaveAttribute('type', 'date');
  });

  it('writes a booked range in the French date format', async () => {
    await renderWithRealI18n(
      <DateRangePicker value={undefined} onChange={vi.fn()} bookedRanges={BOOKED} />,
      { language: 'fr', withProviders: false },
    );

    expect(
      screen.getByText('Déjà assigné : Alice (15 juil. 2024 → 18 juil. 2024)'),
    ).toBeInTheDocument();
  });
});

describe('DateRangePicker across a language switch', () => {
  it('rewrites the booked ranges in the new language without being remounted', async () => {
    const { switchTo } = await renderSwitchingLanguage(
      <DateRangePicker value={undefined} onChange={vi.fn()} bookedRanges={BOOKED} />,
      { withProviders: false },
    );
    expect(
      screen.getByText('Already assigned: Alice (Jul 15, 2024 → Jul 18, 2024)'),
    ).toBeInTheDocument();

    await switchTo('fr');

    expect(
      screen.getByText('Déjà assigné : Alice (15 juil. 2024 → 18 juil. 2024)'),
    ).toBeInTheDocument();
  });
});
