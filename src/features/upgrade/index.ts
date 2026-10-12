/**
 * @fileoverview Barrel export for the upgrade feature module.
 *
 * The fake-door test that asks whether anybody would pay for a paid tier. It
 * has no pages and no routes: the dialog that describes the offer, and the hook
 * that remembers the answer. `TripTemplateCard` opens that dialog, from the arm
 * of the trip settings screen the enterprise flag has turned off.
 *
 * @module features/upgrade
 *
 * @example
 * ```tsx
 * import { UpgradeOfferDialog } from '@/features/upgrade';
 * ```
 */

// ============================================================================
// Components
// ============================================================================

export {
  UpgradeOfferDialog,
  type UpgradeOfferDialogProps,
} from './components/UpgradeOfferDialog';

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
