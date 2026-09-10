/**
 * @fileoverview One money formatter for the whole money page.
 *
 * Amounts are stored as plain numbers, without a currency: a trip is spent in
 * one currency and the group knows which, and asking them to pick one before
 * they can type a receipt buys nothing. So the figures are formatted with the
 * viewer's own number rules — a French reader reads `1 234,50`, an English one
 * `1,234.50` — and no symbol is invented for them.
 *
 * @module features/money/hooks/useMoneyFormat
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

// ============================================================================
// Hook
// ============================================================================

/**
 * Formats an amount of money for display.
 *
 * @returns A function turning a number into a string with two decimals
 *
 * @example
 * ```tsx
 * const formatMoney = useMoneyFormat();
 * formatMoney(84.2); // "84.20"
 * ```
 */
export function useMoneyFormat(): (amount: number) => string {
  const { i18n } = useTranslation();

  const format = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [i18n.language],
  );

  return useMemo(
    () => (amount: number) => format.format(Number.isFinite(amount) ? amount : 0),
    [format],
  );
}
