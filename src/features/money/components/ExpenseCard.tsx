/**
 * @fileoverview One line of the trip's accounts, as a row on the money page.
 *
 * The whole row is the button that opens the line, because that is what a
 * reader reaches for: the question a list of expenses answers is "what was that
 * 84 euros on Saturday?", and the answer is the line itself.
 *
 * @module features/money/components/ExpenseCard
 */

import { type ReactElement, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';

import { statusVariants } from '@/components/ui/status.variants';
import { ExpenseCategoryIcon } from '@/features/money/components/ExpenseCategoryIcon';
import { useMoneyFormat } from '@/features/money/hooks/useMoneyFormat';
import { cn } from '@/lib/utils';
import type { CurrencyCode, Expense, Person, PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link ExpenseCard}.
 */
export interface ExpenseCardProps {
  /** The line to show. */
  readonly expense: Expense;
  /** The trip's guests, for the payer's and beneficiaries' names. */
  readonly personsMap: ReadonlyMap<PersonId, Person>;
  /** The trip's currency, for the amount. */
  readonly currency: CurrencyCode | undefined;
  /** Opens the line. */
  readonly onOpen: (expense: Expense) => void;
}

// ============================================================================
// Component
// ============================================================================

const ExpenseCard = memo(function ExpenseCard({
  expense,
  personsMap,
  currency,
  onOpen,
}: ExpenseCardProps): ReactElement {
  const { t } = useTranslation();
  const formatMoney = useMoneyFormat(currency);

  const handleClick = useCallback((): void => {
    onOpen(expense);
  }, [expense, onOpen]);

  const payerName =
    personsMap.get(expense.payerId)?.name ?? t('money.expense.unknownGuest');
  const payerColor = personsMap.get(expense.payerId)?.color;

  const beneficiaries = expense.splits ?? [];
  const firstBeneficiary = beneficiaries[0];
  const recipientName =
    firstBeneficiary === undefined
      ? t('money.expense.unknownGuest')
      : (personsMap.get(firstBeneficiary.personId)?.name ??
        t('money.expense.unknownGuest'));

  // Three kinds, three sentences. A transfer names both ends, because that is
  // the whole line; the other two name the payer and how many the line was for.
  const subtitle =
    expense.kind === 'transfer'
      ? t('money.expense.transferSummary', { from: payerName, to: recipientName })
      : expense.kind === 'income'
        ? t('money.expense.incomeSummary', {
            name: payerName,
            count: beneficiaries.length,
          })
        : t('money.expense.expenseSummary', {
            name: payerName,
            count: beneficiaries.length,
          });

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left',
        'transition-colors hover:bg-muted/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted"
        style={payerColor ? { backgroundColor: `${payerColor}20` } : undefined}
      >
        {expense.kind === 'transfer' ? (
          <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <ExpenseCategoryIcon category={expense.category} />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{expense.title}</span>
        <span className="block truncate text-sm text-muted-foreground">{subtitle}</span>
      </span>

      <span className="shrink-0 text-right">
        <span
          className={cn(
            'block font-medium tabular-nums',
            expense.kind === 'income'
              ? statusVariants({ tone: 'success', emphasis: 'text' })
              : '',
          )}
        >
          {expense.kind === 'income' ? '+' : ''}
          {formatMoney(expense.amount)}
        </span>
        <span className="block text-xs text-muted-foreground tabular-nums">
          {expense.date}
        </span>
      </span>
    </button>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ExpenseCard };
