/**
 * @fileoverview The date and time control: a calendar button and a time field
 * that together make one `YYYY-MM-DDTHH:mm` value.
 *
 * @module components/shared/__tests__/DateTimePicker.test
 */

import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen, within } from '@/test/utils';

/**
 * Loaded inside the first test rather than at the top of the file: the date
 * format and the default time are load-time constants, and Stryker can only
 * test a mutant in load-time code against the test that was running then.
 */
let DateTimePicker: typeof import('../DateTimePicker').DateTimePicker;

beforeEach(async () => {
  ({ DateTimePicker } = await import('../DateTimePicker'));
});

// ============================================================================
// Helpers
// ============================================================================

const LABELS = { dateLabel: 'Pickup date', timeLabel: 'Pickup time' } as const;

/** A parent that keeps the value, the way a form does. */
function Controlled({
  initial,
  onChange,
  onBlur,
}: {
  readonly initial: string;
  readonly onChange: (value: string) => void;
  readonly onBlur?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateTimePicker
        id="pickup"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        onBlur={onBlur}
        {...LABELS}
      />
      <button type="button">outside</button>
    </>
  );
}

const dateButton = (): HTMLElement => screen.getByRole('button', { name: 'Pickup date' });
const timeField = (): HTMLInputElement => screen.getByLabelText('Pickup time') as HTMLInputElement;

/** Opens the calendar and clicks the given day of the shown month. */
function pickDay(day: number): void {
  fireEvent.click(dateButton());
  const grid = screen.getByRole('grid');
  const cell = within(grid)
    .getAllByRole('button')
    .find((button) => button.textContent === String(day) && !button.closest('[data-outside]'));
  if (!cell) throw new Error(`no day ${day}`);
  fireEvent.click(cell);
}

// ============================================================================
// Tests
// ============================================================================

describe('DateTimePicker load-time constants', () => {
  it('writes the date out long, and settles a picked day with no time at noon', () => {
    const onChange = vi.fn();
    render(<Controlled initial="2026-03-10T09:30" onChange={onChange} />, { withProviders: false });
    expect(dateButton()).toHaveTextContent('March 10th, 2026');

    fireEvent.change(timeField(), { target: { value: '' } });
    pickDay(15);

    expect(onChange).toHaveBeenLastCalledWith('2026-03-15T12:00');
  });
});

