/**
 * @fileoverview The trip's money page: what was spent, and who owes whom.
 *
 * Route: `/trips/:tripId/money`
 *
 * Two views of the same rows, because a group asks two questions and they want
 * two different answers:
 *
 * - **Expenses** — the lines themselves, newest first, with a `+` to add one.
 *   Tapping a line opens it.
 * - **Settle up** — one balance per guest, and the shortest list of payments
 *   that clears them. A payment is recorded as a transfer in one tap.
 *
 * The nights each guest slept there are not a view of their own: they are a
 * split rule a line can choose, which is the only place the count was ever
 * acted on.
 *
 * Like `TripSummaryPage`, the read is keyed on the trip id in the URL rather
 * than on the trip contexts, which lag the URL during a trip switch: a balance
 * computed from the previous trip's guests is worse than no balance.
 *
 * @module features/money/pages/TripMoneyPage
 */

import { type ReactElement, memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Wallet } from 'lucide-react';

import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorDisplay } from '@/components/shared/ErrorDisplay';
import { LoadingState } from '@/components/shared/LoadingState';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { ViewSwitcher } from '@/components/ui/view-switcher';
import { readAnalytics } from '@/features/analytics/lib/trip-stats';
import { BalancesCard } from '@/features/money/components/BalancesCard';
import { ExpenseCard } from '@/features/money/components/ExpenseCard';
import { ExpenseDialog } from '@/features/money/components/ExpenseDialog';
import { MoneyConfetti } from '@/features/money/components/MoneyConfetti';
import { useMoneyEasterEgg } from '@/features/money/hooks/useMoneyEasterEgg';
import type { SettlementPayment } from '@/features/money/lib/balances';
import { loadTripMoney } from '@/features/money/lib/trip-money';
import { useOfflineAwareNotify, useTripIdentity } from '@/hooks';
import { useTripAccess } from '@/hooks/useTripAccess';
import { useToday } from '@/hooks/useToday';
import { useTripContext } from '@/contexts/TripContext';
import {
  createExpense,
  deleteExpenseWithOwnershipCheck,
  updateExpenseWithOwnershipCheck,
} from '@/lib/db/repositories/expense-repository';
import { toLocalISODateString } from '@/lib/db/utils';
import { captureUsage } from '@/lib/posthog';
import type {
  Expense,
  ExpenseFormData,
  ISODateString,
  Person,
  PersonId,
  TripId,
} from '@/types';
import { reportFailure } from '@/lib/errors/report-failure';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Which answer is on screen.
 */
type MoneyView = 'expenses' | 'balances';

/** The views, in the order the switcher offers them. */
const MONEY_VIEWS: readonly MoneyView[] = ['expenses', 'balances'];

/** Query parameter carrying the view, so a reload and a back button keep it. */
const VIEW_PARAM = 'view';

// ============================================================================
// Page
// ============================================================================

