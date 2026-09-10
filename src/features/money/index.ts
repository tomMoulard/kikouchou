/**
 * @fileoverview Money feature public exports.
 *
 * @module features/money
 */

// ============================================================================
// Pages
// ============================================================================

export {
  TripMoneyPage,
  default as TripMoneyPageDefault,
} from './pages/TripMoneyPage';

// ============================================================================
// Components
// ============================================================================

export { BalancesCard } from './components/BalancesCard';
export type { BalancesCardProps } from './components/BalancesCard';
export { ExpenseCard } from './components/ExpenseCard';
export type { ExpenseCardProps } from './components/ExpenseCard';
export { ExpenseCategoryIcon } from './components/ExpenseCategoryIcon';
export { ExpenseDialog } from './components/ExpenseDialog';
export type { ExpenseDialogProps } from './components/ExpenseDialog';
export { ExpenseForm } from './components/ExpenseForm';
export type { ExpenseFormProps } from './components/ExpenseForm';

// ============================================================================
// Hooks
// ============================================================================

export { useMoneyFormat } from './hooks/useMoneyFormat';

// ============================================================================
// Library
// ============================================================================

export { loadTripNightSplit } from './lib/night-split';
export type { NightSplitGuest, TripNightSplit } from './lib/night-split';
export { roundToCents, splitAmountByWeights } from './lib/weighted-split';
export { computeExpenseShares, movesMoney } from './lib/expense-split';
export type { ExpenseShare, PersonNightCounts } from './lib/expense-split';
export { computeBalances, isSettled, settleBalances } from './lib/balances';
export type { PersonBalance, SettlementPayment } from './lib/balances';
export { loadTripMoney } from './lib/trip-money';
export type { TripMoney } from './lib/trip-money';

// ============================================================================
// Routes
// ============================================================================

export { moneyRoutes } from './routes';
export type { MoneyParams } from './routes';
