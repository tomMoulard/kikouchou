/**
 * @fileoverview Tests for the CalendarHeader component.
 *
 * Rendered through a real i18next rather than the suite-wide mock, because
 * every control here is an icon and its accessible name is the only label it
 * has. Under the mock those names are the keys themselves — a blind user
 * hearing "calendar.previousMonth" and a test asserting
 * `{ name: 'calendar.previousMonth' }` are indistinguishable, and the test
 * passes either way. `calendar.today` is the sharpest case: it is passed to
 * `t()` with no inline default, so losing the key puts the raw string on a
 * button. The other two pass inline defaults that repeat the English catalogue
 * word for word, so their English assertions are backstopped by the component
 * itself; the French pass is what can only come from the bundle.
 *
 * @module features/calendar/components/__tests__/CalendarHeader.test
 */

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { enUS, fr } from 'date-fns/locale';

import { renderWithRealI18n } from '@/test/utils';

import { CalendarHeader } from '../CalendarHeader';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered — for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Tests
// ============================================================================

describe('CalendarHeader', () => {
  const defaultProps = {
    currentMonth: new Date(2026, 6, 1), // July 2026
    onPrevMonth: vi.fn(),
    onNextMonth: vi.fn(),
    onToday: vi.fn(),
    dateLocale: enUS,
  };

  it('displays the month and year', async () => {
    await renderWithRealI18n(<CalendarHeader {...defaultProps} />, {
      withProviders: false,
    });

    expect(screen.getByText(/July 2026/i)).toBeInTheDocument();
  });

  it('names the previous month button for screen readers', async () => {
    await renderWithRealI18n(<CalendarHeader {...defaultProps} />, {
      withProviders: false,
    });

    expect(
      screen.getByRole('button', { name: 'Previous month' }),
    ).toBeInTheDocument();
  });

  it('names the next month button for screen readers', async () => {
    await renderWithRealI18n(<CalendarHeader {...defaultProps} />, {
      withProviders: false,
    });

    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();
  });

  it('renders today button', async () => {
    await renderWithRealI18n(<CalendarHeader {...defaultProps} />, {
      withProviders: false,
    });

    // Two of them: the labelled desktop button and the icon-only mobile one,
    // which carries the same string as its aria-label.
    expect(screen.getAllByRole('button', { name: 'Today' })).toHaveLength(2);
  });

  it('names all three controls in French', async () => {
    await renderWithRealI18n(
      <CalendarHeader {...defaultProps} dateLocale={fr} />,
      { language: 'fr', withProviders: false },
    );

    expect(screen.getByRole('button', { name: 'Mois précédent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mois suivant' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: "Aujourd'hui" })).toHaveLength(2);
    expect(screen.getByText(/juillet 2026/i)).toBeInTheDocument();
  });

  it('calls onPrevMonth when previous button is clicked', async () => {
    const onPrevMonth = vi.fn();
    const { user } = await renderWithRealI18n(
      <CalendarHeader {...defaultProps} onPrevMonth={onPrevMonth} />,
      { withProviders: false },
    );

    await user.click(screen.getByRole('button', { name: 'Previous month' }));

    expect(onPrevMonth).toHaveBeenCalledOnce();
  });

  it('calls onNextMonth when next button is clicked', async () => {
    const onNextMonth = vi.fn();
    const { user } = await renderWithRealI18n(
      <CalendarHeader {...defaultProps} onNextMonth={onNextMonth} />,
      { withProviders: false },
    );

    await user.click(screen.getByRole('button', { name: 'Next month' }));

    expect(onNextMonth).toHaveBeenCalledOnce();
  });

  it('calls onToday when today button is clicked', async () => {
    const onToday = vi.fn();
    const { user } = await renderWithRealI18n(
      <CalendarHeader {...defaultProps} onToday={onToday} />,
      { withProviders: false },
    );
    const todayButtons = screen.getAllByRole('button', { name: 'Today' });

    await user.click(todayButtons[0]!);

    expect(onToday).toHaveBeenCalledOnce();
  });

  it('updates display when currentMonth changes', async () => {
    const { rerender } = await renderWithRealI18n(
      <CalendarHeader {...defaultProps} currentMonth={new Date(2026, 0, 1)} />,
      { withProviders: false },
    );
    expect(screen.getByText(/January 2026/i)).toBeInTheDocument();

    rerender(<CalendarHeader {...defaultProps} currentMonth={new Date(2026, 11, 1)} />);
    expect(screen.getByText(/December 2026/i)).toBeInTheDocument();
  });
});
