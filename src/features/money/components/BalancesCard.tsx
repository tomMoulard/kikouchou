/**
 * @fileoverview Who is up, who is down, and the payments that level them.
 *
 * Two lists, in the order a group reads them: the balances say what the
 * accounts came to, and the payments say what to do about it. A payment can be
 * recorded as a transfer in one tap, which is what makes the list shrink rather
 * than being a suggestion nobody acts on.
 *
 * @module features/money/components/BalancesCard
 */

import { type ReactElement, memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { statusVariants } from '@/components/ui/status.variants';
import { useMoneyFormat } from '@/features/money/hooks/useMoneyFormat';
import { computeBalances, isSettled, settleBalances } from '@/features/money/lib/balances';
import type { SettlementPayment } from '@/features/money/lib/balances';
import type { PersonNightCounts } from '@/features/money/lib/expense-split';
import { cn } from '@/lib/utils';
import type { CurrencyCode, Expense, Person, PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link BalancesCard}.
 */
export interface BalancesCardProps {
  /** The trip's money lines. */
  readonly expenses: readonly Expense[];
  /** The trip's guests, for names and colours. */
  readonly persons: readonly Person[];
  /** Each guest's person nights, for lines split by nights. */
  readonly personNights: PersonNightCounts;
  /** The trip's currency, for every figure on the card. */
  readonly currency: CurrencyCode | undefined;
  /** Records one payment as a transfer. Absent on a read-only trip. */
  readonly onRecordPayment?: (payment: SettlementPayment) => void;
}

// ============================================================================
// Component
// ============================================================================

const BalancesCard = memo(function BalancesCard({
  expenses,
  persons,
  personNights,
  currency,
  onRecordPayment,
}: BalancesCardProps): ReactElement {
  const { t } = useTranslation();
  const formatMoney = useMoneyFormat(currency);

  const personsMap = useMemo(
    () => new Map<PersonId, Person>(persons.map((person) => [person.id, person])),
    [persons],
  );

  const balances = useMemo(
    () => computeBalances(expenses, personNights),
    [expenses, personNights],
  );

  const payments = useMemo(() => settleBalances(balances), [balances]);

  const nameOf = (personId: PersonId): string =>
    personsMap.get(personId)?.name ?? t('money.expense.unknownGuest');

  const settled = isSettled(balances);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('money.balances.title')}</CardTitle>
        <CardDescription>{t('money.balances.description')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {balances.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('money.balances.empty')}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('money.balances.tableCaption')}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      {t('money.columnGuest')}
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      {t('money.balances.columnPaid')}
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      {t('money.balances.columnOwed')}
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      {t('money.balances.columnBalance')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((row) => (
                    <tr
                      key={row.personId}
                      className="border-b border-border last:border-b-0"
                    >
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        <span className="flex items-center gap-2">
                          <span
                            className="size-3 rounded-full shrink-0"
                            style={{
                              backgroundColor: personsMap.get(row.personId)?.color,
                            }}
                            aria-hidden="true"
                          />
                          {nameOf(row.personId)}
                        </span>
                      </th>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {formatMoney(row.paid)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                        {formatMoney(row.owed)}
                      </td>
                      <td
                        className={cn(
                          'py-2 text-right font-medium tabular-nums',
                          row.balance > 0
                            ? statusVariants({ tone: 'success', emphasis: 'text' })
                            : row.balance < 0
                              ? statusVariants({ tone: 'warning', emphasis: 'text' })
                              : 'text-muted-foreground',
                        )}
                      >
                        {formatMoney(row.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <section className="space-y-3" aria-labelledby="money-settle-heading">
              <h3 id="money-settle-heading" className="text-sm font-semibold">
                {t('money.balances.settleTitle')}
              </h3>

              {settled || payments.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  {t('money.balances.settled')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {payments.map((payment) => (
                    <li
                      key={`${payment.fromPersonId}-${payment.toPersonId}-${payment.amount}`}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="truncate font-medium">
                          {nameOf(payment.fromPersonId)}
                        </span>
                        <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
                        <span className="truncate font-medium">
                          {nameOf(payment.toPersonId)}
                        </span>
                      </span>

                      <span className="shrink-0 font-medium tabular-nums">
                        {formatMoney(payment.amount)}
                      </span>

                      {onRecordPayment ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onRecordPayment(payment)}
                        >
                          {t('money.balances.recordPayment')}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { BalancesCard };
