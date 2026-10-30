/**
 * DateRangePicker Component Tests
 *
 * Tests for the DateRangePicker component including:
 * - Basic rendering of the two native date inputs
 * - Date selection behavior
 * - The end never going before the start
 * - Booked ranges and clearing
 *
 * The suite-wide i18n mock echoes keys, so the inputs are found by their
 * `dateRangePicker.start` / `dateRangePicker.end` labels.
 *
 * @module components/shared/__tests__/DateRangePicker.test
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test/utils';
import userEvent from '@testing-library/user-event';

import { DateRangePicker, type DateRange } from '../DateRangePicker';

// ============================================================================
// Helpers
// ============================================================================

function startInput(): HTMLInputElement {
  return screen.getByLabelText('dateRangePicker.start');
}

function endInput(): HTMLInputElement {
  return screen.getByLabelText('dateRangePicker.end');
}

/**
 * Sets a native date input the way a browser does when its picker closes: one
 * `change` with the whole `YYYY-MM-DD` value.
 */
function pick(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

/** The one range the last `onChange` call reported. */
function lastRange(onChange: ReturnType<typeof vi.fn>): DateRange | undefined {
  return onChange.mock.lastCall?.[0] as DateRange | undefined;
}

// ============================================================================
// Tests
// ============================================================================

describe('DateRangePicker', () => {
  describe('Basic Rendering', () => {
    it('renders two empty date inputs when no value is set', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, { withProviders: false });

      expect(startInput()).toHaveAttribute('type', 'date');
      expect(endInput()).toHaveAttribute('type', 'date');
      expect(startInput()).toHaveValue('');
      expect(endInput()).toHaveValue('');
    });

    it('shows the selected range in the inputs', () => {
      render(
        <DateRangePicker
          value={{ from: new Date(2024, 6, 15), to: new Date(2024, 6, 18) }}
          onChange={vi.fn()}
        />,
        { withProviders: false },
      );

      expect(startInput()).toHaveValue('2024-07-15');
      expect(endInput()).toHaveValue('2024-07-18');
    });

    it('names the group with the aria-label, or a default', () => {
      const { rerender } = render(
        <DateRangePicker value={undefined} onChange={vi.fn()} />,
        { withProviders: false },
      );
      expect(screen.getByRole('group', { name: 'dateRangePicker.ariaLabel' })).toBeInTheDocument();

      rerender(<DateRangePicker value={undefined} onChange={vi.fn()} aria-label="Trip dates" />);
      expect(screen.getByRole('group', { name: 'Trip dates' })).toBeInTheDocument();
    });

    it('gives the start input the id and the end input `${id}-end`', () => {
      render(<DateRangePicker id="dates" value={undefined} onChange={vi.fn()} />, {
        withProviders: false,
      });

      expect(startInput()).toHaveAttribute('id', 'dates');
      expect(endInput()).toHaveAttribute('id', 'dates-end');
    });

    it('disables both inputs', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} disabled />, {
        withProviders: false,
      });

      expect(startInput()).toBeDisabled();
      expect(endInput()).toBeDisabled();
    });
  });

  describe('Date Selection', () => {
    it('reports a start date on its own', () => {
      const onChange = vi.fn();
      render(<DateRangePicker value={undefined} onChange={onChange} />, { withProviders: false });

      pick(startInput(), '2024-07-15');

      expect(lastRange(onChange)).toEqual({ from: new Date(2024, 6, 15), to: undefined });
    });

    it('reports an end date alongside the start', () => {
      const onChange = vi.fn();
      render(
        <DateRangePicker value={{ from: new Date(2024, 6, 15), to: undefined }} onChange={onChange} />,
        { withProviders: false },
      );

      pick(endInput(), '2024-07-18');

      expect(lastRange(onChange)).toEqual({
        from: new Date(2024, 6, 15),
        to: new Date(2024, 6, 18),
      });
    });

    it('drops an end date the new start has overtaken', () => {
      const onChange = vi.fn();
      render(
        <DateRangePicker
          value={{ from: new Date(2024, 6, 15), to: new Date(2024, 6, 18) }}
          onChange={onChange}
        />,
        { withProviders: false },
      );

      pick(startInput(), '2024-07-20');

      expect(lastRange(onChange)).toEqual({ from: new Date(2024, 6, 20), to: undefined });
    });

    it('keeps an end date the new start has not overtaken', () => {
      const onChange = vi.fn();
      render(
        <DateRangePicker
          value={{ from: new Date(2024, 6, 15), to: new Date(2024, 6, 18) }}
          onChange={onChange}
        />,
        { withProviders: false },
      );

      pick(startInput(), '2024-07-18');

      expect(lastRange(onChange)).toEqual({
        from: new Date(2024, 6, 18),
        to: new Date(2024, 6, 18),
      });
    });

    it('reports undefined once both inputs are empty', () => {
      const onChange = vi.fn();
      render(
        <DateRangePicker value={{ from: new Date(2024, 6, 15), to: undefined }} onChange={onChange} />,
        { withProviders: false },
      );

      pick(startInput(), '');

      expect(onChange).toHaveBeenLastCalledWith(undefined);
    });
  });

  describe('Constraints', () => {
    it('keeps the end from going before the start', () => {
      render(
        <DateRangePicker value={{ from: new Date(2024, 6, 15), to: undefined }} onChange={vi.fn()} />,
        { withProviders: false },
      );

      expect(endInput()).toHaveAttribute('min', '2024-07-15');
    });

    it('bounds nothing else, since the trip dates are indicative', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, { withProviders: false });

      expect(startInput()).not.toHaveAttribute('min');
      expect(startInput()).not.toHaveAttribute('max');
      expect(endInput()).not.toHaveAttribute('min');
      expect(endInput()).not.toHaveAttribute('max');
    });
  });

  describe('Booked ranges', () => {
    it('lists the booked ranges', () => {
      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          bookedRanges={[{ from: new Date(2024, 6, 14), to: new Date(2024, 6, 15), label: 'Alice' }]}
        />,
        { withProviders: false },
      );

      // The mock echoes the key; the ranges themselves are written out in
      // DateRangePicker.i18n.test.tsx, through the real catalogue.
      expect(screen.getByText('dateRangePicker.alreadyBooked')).toBeInTheDocument();
    });

    it('skips a booked range with an invalid date', () => {
      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          bookedRanges={[{ from: new Date('nope'), to: new Date(2024, 6, 15), label: 'Bob' }]}
        />,
        { withProviders: false },
      );

      expect(screen.queryByText(/dateRangePicker.alreadyBooked/)).not.toBeInTheDocument();
    });
  });

  describe('Clearing', () => {
    it('offers no clear button while nothing is selected', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, { withProviders: false });

      expect(screen.queryByRole('button', { name: 'dateRangePicker.clear' })).not.toBeInTheDocument();
    });

    it('clears the whole range', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <DateRangePicker
          value={{ from: new Date(2024, 6, 15), to: new Date(2024, 6, 18) }}
          onChange={onChange}
        />,
        { withProviders: false },
      );

      await user.click(screen.getByRole('button', { name: 'dateRangePicker.clear' }));

      expect(onChange).toHaveBeenCalledWith(undefined);
    });
  });
});
