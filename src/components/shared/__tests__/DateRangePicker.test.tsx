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

import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@/test/utils';
import userEvent from '@testing-library/user-event';

import { PHONE_MEDIA_QUERY } from '@/hooks/usePhoneViewport';

import { DateRangePicker, type DateRange } from '../DateRangePicker';

// ============================================================================
// Helpers
// ============================================================================

/**
 * The day button for a calendar date in the open popover.
 *
 * react-day-picker v9 tags every gridcell with an ISO `data-day`, which is the
 * one part of its markup that does not move with locale or styling. Throwing
 * on a miss is deliberate: a test that cannot find the day it means to click
 * has to fail, not fall back to asserting something weaker.
 *
 * @param isoDay - Calendar day as `YYYY-MM-DD`
 * @returns The `<button>` inside that day's gridcell
 */
function dayCell(isoDay: string): HTMLElement {
  const cells = screen.getAllByRole('gridcell'),
   cell = cells.find((c) => c.getAttribute('data-day') === isoDay);

  if (!cell) {
    const rendered = cells.map((c) => c.getAttribute('data-day')).join(', ');
    throw new Error(`No calendar cell for ${isoDay}. Rendered days: ${rendered}`);
  }

  return cell;
}

/**
 * The day button inside that cell.
 *
 * Note the split: `modifiers`/`modifiersClassNames` land on the gridcell,
 * `disabled` lands on the button. Asserting a modifier class against the
 * button silently never fails.
 */
function dayButton(isoDay: string): HTMLElement {
  return within(dayCell(isoDay)).getByRole('button');
}