describe('DateTimePicker', () => {
  it('spells the value out as a long date and a time', () => {
    render(<DateTimePicker id="pickup" value="2026-03-10T09:30" onChange={vi.fn()} {...LABELS} />, {
      withProviders: false,
    });

    expect(dateButton()).toHaveTextContent('March 10th, 2026');
    expect(dateButton()).toHaveAttribute('id', 'pickup');
    expect(dateButton()).not.toHaveClass('text-muted-foreground');
    expect(dateButton()).toHaveClass('w-full', 'justify-start', 'text-left', 'font-normal', 'sm:flex-1');
    expect(dateButton()).toHaveAttribute('aria-expanded', 'false');
    expect(dateButton()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(dateButton()).toHaveAttribute('aria-invalid', 'false');
    expect(dateButton().querySelector('svg')).toHaveClass('mr-2', 'size-4');
    expect(timeField()).toHaveValue('09:30');
    expect(timeField()).toHaveAttribute('id', 'pickup-time');
    expect(timeField()).toHaveAttribute('aria-invalid', 'false');
    expect(timeField()).toHaveClass('w-full', 'sm:w-32');
    expect(dateButton().parentElement).toHaveClass('flex', 'flex-col', 'gap-2', 'sm:flex-row');
  });

  it('asks for a date when there is none', () => {
    render(<DateTimePicker id="pickup" value="" onChange={vi.fn()} {...LABELS} />, {
      withProviders: false,
    });

    expect(dateButton()).toHaveTextContent('common.pickDate');
    expect(dateButton()).toHaveClass('text-muted-foreground');
    expect(timeField()).toHaveValue('');
  });

  it('marks both halves invalid, and the date in red, on an error', () => {
    render(
      <DateTimePicker
        id="pickup"
        value="2026-03-10T09:30"
        onChange={vi.fn()}
        hasError
        aria-describedby="pickup-error"
        {...LABELS}
      />,
      { withProviders: false },
    );

    expect(dateButton()).toHaveAttribute('aria-invalid', 'true');
    expect(dateButton()).toHaveClass('border-destructive');
    expect(dateButton()).toHaveAttribute('aria-describedby', 'pickup-error');
    expect(timeField()).toHaveAttribute('aria-invalid', 'true');
    expect(timeField()).toHaveAttribute('aria-describedby', 'pickup-error');
  });

  it('turns both halves off when disabled', () => {
    render(<DateTimePicker id="pickup" value="" onChange={vi.fn()} disabled {...LABELS} />, {
      withProviders: false,
    });

    expect(dateButton()).toBeDisabled();
    expect(timeField()).toBeDisabled();
  });

  it('keeps the time when another day is picked, and closes the calendar', () => {
    const onChange = vi.fn();
    render(<Controlled initial="2026-03-10T09:30" onChange={onChange} />, { withProviders: false });

    pickDay(20);

    expect(onChange).toHaveBeenLastCalledWith('2026-03-20T09:30');
    expect(dateButton()).toHaveTextContent('March 20th, 2026');
    expect(dateButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('settles the time at noon when a day is picked with no time', () => {
    const onChange = vi.fn();
    render(<Controlled initial="2026-03-10T09:30" onChange={onChange} />, { withProviders: false });

    fireEvent.change(timeField(), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('');
    // A half-filled control keeps the half that is there.
    expect(dateButton()).toHaveTextContent('March 10th, 2026');

    pickDay(15);

    expect(onChange).toHaveBeenLastCalledWith('2026-03-15T12:00');
    expect(timeField()).toHaveValue('12:00');
  });

  it('reports a new time with the date it goes with', () => {
    const onChange = vi.fn();
    render(<Controlled initial="2026-03-10T09:30" onChange={onChange} />, { withProviders: false });

    fireEvent.change(timeField(), { target: { value: '18:45' } });

    expect(onChange).toHaveBeenLastCalledWith('2026-03-10T18:45');
  });

  it('reports nothing usable when the picked day is taken back', () => {
    const onChange = vi.fn();
    render(<Controlled initial="2026-03-10T09:30" onChange={onChange} />, { withProviders: false });

    pickDay(10);

    expect(onChange).toHaveBeenLastCalledWith('');
    expect(dateButton()).toHaveTextContent('common.pickDate');
    expect(timeField()).toHaveValue('09:30');
  });

  it('takes a new value from the caller', () => {
    const { rerender } = render(
      <DateTimePicker id="pickup" value="2026-03-10T09:30" onChange={vi.fn()} {...LABELS} />,
      { withProviders: false },
    );

    rerender(<DateTimePicker id="pickup" value="2026-04-02T07:15" onChange={vi.fn()} {...LABELS} />);

    expect(dateButton()).toHaveTextContent('April 2nd, 2026');
    expect(timeField()).toHaveValue('07:15');
  });

  it('reports to the newest onChange', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <DateTimePicker id="pickup" value="2026-03-10T09:30" onChange={first} {...LABELS} />,
      { withProviders: false },
    );
    rerender(<DateTimePicker id="pickup" value="2026-03-10T09:30" onChange={second} {...LABELS} />);

    fireEvent.change(timeField(), { target: { value: '10:00' } });
    pickDay(12);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('2026-03-10T10:00');
    expect(second).toHaveBeenLastCalledWith('2026-03-12T10:00');
  });

  it('reports a blur only when the focus leaves the whole control', () => {
    const onBlur = vi.fn();
    render(<Controlled initial="2026-03-10T09:30" onChange={vi.fn()} onBlur={onBlur} />, {
      withProviders: false,
    });

    fireEvent.blur(dateButton(), { relatedTarget: timeField() });
    expect(onBlur).not.toHaveBeenCalled();

    fireEvent.blur(timeField(), { relatedTarget: screen.getByRole('button', { name: 'outside' }) });
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('opens the calendar on the month of the value', () => {
    render(<DateTimePicker id="pickup" value="2025-11-05T09:30" onChange={vi.fn()} {...LABELS} />, {
      withProviders: false,
    });

    fireEvent.click(dateButton());

    expect(dateButton()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('grid')).toHaveAccessibleName(/November 2025/);
  });
});

describe('DateTimePicker uncontrolled and blur', () => {
  it('shows the noon it settled on even when the caller keeps the old value', () => {
    render(<DateTimePicker id="pickup" value="2026-03-10T09:30" onChange={vi.fn()} {...LABELS} />, {
      withProviders: false,
    });

    fireEvent.change(timeField(), { target: { value: '' } });
    pickDay(15);

    expect(timeField()).toHaveValue('12:00');
  });

  it('keeps an edit made after a new value arrived, while the caller has not answered it', () => {
    const { rerender } = render(
      <DateTimePicker id="pickup" value="2026-03-10T09:30" onChange={vi.fn()} {...LABELS} />,
      { withProviders: false },
    );
    rerender(<DateTimePicker id="pickup" value="2026-04-02T07:15" onChange={vi.fn()} {...LABELS} />);

    // The new value is taken once. The caller still says 07:15 on the next
    // render, which is not news, so the typed time stands.
    fireEvent.change(timeField(), { target: { value: '10:00' } });

    expect(timeField()).toHaveValue('10:00');
    expect(dateButton()).toHaveTextContent('April 2nd, 2026');
  });

  it('takes a blur with no handler, and reports to the newest one', () => {
    const { rerender } = render(
      <>
        <DateTimePicker id="pickup" value="2026-03-10T09:30" onChange={vi.fn()} {...LABELS} />
        <button type="button">outside</button>
      </>,
      { withProviders: false },
    );
    const outside = screen.getByRole('button', { name: 'outside' });
    expect(() => fireEvent.blur(timeField(), { relatedTarget: outside })).not.toThrow();

    const first = vi.fn();
    const second = vi.fn();
    rerender(
      <>
        <DateTimePicker id="pickup" value="2026-03-10T09:30" onChange={vi.fn()} onBlur={first} {...LABELS} />
        <button type="button">outside</button>
      </>,
    );
    rerender(
      <>
        <DateTimePicker id="pickup" value="2026-03-10T09:30" onChange={vi.fn()} onBlur={second} {...LABELS} />
        <button type="button">outside</button>
      </>,
    );
    fireEvent.blur(timeField(), { relatedTarget: outside });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
