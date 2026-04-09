/**
 * @fileoverview Tests for the CalendarHeader component.
 * @module features/calendar/components/__tests__/CalendarHeader.test
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { CalendarHeader } from '../CalendarHeader';
import { enUS } from 'date-fns/locale';

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

  it('displays the month and year', () => {
    render(<CalendarHeader {...defaultProps} />, { withProviders: false });
    expect(screen.getByText(/July 2026/i)).toBeInTheDocument();
  });

  it('renders previous month button with aria-label', () => {
    render(<CalendarHeader {...defaultProps} />, { withProviders: false });
    const prevButton = screen.getByRole('button', { name: 'calendar.previousMonth' });
    expect(prevButton).toBeInTheDocument();
  });

  it('renders next month button with aria-label', () => {
    render(<CalendarHeader {...defaultProps} />, { withProviders: false });
    const nextButton = screen.getByRole('button', { name: 'calendar.nextMonth' });
    expect(nextButton).toBeInTheDocument();
  });

  it('renders today button', () => {
    render(<CalendarHeader {...defaultProps} />, { withProviders: false });
    const todayButtons = screen.getAllByRole('button', { name: 'calendar.today' });
    expect(todayButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('calls onPrevMonth when previous button is clicked', async () => {
    const onPrevMonth = vi.fn();
    const { user } = render(
      <CalendarHeader {...defaultProps} onPrevMonth={onPrevMonth} />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button', { name: 'calendar.previousMonth' }));
    expect(onPrevMonth).toHaveBeenCalledOnce();
  });

  it('calls onNextMonth when next button is clicked', async () => {
    const onNextMonth = vi.fn();
    const { user } = render(
      <CalendarHeader {...defaultProps} onNextMonth={onNextMonth} />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button', { name: 'calendar.nextMonth' }));
    expect(onNextMonth).toHaveBeenCalledOnce();
  });

  it('calls onToday when today button is clicked', async () => {
    const onToday = vi.fn();
    const { user } = render(
      <CalendarHeader {...defaultProps} onToday={onToday} />,
      { withProviders: false },
    );
    const todayButtons = screen.getAllByRole('button', { name: 'calendar.today' });
    await user.click(todayButtons[0]!);
    expect(onToday).toHaveBeenCalledOnce();
  });

  it('updates display when currentMonth changes', () => {
    const { rerender } = render(
      <CalendarHeader {...defaultProps} currentMonth={new Date(2026, 0, 1)} />,
      { withProviders: false },
    );
    expect(screen.getByText(/January 2026/i)).toBeInTheDocument();

    rerender(<CalendarHeader {...defaultProps} currentMonth={new Date(2026, 11, 1)} />);
    expect(screen.getByText(/December 2026/i)).toBeInTheDocument();
  });
});