/** Opens the picker's popover and waits for the calendar to appear. */
async function openCalendar(
  user: ReturnType<typeof userEvent.setup>
): Promise<void> {
  await user.click(
    screen.getByRole('button', { name: 'dateRangePicker.ariaLabel' })
  );
  await waitFor(() => {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
}

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('DateRangePicker', () => {
  describe('Basic Rendering', () => {
    it('renders placeholder when no value is set', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, { withProviders: false });
      
      // The mock returns the translation key
      expect(screen.getByText('dateRangePicker.placeholder')).toBeInTheDocument();
    });

    it('renders custom placeholder when provided', () => {
      render(
        <DateRangePicker value={undefined} onChange={vi.fn()} placeholder="Pick dates" />,
      { withProviders: false }
      );
      
      expect(screen.getByText('Pick dates')).toBeInTheDocument();
    });

    it('renders trigger button with calendar icon', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, { withProviders: false });
      
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

      render(<DateRangePicker value={value} onChange={vi.fn()} />, { withProviders: false });
      
      // Exact, not three `toContain` probes: "Jul", "15" and "20" all appear
      // in a plain "Jul 15, 2024" too, so the substring form kept passing with
      // the end date dropped from the label entirely.
      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('Jul 15, 2024 → Jul 20, 2024');
    });

    it('renders same-day selection as single date', () => {
      const value: DateRange = {
        from: new Date(2024, 6, 15),
        to: new Date(2024, 6, 15), // Same as from
      };

      render(<DateRangePicker value={value} onChange={vi.fn()} />, { withProviders: false });
      
      // The date still has to be shown: the arrow check on its own also holds
      // for a button that renders no label at all.
      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('Jul 15, 2024');
      expect(button.textContent).not.toContain('→');
    });

    it('shows partial selection message when only from date is selected', () => {
      const value: DateRange = {
        from: new Date(2024, 6, 15),
        to: undefined,
      };

      render(<DateRangePicker value={value} onChange={vi.fn()} />, { withProviders: false });
      
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
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, { withProviders: false });
      
      const button = screen.getByRole('button');
      await user.click(button);
      
      // Calendar should be visible
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('reports the clicked day back through onChange', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      // Pin the visible month via defaultMonth so the day being clicked is a known
      // calendar date rather than "whatever month today falls in".
      render(
        <DateRangePicker
          value={undefined}
          onChange={onChange}
          defaultMonth={new Date(2024, 6, 1)}
        />,
      { withProviders: false }
      );

      await openCalendar(user);
      await user.click(dayButton('2024-07-15'));

      // react-day-picker v9 sets BOTH ends to the clicked day on the first
      // click of a range; the component forwards that verbatim.
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({
        from: new Date(2024, 6, 15),
        to: new Date(2024, 6, 15),
      });
    });

    it('closes the popover once a two-day range is complete', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <DateRangePicker
          value={{ from: new Date(2024, 6, 15), to: new Date(2024, 6, 15) }}
          onChange={onChange}
          defaultMonth={new Date(2024, 6, 1)}
        />,
      { withProviders: false }
      );

      await openCalendar(user);
      await user.click(dayButton('2024-07-18'));

      expect(onChange).toHaveBeenCalledWith({
        from: new Date(2024, 6, 15),
        to: new Date(2024, 6, 18),
      });

      // Auto-close only fires when from !== to, so a first click must NOT
      // close and this second one must.
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('keeps the popover open after the first click of a range', async () => {
      const user = userEvent.setup();

      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          defaultMonth={new Date(2024, 6, 1)}
        />,
      { withProviders: false }
      );

      await openCalendar(user);
      await user.click(dayButton('2024-07-15'));

      // Closing here would make the end date unreachable: rdp reports the
      // first click as a complete from===to range, and closing on that was
      // exactly the bug the `getTime()` comparison guards against.
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Date Constraint Tests
  // ============================================================================

  describe('Opening month and selectable days', () => {
    it('keeps days before and after the opening month selectable', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      // A trip's dates only say where the calendar opens: a guest who
      // arrives a day early must still be able to pick that day.
      render(
        <DateRangePicker
          value={undefined}
          onChange={onChange}
          defaultMonth={new Date(2024, 6, 15)}
        />,
      { withProviders: false }
      );

      await openCalendar(user);

      expect(dayButton('2024-07-01')).toBeEnabled();
      expect(dayButton('2024-07-31')).toBeEnabled();
      await user.click(dayButton('2024-07-02'));
      expect(onChange).toHaveBeenCalledWith({
        from: new Date(2024, 6, 2),
        to: new Date(2024, 6, 2),
      });
    });

    it('opens on defaultMonth when no value', async () => {
      const user = userEvent.setup();

      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          defaultMonth={new Date(2024, 11, 1)}
        />,
      { withProviders: false }
      );

      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      expect(screen.getByText(/December 2024|décembre 2024/i)).toBeInTheDocument();
    });

    it('opens on the selection rather than defaultMonth', async () => {
      const user = userEvent.setup();

      render(
        <DateRangePicker
          value={{ from: new Date(2023, 1, 10), to: undefined }}
          onChange={vi.fn()}
          defaultMonth={new Date(2024, 11, 1)}
        />,
      { withProviders: false }
      );

      await openCalendar(user);

      expect(dayCell('2023-02-10')).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Disabled State Tests
  // ============================================================================

  describe('Disabled State', () => {
    it('disables the trigger button when disabled prop is true', () => {
      render(
        <DateRangePicker value={undefined} onChange={vi.fn()} disabled={true} />,
      { withProviders: false }
      );
      
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
    });

    it('does not open calendar when disabled', async () => {
      const user = userEvent.setup();
      render(
        <DateRangePicker value={undefined} onChange={vi.fn()} disabled={true} />,
      { withProviders: false }
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
        />,
      { withProviders: false }
      );
      
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label', 'Select stay dates');
    });

    it('has default aria-label when not provided', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, { withProviders: false });
      
      const button = screen.getByRole('button');
      // Mock returns the translation key
      expect(button).toHaveAttribute('aria-label', 'dateRangePicker.ariaLabel');
    });

    it('has correct aria-expanded attribute', async () => {
      const user = userEvent.setup();
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, { withProviders: false });
      
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      
      await user.click(button);
      await waitFor(() => {
        expect(button).toHaveAttribute('aria-expanded', 'true');
      });
    });

    it('has aria-haspopup="dialog" attribute', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, { withProviders: false });
      
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    });

    it('applies aria-describedby when provided', () => {
      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          aria-describedby="help-text"
        />,
      { withProviders: false }
      );
      
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-describedby', 'help-text');
    });

    it('applies custom id when provided', () => {
      render(
        <DateRangePicker value={undefined} onChange={vi.fn()} id="date-picker-1" />,
      { withProviders: false }
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
          defaultMonth={new Date(2024, 6, 1)}
        />,
      { withProviders: false }
      );
      
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
      
      // Should show the "Already assigned" text (mock returns key)
      expect(screen.getByText('dateRangePicker.alreadyBooked')).toBeInTheDocument();
    });

    it('marks the nights of a booked range, not the checkout morning', async () => {
      const user = userEvent.setup();

      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          // Jul 10 check-in, Jul 15 check-out: five nights slept, and the bed
          // is free again on the 15th.
          bookedRanges={[{ from: new Date(2024, 6, 10), to: new Date(2024, 6, 15) }]}
          defaultMonth={new Date(2024, 6, 1)}
        />,
      { withProviders: false }
      );

      await openCalendar(user);

      const booked = Array.from(document.querySelectorAll('.rdp-day-booked'));
      expect(booked.map((el) => el.textContent)).toEqual([
        '10',
        '11',
        '12',
        '13',
        '14',
      ]);
      // Drop the `slice(0, -1)` and the 15th joins the list, showing the room
      // as taken on a night nobody is in it. Asserted on the gridcell, not the
      // button inside it: react-day-picker puts `modifiersClassNames` on the
      // <td>, so the same check against the <button> can never fail.
      expect(dayCell('2024-07-15')).not.toHaveClass('rdp-day-booked');
      expect(dayCell('2024-07-14')).toHaveClass('rdp-day-booked');
    });

    it('does not show booked indicator when no bookedRanges', async () => {
      const user = userEvent.setup();
      
      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          defaultMonth={new Date(2024, 6, 1)}
        />,
      { withProviders: false }
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
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, { withProviders: false });
      
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
        <DateRangePicker value={undefined} onChange={vi.fn()} numberOfMonths={2} />,
      { withProviders: false }
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
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, { withProviders: false });
      
      expect(screen.getByText('dateRangePicker.placeholder')).toBeInTheDocument();
    });

    it('applies custom className to trigger button', () => {
      render(
        <DateRangePicker
          value={undefined}
          onChange={vi.fn()}
          className="custom-class"
        />,
      { withProviders: false }
      );
      
      const button = screen.getByRole('button');
      expect(button).toHaveClass('custom-class');
    });

    it('shows different style when has selection', () => {
      const valueWithSelection: DateRange = {
        from: new Date(2024, 6, 15),
        to: new Date(2024, 6, 20),
      };
      
      render(<DateRangePicker value={valueWithSelection} onChange={vi.fn()} />, { withProviders: false });
      
      const button = screen.getByRole('button');
      // When there's no selection, button has text-muted-foreground class
      // When there's a selection, it shouldn't have that class
      expect(button).not.toHaveClass('text-muted-foreground');
    });

    it('shows muted style when no selection', () => {
      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, { withProviders: false });
      
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

      render(<DateRangePicker value={value} onChange={vi.fn()} />, { withProviders: false });

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

      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, { withProviders: false });

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

      render(<DateRangePicker value={value} onChange={onChange} />, { withProviders: false });

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

      render(<DateRangePicker value={value} onChange={vi.fn()} />, { withProviders: false });

      // Open the calendar
      await user.click(screen.getByRole('button'));
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });

      // Clear button should be visible (hasSelection is true when from is set)
      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Pointer Events
  // ==========================================================================

  /**
   * The bug this pins is invisible to every other assertion in this file.
   *
   * A Radix dialog puts `pointer-events: none` on `<body>` and gives
   * `pointer-events: auto` to one layer. A non-modal popover claims nothing and
   * only stays clickable if its dismissable layer happens to sort above the
   * dialog's — and when it loses that race it renders with no `pointer-events`
   * of its own, inherits `none`, and every tap falls through to the overlay
   * behind it. The calendar still paints on top, still highlights on hover, and
   * still reports itself visible and enabled: nothing looks wrong. Three of
   * this picker's four call sites are inside a dialog.
   *
   * The scenario itself is deliberately **not** what is asserted here. jsdom
   * flushes effects synchronously, so the popover wins that race every time and
   * a test rendering the picker inside a `Dialog` passes with or without the
   * fix — it cannot fail, which makes it worse than no test at all. What is
   * asserted instead is the property that stops the race from existing: a modal
   * popover disables outside pointer events itself, so it is the topmost layer
   * doing so by construction rather than by mount order, and it always emits
   * `pointer-events: auto` for its own content.
   *
   * `getByRole`, `toBeVisible` and a synthetic `user.click` all pass against a
   * click-through popover, because none of them does a hit test. Only the
   * browser suite catches the real thing.
   */
  describe('Pointer events', () => {
    it('claims pointer events for itself while open', async () => {
      const user = userEvent.setup();

      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, {
        withProviders: false,
      });

      expect(document.body.style.pointerEvents).toBe('');

      await openCalendar(user);

      // `auto`, not merely "not none": an unset value inherits the body's
      // `none` and is exactly the broken state, so asserting the absence of
      // `none` would pass against the bug.
      expect(document.body.style.pointerEvents).toBe('none');
      expect(screen.getByRole('dialog').style.pointerEvents).toBe('auto');
    });
  });
  /**
   * On a phone the calendar opens as a centred dialog rather than a popover
   * anchored to the trigger, which on a 384px screen sat against one edge.
   */
  describe('On a phone', () => {
    const defaultMatchMedia = window.matchMedia;

    afterEach(() => {
      window.matchMedia = defaultMatchMedia;
    });

    /** Answers the phone query only, as a narrow portrait screen does. */
    function setPhoneViewport(): void {
      window.matchMedia = vi.fn().mockImplementation(
        (query: string) =>
          ({
            matches: query === PHONE_MEDIA_QUERY,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
          }) as unknown as MediaQueryList,
      );
    }

    it('opens the calendar in a titled dialog, not a popover', async () => {
      setPhoneViewport();
      const user = userEvent.setup();

      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, {
        withProviders: false,
      });

      await openCalendar(user);

      const dialog = screen.getByRole('dialog', {
        name: 'dateRangePicker.calendarDialog',
      });
      expect(dialog).toHaveAttribute('data-slot', 'dialog-content');
      expect(document.querySelector('[data-slot=popover-content]')).toBeNull();
      expect(within(dialog).getAllByRole('gridcell').length).toBeGreaterThan(27);
    });

    it('sizes the day cells to the width of the screen', async () => {
      setPhoneViewport();
      const user = userEvent.setup();

      render(<DateRangePicker value={undefined} onChange={vi.fn()} />, {
        withProviders: false,
      });

      await openCalendar(user);

      const calendar = screen
        .getByRole('dialog')
        .querySelector('[data-slot=calendar]');
      expect(calendar?.className).toContain('calc((100vw-4rem-2px)/7)');
      // The calendar's own phone size must be gone, or it wins the cascade.
      expect(calendar?.className).not.toContain('--spacing(11)');
    });

    it('closes the dialog once a two-day range is complete', async () => {
      setPhoneViewport();
      const user = userEvent.setup(),
       onChange = vi.fn();

      render(
        <DateRangePicker
          value={{ from: new Date(2024, 6, 15), to: new Date(2024, 6, 15) }}
          onChange={onChange}
          defaultMonth={new Date(2024, 6, 1)}
        />,
        { withProviders: false },
      );

      await openCalendar(user);
      await user.click(dayButton('2024-07-18'));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
      expect(onChange).toHaveBeenCalledWith({
        from: new Date(2024, 6, 15),
        to: new Date(2024, 6, 18),
      });
    });
  });
});

