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
} from './useInstallPrompt';

// Form submission
export {
  useFormSubmission,
  type UseFormSubmissionOptions,
  type UseFormSubmissionReturn,
} from './useFormSubmission';

// Date/time utilities
export { useToday, getMsUntilMidnight, type UseTodayResult } from './useToday';
