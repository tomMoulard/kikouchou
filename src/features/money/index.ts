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

export { NightSplitCard } from './components/NightSplitCard';
export type { NightSplitCardProps } from './components/NightSplitCard';

// ============================================================================
// Library
// ============================================================================

export { loadTripNightSplit } from './lib/night-split';
export type { NightSplitGuest, TripNightSplit } from './lib/night-split';
export { splitAmountByPersonNights } from './lib/amount-split';
export type { AmountShare } from './lib/amount-split';

// ============================================================================
// Routes
// ============================================================================

export { moneyRoutes } from './routes';
export type { MoneyParams } from './routes';
