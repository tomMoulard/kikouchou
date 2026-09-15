/**
 * @fileoverview Shared form submission hook that encapsulates the canonical
 * submit pattern: double-submit guard, unmount safety, error handling, and
 * loading state management.
 *
 * Extracts the duplicated pattern from 11 form components into a single
 * reusable hook, per architecture rule AI-3.
 *
 * @module hooks/useFormSubmission
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { reportError } from '@/lib/posthog';
import { describeCause } from '@/lib/db/repository-error';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Options for configuring the useFormSubmission hook.
 */
interface UseFormSubmissionOptions {
  /** Custom error message i18n key (defaults to 'errors.saveFailed') */
  errorKey?: string;
}

/**
 * Return type of the useFormSubmission hook.
 */
interface UseFormSubmissionReturn<T> {
  /** Whether a submission is currently in progress (for UI state) */
  isSubmitting: boolean;
  /** Error message from the last failed submission, or undefined if no error */
  submitError: string | undefined;
  /** Handles form submission with double-submit guard and error handling */
  handleSubmit: (data: T) => Promise<void>;
  /** Clears the current submit error */
  clearError: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * A shared hook that encapsulates the canonical form submission pattern.
 *
 * Features:
 * - Synchronous double-submit guard via `isSubmittingRef`
 * - Unmount safety via `isMountedRef` (prevents state updates after unmount)
 * - Error state management with i18n support
 * - Re-throws errors so callers (e.g., dialogs) can keep themselves open on failure
 * - Toast notifications remain in calling component (not in hook) per architecture rules
 *
 * @param onSubmit - The async function to call with form data
 * @param options - Optional configuration (custom error key)
 * @returns Object with isSubmitting, submitError, handleSubmit, and clearError
 *
 * @example
 * ```tsx
 * const { isSubmitting, submitError, handleSubmit, clearError } = useFormSubmission<PersonFormData>(
 *   async (data) => {
 *     await createPerson(data);
 *     notify.success(t('persons.created'));
 *     navigate('/persons');
 *   },
 *   { errorKey: 'errors.personSaveFailed' }
 * );
 * ```
 */
export function useFormSubmission<T>(
  onSubmit: (data: T) => Promise<void>,
  options?: UseFormSubmissionOptions,
): UseFormSubmissionReturn<T> {
  const { t } = useTranslation();

  // Synchronous guard against double-submit — isSubmitting state is for UI only
  const isSubmittingRef = useRef(false);

  // Prevents state updates after component unmounts
  const isMountedRef = useRef(true);

  // Store latest onSubmit to avoid stale closures
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  // Store errorKey in ref to avoid unstable dependency in handleSubmit
  const errorKeyRef = useRef(options?.errorKey);
  errorKeyRef.current = options?.errorKey;

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);

  // Track mount state
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleSubmit = useCallback(
    async (data: T) => {
      if (isSubmittingRef.current) return;

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setSubmitError(undefined);

      try {
        await onSubmitRef.current(data);
      } catch (error) {
        // Every form in the app routes its failures through here, and each of
        // their own catch blocks is empty with a "handled by useFormSubmission"
        // comment — so this was the single place where a form's real error went
        // to be replaced by a translated headline and forgotten. The headline
        // stays, because it is the part in the reader's language; the reason is
        // reported and put underneath it.
        reportError(error, { source: 'useFormSubmission', error_key: errorKeyRef.current });
        if (isMountedRef.current) {
          const headline = t(errorKeyRef.current ?? 'errors.saveFailed', 'Save failed');
          // The reason is appended rather than returned separately so every
          // form that already renders `submitError` shows it with no change of
          // its own. Untranslated, because it comes from the browser or from
          // Dexie, and an unhelpful English clause beats a form that says only
          // that saving failed and never why.
          setSubmitError(`${headline}: ${describeCause(error)}`);
        }
        // Re-throw so caller can handle (e.g., keep dialog open)
        throw error;
      } finally {
        isSubmittingRef.current = false;
        if (isMountedRef.current) {
          setIsSubmitting(false);
        }
      }
    },
    [t],
  );

  const clearError = useCallback(() => {
    setSubmitError(undefined);
  }, []);

  return { isSubmitting, submitError, handleSubmit, clearError };
}

// ============================================================================
// Exports
// ============================================================================

export type { UseFormSubmissionOptions, UseFormSubmissionReturn };
