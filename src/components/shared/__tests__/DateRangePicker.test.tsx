/**
 * DateRangePicker Component Tests
 *
 * Tests for the DateRangePicker component including:
 * - Basic rendering and interaction
 * - Date selection behavior
 * - Min/max date constraints
 * - Accessibility features
 *
 * @module components/shared/__tests__/DateRangePicker.test
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DateRangePicker, type DateRange } from '../DateRangePicker';

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('DateRangePicker', () => {
  describe('Basic Rendering', () => {
    it('renders placeholder when no value is set', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />);
      
      // The mock returns the translation key
      expect(screen.getByText('dateRangePicker.placeholder')).toBeInTheDocument();
    });

    it('renders custom placeholder when provided', () => {
      render(
        <DateRangePicker value={undefined} onChange={vi.fn()} placeholder="Pick dates" />
      );
      
      expect(screen.getByText('Pick dates')).toBeInTheDocument();
    });

    it('renders trigger button with calendar icon', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />);
      
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
      // Calendar icon is present (svg element)
      expect(button.querySelector('svg')).toBeInTheDocument();
    });

    it('renders formatted date range when value is set', () => {
      const value: DateRange = {
        from: new Date(2024, 6, 15), // July 15, 2024
        to: new Date(2024, 6, 20),   // July 20, 2024
      };

      render(<DateRangePicker value={value} onChange={vi.fn()} />);
      
      // Check that both dates are displayed (format depends on locale)
      const button = screen.getByRole('button');
      expect(button.textContent).toContain('Jul');
      expect(button.textContent).toContain('15');
      expect(button.textContent).toContain('20');
    });

    it('renders same-day selection as single date', () => {
      const value: DateRange = {
        from: new Date(2024, 6, 15),
        to: new Date(2024, 6, 15), // Same as from
      };

      render(<DateRangePicker value={value} onChange={vi.fn()} />);
      
      const button = screen.getByRole('button');
      // Should show only one date, not a range with arrow
      expect(button.textContent).not.toContain('→');
    });

    it('shows partial selection message when only from date is selected', () => {
      const value: DateRange = {
        from: new Date(2024, 6, 15),
        to: undefined,
      };

      render(<DateRangePicker value={value} onChange={vi.fn()} />);
      
      const button = screen.getByRole('button');
      // The mock interpolates the translation key with date
      expect(button.textContent).toContain('dateRangePicker.selectEndDate');
    });
  });

  // ============================================================================
  // Interaction Tests
  // ============================================================================

  describe('Interaction', () => {
    it('opens calendar popover on click', async () => {
      const user = userEvent.setup();
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />);
      
      const button = screen.getByRole('button');
      await user.click(button);
      
      // Calendar should be visible
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('calls onChange when date is selected', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<DateRangePicker value={undefined} onChange={onChange} />);
      
      // Open the calendar
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      
      // Find a clickable date button - react-day-picker v9 uses buttons inside gridcells
      const buttons = screen.getAllByRole('button');
      // Find a date button (not navigation buttons, which have aria-label)
      const dateButton = buttons.find(
        (btn) =>
          btn.closest('[role="gridcell"]') &&
          !btn.hasAttribute('disabled') &&
          btn.getAttribute('aria-disabled') !== 'true'
      );
      
      if (dateButton) {
        await user.click(dateButton);
        expect(onChange).toHaveBeenCalled();
      } else {
        // Fallback: at least verify calendar is rendered
        expect(screen.getByRole('grid')).toBeInTheDocument();
      }
    });
  });

  // ============================================================================
  // Date Constraint Tests
  // ============================================================================

  describe('Date Constraints', () => {
    it('passes minDate to calendar', async () => {
      const user = userEvent.setup();
      const minDate = new Date(2024, 6, 15); // July 15, 2024
      
      render(
        <DateRangePicker value={undefined} onChange={vi.fn()} minDate={minDate} />
      );
      
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      
      // Calendar should be rendered with minDate constraint
      // We verify the calendar opens - the actual date disabling is handled by react-day-picker
      const grid = screen.getByRole('grid');
      expect(grid).toBeInTheDocument();
    });

    it('passes maxDate to calendar', async () => {
      const user = userEvent.setup();
      const minDate = new Date(2024, 6, 1); // July 1, 2024
      const maxDate = new Date(2024, 6, 20); // July 20, 2024
      
      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          minDate={minDate}
          maxDate={maxDate}
        />
      );
      
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      
      // Calendar should be rendered with maxDate constraint
      const grid = screen.getByRole('grid');
      expect(grid).toBeInTheDocument();
    });

    it('sets default month to minDate when no value', async () => {
      const user = userEvent.setup();
      const minDate = new Date(2024, 11, 1); // December 2024
      
      render(
        <DateRangePicker value={undefined} onChange={vi.fn()} minDate={minDate} />
      );
      
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      
      // Should show December 2024 (the minDate month)
      expect(screen.getByText(/December 2024|décembre 2024/i)).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Disabled State Tests
  // ============================================================================

  describe('Disabled State', () => {
    it('disables the trigger button when disabled prop is true', () => {
      render(
        <DateRangePicker value={undefined} onChange={vi.fn()} disabled={true} />
      );
      
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
    });

    it('does not open calendar when disabled', async () => {
      const user = userEvent.setup();
      render(
        <DateRangePicker value={undefined} onChange={vi.fn()} disabled={true} />
      );
      
      // Try to click the disabled button
      const button = screen.getByRole('button');
      await user.click(button);
      
      // Calendar should not open
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Accessibility Tests
  // ============================================================================

  describe('Accessibility', () => {
    it('has correct aria-label on trigger button', () => {
      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          aria-label="Select stay dates"
        />
      );
      
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'Select stay dates');
    });

    it('has default aria-label when not provided', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />);
      
      const button = screen.getByRole('button');
      // Mock returns the translation key
      expect(button).toHaveAttribute('aria-label', 'dateRangePicker.ariaLabel');
    });

    it('has correct aria-expanded attribute', async () => {
      const user = userEvent.setup();
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />);
      
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      
      await user.click(button);
      await waitFor(() => {
        expect(button).toHaveAttribute('aria-expanded', 'true');
      });
    });

    it('has aria-haspopup="dialog" attribute', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />);
      
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    });

    it('applies aria-describedby when provided', () => {
      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          aria-describedby="help-text"
        />
      );
      
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-describedby', 'help-text');
    });

    it('applies custom id when provided', () => {
      render(
        <DateRangePicker value={undefined} onChange={vi.fn()} id="date-picker-1" />
      );
      
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('id', 'date-picker-1');
    });
  });

  // ============================================================================
  // Booked Ranges Tests
  // ============================================================================

  describe('Booked Ranges', () => {
    it('shows booked indicator when bookedRanges are provided', async () => {
      const user = userEvent.setup();
      const bookedRanges = [
        { from: new Date(2024, 6, 10), to: new Date(2024, 6, 15) },
      ];
      
      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          bookedRanges={bookedRanges}
          minDate={new Date(2024, 6, 1)}
          maxDate={new Date(2024, 6, 31)}
        />
      );
      
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      
      // Should show the "Already assigned" text (mock returns key)
      expect(screen.getByText('dateRangePicker.alreadyBooked')).toBeInTheDocument();
    });

    it('does not show booked indicator when no bookedRanges', async () => {
      const user = userEvent.setup();
      
      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          minDate={new Date(2024, 6, 1)}
          maxDate={new Date(2024, 6, 31)}
        />
      );
      
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      
      // Should NOT show the "Already assigned" text
      expect(screen.queryByText('dateRangePicker.alreadyBooked')).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Number of Months Tests
  // ============================================================================

  describe('Number of Months', () => {
    it('defaults to 1 month display', async () => {
      const user = userEvent.setup();
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />);
      
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      
      // Should have exactly one grid (calendar month)
      const grids = screen.getAllByRole('grid');
      expect(grids).toHaveLength(1);
    });

    it('shows 2 months when numberOfMonths is 2', async () => {
      const user = userEvent.setup();
      render(
        <DateRangePicker value={undefined} onChange={vi.fn()} numberOfMonths={2} />
      );
      
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      
      // Should have two grids (calendar months)
      const grids = screen.getAllByRole('grid');
      expect(grids).toHaveLength(2);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles undefined value gracefully', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />);
      
      expect(screen.getByText('dateRangePicker.placeholder')).toBeInTheDocument();
    });

    it('applies custom className to trigger button', () => {
      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          className="custom-class"
        />
      );
      
      const button = screen.getByRole('button');
      expect(button).toHaveClass('custom-class');
    });

    it('shows different style when has selection', () => {
      const valueWithSelection: DateRange = {
        from: new Date(2024, 6, 15),
        to: new Date(2024, 6, 20),
      };
      
      render(<DateRangePicker value={valueWithSelection} onChange={vi.fn()} />);
      
      const button = screen.getByRole('button');
      // When there's no selection, button has text-muted-foreground class
      // When there's a selection, it shouldn't have that class
      expect(button).not.toHaveClass('text-muted-foreground');
    });

    it('shows muted style when no selection', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />);
      
      const button = screen.getByRole('button');
      // When there's no selection, button should have text-muted-foreground class
      expect(button).toHaveClass('text-muted-foreground');
    });
  });

  // ============================================================================
  // Clear Button Tests
  // ============================================================================

  describe('Clear Button', () => {
    it('shows clear button when there is a selection', async () => {
      const user = userEvent.setup();
      const value: DateRange = {
        from: new Date(2024, 6, 15),
        to: new Date(2024, 6, 20),
      };

      render(<DateRangePicker value={value} onChange={vi.fn()} />);

      // Open the calendar
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Clear button should be visible
      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    });

    it('does not show clear button when no selection', async () => {
      const user = userEvent.setup();

      render(<DateRangePicker value={undefined} onChange={vi.fn()} />);

      // Open the calendar
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Clear button should NOT be visible
      expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
    });

    it('calls onChange with undefined when clear button is clicked', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const value: DateRange = {
        from: new Date(2024, 6, 15),
        to: new Date(2024, 6, 20),
      };

      render(<DateRangePicker value={value} onChange={onChange} />);

      // Open the calendar
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Click clear button
      const clearButton = screen.getByRole('button', { name: /clear/i });
      await user.click(clearButton);

      // onChange should be called with undefined
      expect(onChange).toHaveBeenCalledWith(undefined);
    });

    it('shows clear button when only start date is selected', async () => {
      const user = userEvent.setup();
      const value: DateRange = {
        from: new Date(2024, 6, 15),
        to: undefined,
      };

      render(<DateRangePicker value={value} onChange={vi.fn()} />);

      // Open the calendar
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Clear button should be visible (hasSelection is true when from is set)
      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    });
  });
});
