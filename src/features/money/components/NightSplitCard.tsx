/**
 * @fileoverview The nights each guest owes for, and one bill divided by them.
 *
 * Pure presentation over a {@link TripNightSplit}, plus the one thing the reader
 * types: the bill. Nothing here writes to the database, so the card renders the
 * same for a viewer as for a member.
 *
 * The table is the answer people currently count by hand off the calendar
 * before they open Tricount, so it is built to be read out loud and to be
 * copied: the Copy button puts the same lines on the clipboard as plain text.
 *
 * @module features/money/components/NightSplitCard
 */

import { type ChangeEvent, type ReactElement, memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, ClipboardCopy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { splitAmountByPersonNights } from '@/features/money/lib/amount-split';
import type { TripNightSplit } from '@/features/money/lib/night-split';
import { notify } from '@/lib/notifications';
import type { PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link NightSplitCard}.
 */
export interface NightSplitCardProps {
  /** The night counts to show. */
  readonly split: TripNightSplit;
}

/**
 * One table row: a guest's counts, and their share of the bill when one was
 * typed.
 */
interface SplitRow {
  readonly personId: PersonId;
  readonly name: string;
  readonly headcount: number;
  readonly nights: number;
  readonly personNights: number;
  readonly share: number;
  /** The amount owed, or `null` while no bill has been typed. */
  readonly amount: number | null;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Reads the bill the reader typed.
 *
 * An empty field is not a zero: it means "no bill yet", and the amount column
 * stays hidden rather than showing everybody owing nothing. A comma is read as
 * a decimal point, because a French keyboard puts one there and the field is
 * `type="number"` only on a browser that agrees with the locale.
 *
 * @param raw - What is in the field
 * @returns The bill, or `null` when the field holds no number
 */
function parseAmount(raw: string): number | null {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

// ============================================================================
// Component
// ============================================================================

const NightSplitCard = memo(function NightSplitCard({
  split,
}: NightSplitCardProps): ReactElement {
  const { t, i18n } = useTranslation();
  const [rawAmount, setRawAmount] = useState('');
  const [copied, setCopied] = useState(false);

  const amount = parseAmount(rawAmount);

  const moneyFormat = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [i18n.language],
  );
  const percentFormat = useMemo(
    () => new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 }),
    [i18n.language],
  );

  const rows = useMemo<readonly SplitRow[]>(() => {
    const shares = amount === null ? [] : splitAmountByPersonNights(split.guests, amount);
    return split.guests.map((guest, index) => ({
      personId: guest.personId,
      name: guest.name,
      headcount: guest.headcount,
      nights: guest.nights,
      personNights: guest.personNights,
      share: guest.share,
      amount: shares[index]?.amount ?? null,
    }));
  }, [split.guests, amount]);

  const showsAmount = amount !== null;

  const handleAmountChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setRawAmount(event.target.value);
    setCopied(false);
  }, []);

  /**
   * Puts the table on the clipboard as plain text, one guest per line, so it
   * can be pasted into Tricount, a message or a spreadsheet.
   */
  const handleCopy = useCallback(async (): Promise<void> => {
    const lines = [
      t('money.copyHeader', {
        name: split.name,
        count: split.nights,
      }),
      ...rows.map((row) =>
        row.amount === null
          ? t('money.copyLine', { name: row.name, count: row.personNights })
          : t('money.copyLineWithAmount', {
              name: row.name,
              count: row.personNights,
              amount: moneyFormat.format(row.amount),
            }),
      ),
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy the night split:', error);
      notify.error(t('money.copyFailed'));
    }
  }, [moneyFormat, rows, split.name, split.nights, t]);

  const onCopyClick = useCallback((): void => {
    void handleCopy();
  }, [handleCopy]);

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('money.nightSplitTitle')}</CardTitle>
        <CardDescription>{t('money.nightSplitDescription')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t('money.tripNights', { count: split.nights })}{' '}
          {t('money.tripPersonNights', { count: split.personNights })}
        </p>

        {/* A one-day trip is a real trip. Say so, rather than showing a table
            of zeroes and letting the reader wonder what broke. */}
        {split.nights === 0 ? (
          <p className="text-sm text-muted-foreground">{t('money.noNights')}</p>
        ) : null}

        {split.guests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('money.noGuests')}</p>
        ) : (
          <>
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="night-split-amount">{t('money.amountLabel')}</Label>
              <Input
                id="night-split-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={rawAmount}
                onChange={handleAmountChange}
                placeholder={t('money.amountPlaceholder')}
                aria-describedby="night-split-amount-help"
              />
              <p id="night-split-amount-help" className="text-xs text-muted-foreground">
                {t('money.amountHelp')}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('money.tableCaption')}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      {t('money.columnGuest')}
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      {t('money.columnNights')}
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      {t('money.columnPersonNights')}
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      {t('money.columnShare')}
                    </th>
                    {showsAmount ? (
                      <th scope="col" className="py-2 text-right font-medium">
                        {t('money.columnAmount')}
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.personId} className="border-b border-border last:border-b-0">
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        {row.name}
                        {row.headcount > 1 ? (
                          <span className="ml-1 font-normal text-muted-foreground">
                            {t('money.headcountSuffix', { count: row.headcount })}
                          </span>
                        ) : null}
                      </th>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.nights}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.personNights}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {percentFormat.format(row.share)}
                      </td>
                      {showsAmount ? (
                        <td className="py-2 text-right font-medium tabular-nums">
                          {moneyFormat.format(row.amount ?? 0)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-medium">
                    {/* The nights column has no meaningful total — guests share
                        the same nights, so adding them up says nothing — so the
                        label spans it rather than leaving an empty cell. */}
                    <th scope="row" colSpan={2} className="py-2 pr-3 text-left">
                      {t('money.total')}
                    </th>
                    <td className="py-2 pr-3 text-right tabular-nums">{split.personNights}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                      {percentFormat.format(split.personNights === 0 ? 0 : 1)}
                    </td>
                    {showsAmount ? (
                      <td className="py-2 text-right tabular-nums">
                        {moneyFormat.format(amount)}
                      </td>
                    ) : null}
                  </tr>
                </tfoot>
              </table>
            </div>

            <Button variant="outline" onClick={onCopyClick}>
              {copied ? (
                <ClipboardCheck className="mr-2 size-4" aria-hidden="true" />
              ) : (
                <ClipboardCopy className="mr-2 size-4" aria-hidden="true" />
              )}
              {copied ? t('money.copied') : t('money.copy')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { NightSplitCard };
