/**
 * @fileoverview Tests for the shared phone number field.
 */

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';

import { PhoneInput } from '../PhoneInput';

/** The field, owning its value and error the way a form does. */
function Harness({
  initial = '',
  onBlur,
}: {
  readonly initial?: string;
  readonly onBlur?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  return (
    <>
      <label htmlFor="phone">Phone</label>
      <PhoneInput
        id="phone"
        value={value}
        onValueChange={setValue}
        error={error}
        onErrorChange={setError}
        aria-describedby="phone-hint"
        onBlur={onBlur}
      />
      <p id="phone-hint">hint</p>
    </>
  );
}

describe('PhoneInput', () => {
  it('is a phone field bounded to the stored length', () => {
    render(<Harness />, { withProviders: false });
    const phone = screen.getByLabelText('Phone');

    expect(phone).toHaveAttribute('type', 'tel');
    expect(phone).toHaveAttribute('inputMode', 'tel');
    expect(phone).toHaveAttribute('autoComplete', 'tel');
    expect(phone).toHaveAttribute('maxLength', '32');
    expect(phone).toHaveAttribute('aria-describedby', 'phone-hint');
  });

  it('lays a number out when it is left, and still calls the caller’s blur', async () => {
    const onBlur = vi.fn();
    const { user } = render(<Harness onBlur={onBlur} />, { withProviders: false });
    const phone = screen.getByLabelText('Phone');

    await user.type(phone, '0033612345678');
    await user.tab();

    expect(phone).toHaveValue('+33 6 12 34 56 78');
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('says what is wrong, ties it to the field, and drops it on the next keystroke', async () => {
    const { user } = render(<Harness />, { withProviders: false });
    const phone = screen.getByLabelText('Phone');

    await user.type(phone, '+3');
    await user.tab();

    expect(screen.getByRole('alert')).toHaveTextContent('persons.phoneTooShort');
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    expect(phone).toHaveAttribute('aria-describedby', 'phone-error phone-hint');
    // Left as typed: tidying never rewrites a number it refused.
    expect(phone).toHaveValue('+3');

    await user.type(phone, '3');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(phone).toHaveAttribute('aria-invalid', 'false');
  });

  it('leaves an empty field alone', async () => {
    const { user } = render(<Harness />, { withProviders: false });
    const phone = screen.getByLabelText('Phone');

    await user.click(phone);
    await user.tab();

    expect(phone).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
