/**
 * @fileoverview Amounts carry the trip's currency, and never take the page down.
 * @module features/money/hooks/__tests__/useMoneyFormat.test
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useMoneyFormat } from '@/features/money/hooks/useMoneyFormat';

// ============================================================================
// Helpers
// ============================================================================

/**
 * The formatted amount, with every kind of space normalised.
 *
 * `Intl` separates a French figure from its symbol with a narrow no-break
 * space, which no test should be asserting the code point of.
 */
function formatted(currency: string | undefined, amount: number): string {
  const { result } = renderHook(() => useMoneyFormat(currency));
  return result.current(amount).replace(/\s/gu, ' ');
}

// ============================================================================
// Tests
// ============================================================================

describe('useMoneyFormat', () => {
  it('labels an amount with the currency the trip chose', () => {
    expect(formatted('EUR', 84.2)).toContain('€');
    expect(formatted('USD', 84.2)).toContain('$');
    expect(formatted('GBP', 84.2)).toContain('£');
  });

  it('always shows the cents, because money is compared column by column', () => {
    expect(formatted('EUR', 84.2)).toContain('84');
    expect(formatted('EUR', 84.2)).toMatch(/84[.,]20/u);
    expect(formatted('EUR', 5)).toMatch(/5[.,]00/u);
  });

  it('falls back to the default currency when the trip has none', () => {
    expect(formatted(undefined, 10)).toContain('€');
  });

  it('falls back rather than throwing on a code no currency has', () => {
    // A peer can put anything in the document, and `Intl.NumberFormat` throws
    // on a malformed code — which would blank the whole money page.
    expect(() => formatted('€€€', 10)).not.toThrow();
    expect(formatted('€€€', 10)).toContain('€');
    expect(formatted('', 10)).toContain('€');
  });

  it('accepts a code the form does not offer', () => {
    // The list in the form is a convenience, not the set of valid values.
    expect(() => formatted('ISK', 10)).not.toThrow();
  });

  it('shows zero for an amount that is not a number', () => {
    expect(formatted('EUR', Number.NaN)).toMatch(/0[.,]00/u);
  });
});