describe('DateRangePicker, more of it', () => {
  const july = (day: number): Date => new Date(2024, 6, day);
  const invalid = (): Date => new Date(Number.NaN);

  /** Waits past the frame in which a completed range closes the popover. */
  async function nextFrame(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }

  it('treats an unreadable start date as no selection', () => {
    render(<DateRangePicker value={{ from: invalid(), to: undefined }} onChange={vi.fn()} />, {
      withProviders: false,
    });

    const trigger = screen.getByRole('button', { name: 'dateRangePicker.ariaLabel' });
    expect(trigger).toHaveTextContent('dateRangePicker.placeholder');
    expect(trigger).toHaveClass('w-full', 'justify-start', 'text-left', 'font-normal', 'text-muted-foreground');
    expect(trigger.querySelector('svg')).toHaveClass('mr-2', 'h-4', 'w-4', 'shrink-0');
    expect(screen.getByText('dateRangePicker.placeholder')).toHaveClass('truncate');
  });

  it('asks for an end date when the end date cannot be read', () => {
    render(<DateRangePicker value={{ from: july(15), to: invalid() }} onChange={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByRole('button', { name: 'dateRangePicker.ariaLabel' })).toHaveTextContent(
      'dateRangePicker.selectEndDate',
    );
  });

  it('opens on this month when neither the selection nor defaultMonth can be read', async () => {
    // Only Date is faked: the user events still run on real timers.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2025, 10, 20, 12, 0) });
    try {
      const user = userEvent.setup();
      render(<DateRangePicker value={undefined} onChange={vi.fn()} defaultMonth={invalid()} />, {
        withProviders: false,
      });

      await openCalendar(user);

      expect(dayCell('2025-11-20')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips a booked range it cannot read and marks the rest', async () => {
    const user = userEvent.setup();
    render(
      <DateRangePicker
        value={{ from: july(15), to: july(16) }}
        onChange={vi.fn()}
        bookedRanges={[
          { from: invalid(), to: july(3) },
          { from: july(10), to: invalid() },
          { from: july(10), to: july(12) },
        ]}
      />,
      { withProviders: false },
    );

    await openCalendar(user);

    const booked = Array.from(document.querySelectorAll('.rdp-day-booked'));
    expect(booked.map((el) => el.textContent)).toEqual(['10', '11']);
  });

  it('opens on the month of a start date that arrived after mount, and clears through the newest handler', async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(<DateRangePicker value={undefined} onChange={first} />, {
      withProviders: false,
    });

    // A form that loads its record after the first render hands the picker
    // its value, and a new handler with it.
    rerender(<DateRangePicker value={{ from: new Date(2023, 1, 10), to: undefined }} onChange={latest} />);
    await openCalendar(user);

    expect(dayCell('2023-02-10')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'dateRangePicker.clear' }));
    expect(latest).toHaveBeenCalledWith(undefined);
    expect(first).not.toHaveBeenCalled();
  });

  it('opens on the month of the start date', async () => {
    const user = userEvent.setup();
    render(<DateRangePicker value={{ from: new Date(2023, 1, 10), to: undefined }} onChange={vi.fn()} />, {
      withProviders: false,
    });

    await openCalendar(user);

    expect(dayCell('2023-02-10')).toBeInTheDocument();
  });

  it('marks no booking for a booked range it cannot read', async () => {
    const user = userEvent.setup();
    render(
      <DateRangePicker
        value={{ from: july(15), to: july(16) }}
        onChange={vi.fn()}
        bookedRanges={[
          { from: invalid(), to: invalid() },
          { from: july(3), to: invalid() },
        ]}
      />,
      { withProviders: false },
    );

    await openCalendar(user);

    expect(screen.queryByText('dateRangePicker.alreadyBooked')).not.toBeInTheDocument();
  });

  it('shows bookings that arrive after it opened', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DateRangePicker value={{ from: july(15), to: july(16) }} onChange={vi.fn()} />,
      { withProviders: false },
    );
    rerender(
      <DateRangePicker
        value={{ from: july(15), to: july(16) }}
        onChange={vi.fn()}
        bookedRanges={[{ from: july(3), to: july(5) }]}
      />,
    );

    await openCalendar(user);

    expect(screen.getByText('dateRangePicker.alreadyBooked')).toBeInTheDocument();
    expect(dayCell('2024-07-03')).toHaveClass('rdp-day-booked');
  });

  it('stays open a frame after the first click, and reports it to the newest onChange', async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <DateRangePicker value={undefined} onChange={first} defaultMonth={july(1)} />,
      { withProviders: false },
    );
    rerender(<DateRangePicker value={undefined} onChange={second} defaultMonth={july(1)} />);

    await openCalendar(user);
    await user.click(dayButton('2024-07-15'));
    await nextFrame();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(second).toHaveBeenCalledWith({ from: july(15), to: july(15) });
    expect(first).not.toHaveBeenCalled();
  });

  it('labels the clear button and the popover', async () => {
    const user = userEvent.setup();
    render(<DateRangePicker value={{ from: july(15), to: july(16) }} onChange={vi.fn()} />, {
      withProviders: false,
    });

    await openCalendar(user);

    const dialog = screen.getByRole('dialog', { name: 'dateRangePicker.calendarDialog' });
    // A popover on a laptop, so no dialog heading.
    expect(within(dialog).queryByRole('heading')).not.toBeInTheDocument();
    const clear = within(dialog).getByRole('button', { name: 'dateRangePicker.clear' });
    expect(clear).toHaveTextContent('dateRangePicker.clear');
    // The visible text alone would give the same name, so the label is pinned too.
    expect(clear).toHaveAttribute('aria-label', 'dateRangePicker.clear');
    expect(clear).toHaveClass('h-9', 'px-2', 'text-xs', 'md:h-7');
    expect(clear.querySelector('svg')).toHaveClass('h-3', 'w-3', 'mr-1');
  });
});

describe('DateRangePicker taking a range back', () => {
  it('reports no range when the one chosen day is clicked again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DateRangePicker
        value={{ from: new Date(2024, 6, 15), to: new Date(2024, 6, 15) }}
        onChange={onChange}
        defaultMonth={new Date(2024, 6, 1)}
      />,
      { withProviders: false },
    );

    await openCalendar(user);
    await user.click(dayButton('2024-07-15'));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
