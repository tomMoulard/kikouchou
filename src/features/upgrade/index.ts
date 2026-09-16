/**
 * @fileoverview Barrel export for the upgrade feature module.
 *
 * The fake-door test that asks whether anybody would pay for a paid tier. It
 * has no pages and no routes: one card, rendered on the three screens where the
 * question makes sense, and the hook that remembers the answer.
 *
 * @module features/upgrade
 *
 * @example
 * ```tsx
 * import { UpgradePrompt } from '@/features/upgrade';
 * ```
 */

// ============================================================================
// Components
// ============================================================================

export { UpgradePrompt, type UpgradePromptProps } from './components/UpgradePrompt';

// ============================================================================
// Hooks
// ============================================================================

export { useUpgradeInterest, type UseUpgradeInterestResult } from './hooks/useUpgradeInterest';

// ============================================================================
// Constants
// ============================================================================

export {
  FREE_ACTIVE_TRIP_LIMIT,
  UPGRADE_FEATURE_KEYS,
  UPGRADE_OFFER_FLAG,
  UPGRADE_PLANS,
  UPGRADE_PRICE_EUR_MONTHLY,
  UPGRADE_WAITLIST_EMAIL_PROPERTY,
  isPlausibleEmail,
  upgradeEventProperties,
  type UpgradeFeatureKey,
  type UpgradePlacement,
  type UpgradePlan,
  type UpgradePlanKey,
} from './constants';
