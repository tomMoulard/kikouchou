/**
 * @fileoverview One money formatter for the whole money page.
 *
 * Amounts are stored as plain numbers and labelled by the trip's own currency:
 * a group renting one house spends in one currency, so the choice is made once
 * on the trip rather than typed on every receipt.
 *
 * The figures are formatted with the viewer's own number rules and the trip's
 * currency, so a French reader sees `1 234,50 €` and an English one `€1,234.50`
 * of the same trip.
 *
 * @module features/money/hooks/useMoneyFormat
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_CURRENCY, normalizeCurrency } from '@/types';
import type { CurrencyCode } from '@/types';

// ============================================================================
// Hook
// ============================================================================

/**
 * Formats an amount of money for display.
 *
 * @param currency - The trip's currency. A missing or malformed code falls back
 *   to {@link DEFAULT_CURRENCY}: the code goes straight to `Intl.NumberFormat`,
 *   which throws on a bad one, and a blank page is a worse answer than a euro
 *   sign on a trip that never chose one.
 * @returns A function turning a number into a string with its currency
 *
 * @example
 * ```tsx
 * const formatMoney = useMoneyFormat(trip.currency);
 * formatMoney(84.2); // "84,20 €"
 * ```
 */
export function useMoneyFormat(
  currency: CurrencyCode | undefined = DEFAULT_CURRENCY,
): (amount: number) => string {
  const { i18n } = useTranslation();

  const format = useMemo(() => {
    const code = normalizeCurrency(currency);
    try {
      return new Intl.NumberFormat(i18n.language, {
        style: 'currency',
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      // A code that passed the shape check but no runtime knows — the standard
      // lets an implementation refuse one. The figures matter more than the
      // symbol, so they are still shown.
      return new Intl.NumberFormat(i18n.language, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
  }, [currency, i18n.language]);

  return useMemo(
    () => (amount: number) => format.format(Number.isFinite(amount) ? amount : 0),
    [format],
  );
}