const TripMoneyPage = memo(function TripMoneyPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { today } = useToday();
  const { notifySuccess } = useOfflineAwareNotify();
  // Bumped by Retry, so a failed read is attempted again rather than sitting on
  // the same rejected promise.
  const [retryToken, setRetryToken] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const { tripId: tripIdFromUrl } = useParams<'tripId'>();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<Expense['id'] | undefined>(
    undefined,
  );

  const {
    trips,
    currentTrip,
    isLoading: isTripLoading,
    error: tripError,
    setCurrentTrip,
    checkConnection,
  } = useTripContext();

  const { canEdit } = useTripAccess();
  const { myPersonId } = useTripIdentity();
  const { runId: confettiRunId, registerTap } = useMoneyEasterEgg();

  useEffect(() => {
    if (tripIdFromUrl && !isTripLoading && currentTrip?.id !== tripIdFromUrl) {
      setCurrentTrip(tripIdFromUrl).catch((err) => {
        console.error('Failed to set current trip from URL:', err);
      });
    }
  }, [tripIdFromUrl, currentTrip?.id, isTripLoading, setCurrentTrip]);

  // Existence is decided from the trips list rather than from `currentTrip`,
  // which is still the previous trip while a switch is in flight.
  const trip = useMemo(
    () => trips.find((candidate) => candidate.id === tripIdFromUrl),
    [trips, tripIdFromUrl],
  );

  const rawView = searchParams.get(VIEW_PARAM);
  const currentView: MoneyView = MONEY_VIEWS.includes(rawView as MoneyView)
    ? (rawView as MoneyView)
    : 'expenses';

  const handleViewChange = useCallback(
    (value: string): void => {
      const next = new URLSearchParams(searchParams);
      next.set(VIEW_PARAM, value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // `readAnalytics` turns a failed read into a value instead of a throw, so the
  // failure shows as an in-page `ErrorDisplay` rather than replacing the whole
  // route through the ErrorBoundary.
  const result = useLiveQuery(
    async () => {
      if (tripIdFromUrl === undefined) {
        return null;
      }
      return readAnalytics('load the trip money', () =>
        loadTripMoney(tripIdFromUrl as TripId),
      );
    },
    [tripIdFromUrl, retryToken],
  );

  const readError = result?.error ?? null;
  const money = result?.data ?? null;

  const expenses = useMemo(() => money?.expenses ?? [], [money]);
  const persons = useMemo(() => money?.persons ?? [], [money]);
  const personNights = useMemo(() => money?.personNights ?? new Map(), [money]);

  const personsMap = useMemo(
    () => new Map<PersonId, Person>(persons.map((person) => [person.id, person])),
    [persons],
  );

  const editingExpense = useMemo(
    () => expenses.find((candidate) => candidate.id === editingExpenseId),
    [expenses, editingExpenseId],
  );

  /**
   * Day a new line falls on: today while the trip is running, its first day
   * otherwise. Saves the most common bit of typing.
   */
  const defaultDate = useMemo((): ISODateString | undefined => {
    if (!trip) {
      return undefined;
    }
    const todayKey = toLocalISODateString(today);
    return todayKey >= trip.startDate && todayKey <= trip.endDate
      ? todayKey
      : trip.startDate;
  }, [trip, today]);

  const backLink = tripIdFromUrl ? `/trips/${tripIdFromUrl}/calendar` : '/trips';

  const handleBack = useCallback((): void => {
    void navigate(backLink);
  }, [navigate, backLink]);

  const handleRetry = useCallback((): void => {
    void checkConnection().catch(() => {
      // Whatever went wrong is already in the context's own error state.
    });
    setRetryToken((previous) => previous + 1);
  }, [checkConnection]);

  const handleAddExpense = useCallback((): void => {
    setEditingExpenseId(undefined);
    setIsDialogOpen(true);
  }, []);

  const handleOpenExpense = useCallback((expense: Expense): void => {
    setEditingExpenseId(expense.id);
    setIsDialogOpen(true);
  }, []);

  const handleDialogOpenChange = useCallback((open: boolean): void => {
    setIsDialogOpen(open);
    if (!open) {
      setEditingExpenseId(undefined);
    }
  }, []);

  const handleSave = useCallback(
    async (data: ExpenseFormData, expense: Expense | undefined): Promise<void> => {
      if (!tripIdFromUrl) {
        return;
      }
      const tripId = tripIdFromUrl as TripId;

      if (expense) {
        await updateExpenseWithOwnershipCheck(expense.id, tripId, data);
      } else {
        await createExpense(tripId, data);
      }

      captureUsage('expense_saved', {
        operation: expense ? 'updated' : 'created',
        kind: data.kind,
        category: data.category,
        split_mode: data.splitMode,
        beneficiary_count: data.splits.length,
      });
    },
    [tripIdFromUrl],
  );

  const handleDelete = useCallback(
    async (expense: Expense): Promise<void> => {
      if (!tripIdFromUrl) {
        return;
      }

      try {
        await deleteExpenseWithOwnershipCheck(expense.id, tripIdFromUrl as TripId);
        notifySuccess(t('money.expense.deleteSuccess'));
      } catch (error) {
        reportFailure(
          'TripMoneyPage.deleteExpense',
          error,
          t('errors.deleteFailed'),
        );
        throw error; // Keep the dialog open so the user can retry
      }
    },
    [notifySuccess, t, tripIdFromUrl],
  );

  /**
   * Writes down a settling payment as a transfer.
   *
   * The payment already names both ends and the amount, so there is nothing
   * left to type — and a suggestion nobody can act on in one tap is a
   * suggestion nobody acts on. It is an ordinary line afterwards: it shows in
   * the list and can be deleted like any other.
   */
  const handleRecordPayment = useCallback(
    (payment: SettlementPayment): void => {
      if (!tripIdFromUrl || !defaultDate) {
        return;
      }

      const fromName = personsMap.get(payment.fromPersonId)?.name ?? '';
      const toName = personsMap.get(payment.toPersonId)?.name ?? '';

      void createExpense(tripIdFromUrl as TripId, {
        kind: 'transfer',
        category: 'other',
        title: t('money.balances.paymentTitle', { from: fromName, to: toName }),
        date: defaultDate,
        amount: payment.amount,
        payerId: payment.fromPersonId,
        splitMode: 'equal',
        splits: [{ personId: payment.toPersonId, value: payment.amount }],
      })
        .then(() => {
          notifySuccess(t('money.balances.paymentRecorded'));
          captureUsage('expense_saved', {
            operation: 'created',
            kind: 'transfer',
            category: 'other',
            split_mode: 'equal',
            beneficiary_count: 1,
          });
        })
        .catch((error: unknown) => {
          reportFailure(
            'TripMoneyPage.recordThePayment',
            error,
            t('money.balances.paymentFailed'),
          );
        });
    },
    [defaultDate, notifySuccess, personsMap, t, tripIdFromUrl],
  );

  const isLoading = isTripLoading || (tripIdFromUrl !== undefined && result === undefined);

  // ==========================================================================
  // Render: Loading
  // ==========================================================================

  if (isLoading) {
    return (
      <div className="container max-w-3xl py-6 md:py-8">
        <PageHeader title={t('money.title')} />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <LoadingState variant="inline" size="lg" />
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: Error
  // ==========================================================================

  if (readError) {
    return (
      <div className="container max-w-3xl py-6 md:py-8">
        <PageHeader title={t('money.title')} />
        <ErrorDisplay error={readError} onRetry={handleRetry} onBack={handleBack} />
      </div>
    );
  }

  // ==========================================================================
  // Render: Trip Not Found
  // ==========================================================================

  // Before the context's own error: an id that is not on this device makes
  // `setCurrentTrip` reject, and showing that as "failed to load" with a Retry
  // button is the wrong answer to a mistyped URL.
  if (!tripIdFromUrl || trip === undefined || money === null) {
    return (
      <div className="container max-w-3xl py-6 md:py-8">
        <PageHeader title={t('money.title')} backLink="/trips" />
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <EmptyState
            icon={Wallet}
            title={t('errors.tripNotFound')}
            description={t('errors.tripNotFoundDescription')}
            action={{ label: t('common.back'), onClick: handleBack }}
          />
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Render: Trip Context Error
  // ==========================================================================

  if (tripError) {
    return (
      <div className="container max-w-3xl py-6 md:py-8">
        <PageHeader title={t('money.title')} description={t('money.description')} />
        <ErrorDisplay error={tripError} onRetry={handleRetry} onBack={handleBack} />
      </div>
    );
  }

  // ==========================================================================
  // Render: The Page
  // ==========================================================================

  return (
    <div className="container max-w-3xl space-y-6 py-6 md:py-8">
      <PageHeader
        title={t('money.title')}
        description={t('money.description')}
        onTitleClick={registerTap}
        action={
          canEdit ? (
            <div className="hidden sm:flex items-center gap-2">
              <Button onClick={handleAddExpense}>
                <Plus className="size-4 mr-2" aria-hidden="true" />
                {t('money.expense.new')}
              </Button>
            </div>
          ) : undefined
        }
      />

      <ViewSwitcher
        value={currentView}
        onValueChange={handleViewChange}
        ariaLabel={t('money.view.ariaLabel')}
        options={[
          { value: 'expenses', label: t('money.view.expenses') },
          { value: 'balances', label: t('money.view.balances') },
        ]}
      />

      {currentView === 'expenses' ? (
        expenses.length === 0 ? (
          <div className="flex min-h-[200px] items-center justify-center rounded-lg border">
            <EmptyState
              icon={Wallet}
              title={t('money.expense.empty')}
              description={t('money.expense.emptyDescription')}
              {...(canEdit
                ? { action: { label: t('money.expense.new'), onClick: handleAddExpense } }
                : {})}
            />
          </div>
        ) : (
          <ul className="space-y-2" aria-label={t('money.view.expenses')}>
            {expenses.map((expense) => (
              <li key={expense.id}>
                <ExpenseCard
                  expense={expense}
                  personsMap={personsMap}
                  currency={trip.currency}
                  onOpen={handleOpenExpense}
                />
              </li>
            ))}
          </ul>
        )
      ) : (
        <BalancesCard
          expenses={expenses}
          persons={persons}
          personNights={personNights}
          currency={trip.currency}
          onRecordPayment={canEdit ? handleRecordPayment : undefined}
        />
      )}

      {/* Floating action button for mobile */}
      {canEdit && currentView === 'expenses' && (
        <Button
          onClick={handleAddExpense}
          size="lg"
          className="fixed bottom-nav-safe right-4 z-10 size-14 rounded-full shadow-lg sm:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={t('money.expense.new')}
        >
          <Plus className="size-6" aria-hidden="true" />
        </Button>
      )}

      {confettiRunId === null ? null : <MoneyConfetti runId={confettiRunId} />}

      <ExpenseDialog
        expense={editingExpense}
        open={isDialogOpen}
        onOpenChange={handleDialogOpenChange}
        persons={persons}
        personNights={personNights}
        currency={trip?.currency}
        defaultDate={defaultDate}
        defaultPayerId={myPersonId}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TripMoneyPage };
export default TripMoneyPage;
