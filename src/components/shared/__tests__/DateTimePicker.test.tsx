/**
 * @fileoverview The date and time control: a native date field and a time
 * field that together make one `YYYY-MM-DDTHH:mm` value.
 *
 * @module components/shared/__tests__/DateTimePicker.test
 */

import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen } from '@/test/utils';

/**
 * Loaded inside the first test rather than at the top of the file: the
 * default time is a load-time constant, and Stryker can only
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

const dateField = (): HTMLInputElement => screen.getByLabelText('Pickup date') as HTMLInputElement;
const timeField = (): HTMLInputElement => screen.getByLabelText('Pickup time') as HTMLInputElement;

/** Picks the given day of March 2026, the way the native picker reports it. */
function pickDay(day: number): void {
  fireEvent.change(dateField(), { target: { value: `2026-03-${String(day).padStart(2, '0')}` } });
}

// ============================================================================
// Tests
// ============================================================================

describe('DateTimePicker load-time constants', () => {
  it('settles a picked day with no time at noon', () => {
    const onChange = vi.fn();
    render(<Controlled initial="2026-03-10T09:30" onChange={onChange} />, { withProviders: false });

    fireEvent.change(timeField(), { target: { value: '' } });
    pickDay(15);

    expect(onChange).toHaveBeenLastCalledWith('2026-03-15T12:00');
  });
});

describe('DateTimePicker', () => {
  it('splits the value into a date field and a time field', () => {
    render(<DateTimePicker id="pickup" value="2026-03-10T09:30" onChange={vi.fn()} {...LABELS} />, {
      withProviders: false,
    });

    expect(dateField()).toHaveAttribute('type', 'date');
    expect(dateField()).toHaveValue('2026-03-10');
    expect(dateField()).toHaveAttribute('id', 'pickup');
    expect(dateField()).toHaveAttribute('aria-invalid', 'false');
    expect(dateField()).toHaveClass('w-full', 'sm:flex-1');
    expect(timeField()).toHaveAttribute('type', 'time');
    expect(timeField()).toHaveValue('09:30');
    expect(timeField()).toHaveAttribute('id', 'pickup-time');
    expect(timeField()).toHaveAttribute('aria-invalid', 'false');
    expect(timeField()).toHaveClass('w-full', 'sm:w-32');
    expect(dateField().parentElement).toHaveClass('flex', 'flex-col', 'gap-2', 'sm:flex-row');
  });

  it('leaves both fields empty when there is no value', () => {
    render(<DateTimePicker id="pickup" value="" onChange={vi.fn()} {...LABELS} />, {
      withProviders: false,
    });

    expect(dateField()).toHaveValue('');
    expect(timeField()).toHaveValue('');
  });

  it('marks both halves invalid on an error', () => {
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

    expect(dateField()).toHaveAttribute('aria-invalid', 'true');
    expect(dateField()).toHaveAttribute('aria-describedby', 'pickup-error');
    expect(timeField()).toHaveAttribute('aria-invalid', 'true');
    expect(timeField()).toHaveAttribute('aria-describedby', 'pickup-error');
  });

  it('turns both halves off when disabled', () => {
    render(<DateTimePicker id="pickup" value="" onChange={vi.fn()} disabled {...LABELS} />, {
      withProviders: false,
    });

    expect(dateField()).toBeDisabled();
    expect(timeField()).toBeDisabled();
  });

  it('keeps the time when another day is picked', () => {
    const onChange = vi.fn();
    render(<Controlled initial="2026-03-10T09:30" onChange={onChange} />, { withProviders: false });

    pickDay(20);

    expect(onChange).toHaveBeenLastCalledWith('2026-03-20T09:30');
    expect(dateField()).toHaveValue('2026-03-20');
  });

  it('settles the time at noon when a day is picked with no time', () => {
    const onChange = vi.fn();
    render(<Controlled initial="2026-03-10T09:30" onChange={onChange} />, { withProviders: false });

    fireEvent.change(timeField(), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('');
    // A half-filled control keeps the half that is there.
    expect(dateField()).toHaveValue('2026-03-10');

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

  it('reports nothing usable when the date is cleared', () => {
    const onChange = vi.fn();
    render(<Controlled initial="2026-03-10T09:30" onChange={onChange} />, { withProviders: false });

    fireEvent.change(dateField(), { target: { value: '' } });

    expect(onChange).toHaveBeenLastCalledWith('');
    expect(dateField()).toHaveValue('');
    expect(timeField()).toHaveValue('09:30');
  });

  it('takes a new value from the caller', () => {
    const { rerender } = render(
      <DateTimePicker id="pickup" value="2026-03-10T09:30" onChange={vi.fn()} {...LABELS} />,
      { withProviders: false },
    );

    rerender(<DateTimePicker id="pickup" value="2026-04-02T07:15" onChange={vi.fn()} {...LABELS} />);

    expect(dateField()).toHaveValue('2026-04-02');
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

    fireEvent.blur(dateField(), { relatedTarget: timeField() });
    expect(onBlur).not.toHaveBeenCalled();

    fireEvent.blur(timeField(), { relatedTarget: screen.getByRole('button', { name: 'outside' }) });
    expect(onBlur).toHaveBeenCalledTimes(1);
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
    expect(dateField()).toHaveValue('2026-04-02');
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
