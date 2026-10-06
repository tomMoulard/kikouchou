/**
 * Tests for NumberStepper.
 *
 * @module components/ui/__tests__/number-stepper.test
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { NumberStepper } from '@/components/ui/number-stepper';

/**
 * The stepper is controlled, so a bare `value` prop would freeze it and hide
 * every bug that only shows across two edits. This holds the value the way a
 * form does.
 */
function Harness({
  initial = 1,
  min = 1,
  max,
  onValueChange,
}: {
  initial?: number;
  min?: number;
  max?: number;
  onValueChange?: (value: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NumberStepper
      id="beds"
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
      min={min}
      max={max}
      decrementLabel="Remove a bed"
      incrementLabel="Add a bed"
    />
  );
}

const beds = (): HTMLInputElement => screen.getByRole('spinbutton') as HTMLInputElement;

describe('NumberStepper', () => {
  describe('buttons', () => {
    it('raises the value by one press', async () => {
      const user = userEvent.setup();
      render(<Harness initial={1} />);

      await user.click(screen.getByRole('button', { name: 'Add a bed' }));

      expect(beds().value).toBe('2');
    });

    it('lowers the value by one press', async () => {
      const user = userEvent.setup();
      render(<Harness initial={3} />);

      await user.click(screen.getByRole('button', { name: 'Remove a bed' }));

      expect(beds().value).toBe('2');
    });

    it('stops at the minimum instead of going below it', () => {
      render(<Harness initial={1} min={1} />);

      expect(screen.getByRole('button', { name: 'Remove a bed' })).toBeDisabled();
    });

    it('stops at the maximum when there is one', async () => {
      const user = userEvent.setup();
      render(<Harness initial={3} max={4} />);

      await user.click(screen.getByRole('button', { name: 'Add a bed' }));

      expect(beds().value).toBe('4');
      expect(screen.getByRole('button', { name: 'Add a bed' })).toBeDisabled();
    });

    // Inside a dialog form, a button without an explicit type submits it.
    it('does not submit the form it sits in', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn((event: { preventDefault: () => void }) =>
        event.preventDefault(),
      );

      render(
        <form onSubmit={onSubmit}>
          <Harness initial={1} />
        </form>,
      );

      await user.click(screen.getByRole('button', { name: 'Add a bed' }));

      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('typing', () => {
    // The defect this control was added for: the field clamped on every
    // keystroke, so clearing it refilled it with the minimum before the next
    // digit arrived and the old digit could never be removed first.
    it('lets the field be cleared without refilling it', async () => {
      const user = userEvent.setup();
      render(<Harness initial={1} min={1} />);

      await user.clear(beds());

      expect(beds().value).toBe('');
    });

    it('accepts a number typed after clearing', async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness initial={1} min={1} onValueChange={onValueChange} />);

      await user.clear(beds());
      await user.type(beds(), '4');

      expect(beds().value).toBe('4');
      expect(onValueChange).toHaveBeenLastCalledWith(4);
    });

    it('accepts a two-digit number without committing the first digit alone', async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness initial={1} min={1} onValueChange={onValueChange} />);

      await user.clear(beds());
      await user.type(beds(), '12');

      expect(beds().value).toBe('12');
      expect(onValueChange).toHaveBeenLastCalledWith(12);
    });

    it('does not commit a value below the minimum', async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness initial={2} min={1} onValueChange={onValueChange} />);

      await user.clear(beds());
      await user.type(beds(), '0');

      expect(onValueChange).not.toHaveBeenCalledWith(0);
    });

    it('falls back to the last good value when left empty', async () => {
      const user = userEvent.setup();
      render(<Harness initial={3} min={1} />);

      await user.clear(beds());
      await user.tab();

      // Nothing was committed while it was empty, so 3 still stands.
      expect(beds().value).toBe('3');
    });

    it('shows a stepped value while the field is being edited', async () => {
      const user = userEvent.setup();
      render(<Harness initial={1} />);

      await user.click(beds());
      await user.click(screen.getByRole('button', { name: 'Add a bed' }));

      expect(beds().value).toBe('2');
    });
  });

  describe('accessibility and wiring', () => {
    it('labels both buttons', () => {
      render(<Harness />);

      expect(screen.getByRole('button', { name: 'Remove a bed' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add a bed' })).toBeInTheDocument();
    });

    it('puts the id on the input, so a label points at the field', () => {
      render(<Harness />);

      expect(beds()).toHaveAttribute('id', 'beds');
    });

    it('disables every part when disabled', () => {
      render(
        <NumberStepper
          value={2}
          onValueChange={vi.fn()}
          disabled
          decrementLabel="Remove a bed"
          incrementLabel="Add a bed"
        />,
      );

      expect(screen.getByRole('button', { name: 'Remove a bed' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Add a bed' })).toBeDisabled();
      expect(beds()).toBeDisabled();
    });

    it('calls onBlur so the form can validate', async () => {
      const user = userEvent.setup();
      const onBlur = vi.fn();

      render(
        <NumberStepper
          value={2}
          onValueChange={vi.fn()}
          onBlur={onBlur}
          decrementLabel="Remove a bed"
          incrementLabel="Add a bed"
        />,
      );

      await user.click(beds());
      await user.tab();

      expect(onBlur).toHaveBeenCalled();
    });
  });
});
