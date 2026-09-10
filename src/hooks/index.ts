/**
 * @fileoverview Barrel export for custom React hooks.
 *
 * @module hooks
 */

// Network status
export { useOnlineStatus, type UseOnlineStatusResult } from './useOnlineStatus';

// PWA installation
export {
  useInstallPrompt,
  type UseInstallPromptResult,
  type ManualInstallPlatform,
} from './useInstallPrompt';

// Form submission
export {
  useFormSubmission,
  type UseFormSubmissionOptions,
  type UseFormSubmissionReturn,
} from './useFormSubmission';

// Unsaved changes guard
export {
  useUnsavedChanges,
  type UseUnsavedChangesReturn,
} from './useUnsavedChanges';

// Offline-aware success confirmation
export {
  useOfflineAwareNotify,
  type UseOfflineAwareNotifyReturn,
} from './useOfflineAwareNotify';

// Trip identity — which guest this device belongs to
export { useTripIdentity, type UseTripIdentityResult } from './useTripIdentity';

// Trip access — whether this device may edit the current trip
export {
  tripAccessOf,
  useTripAccess,
  type TripAccess,
  type UseTripAccessResult,
} from './useTripAccess';

// Date/time utilities
export { useToday, getMsUntilMidnight, type UseTodayResult } from './useToday';

// The app's minute clock — the one implementation of "now", refreshed on resume
export { useNowMs, NOW_REFRESH_INTERVAL_MS } from './useNowMs';

// Feature flags
export { useFeatureFlag, readFlagOverride, FLAG_OVERRIDE_PREFIX } from './useFeatureFlag';
