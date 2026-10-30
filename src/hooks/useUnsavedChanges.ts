/**
 * @fileoverview Hook for guarding against unsaved changes in forms.
 * Uses React Router's `useBlocker` for in-app navigation blocking and
 * the `beforeunload` event for browser-level protection (tab close, refresh).
 *
 * This is a COMPANION to `useFormSubmission`, not a replacement.
 *
 * @module hooks/useUnsavedChanges
 */

import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Return type of the useUnsavedChanges hook.
 */
interface UseUnsavedChangesReturn {
  /** The React Router blocker object */
  readonly blocker: ReturnType<typeof useBlocker>;
  /** Whether the blocker is currently active (navigation was intercepted) */
  readonly isBlocked: boolean;
  /** Proceed with the blocked navigation */
  readonly proceed: () => void;
  /** Cancel the blocked navigation and stay on the page */
  readonly reset: () => void;
  /**
   * Skip the blocker for the next navigation. Call this before navigate()
   * when you want to intentionally navigate away (e.g., after successful save)
   * without waiting for isDirty state to update.
   */
  readonly skipNextBlock: () => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook that guards against navigating away with unsaved changes.
 *
 * Features:
 * - Uses React Router's `useBlocker` to intercept in-app navigation when `isDirty` is true
 * - Registers a `beforeunload` event listener when `isDirty` is true (browser tab close/refresh)
 * - Returns blocker state for rendering a confirmation dialog
 * - Cleans up both the blocker and beforeunload listener on unmount or when `isDirty` changes to false
 *
 * @param isDirty - Whether the form has unsaved changes
 * @returns Object with blocker state and control functions
 *
 * @example
 * ```tsx
 * const { isBlocked, proceed, reset } = useUnsavedChanges(isDirty);
 *
 * return (
 *   <>
 *     <form>...</form>
 *     {isBlocked && (
 *       <UnsavedChangesDialog
 *         open={isBlocked}
 *         onStay={reset}
 *         onLeave={proceed}
 *       />
 *     )}
 *   </>
 * );
 * ```
 */
export function useUnsavedChanges(isDirty: boolean): UseUnsavedChangesReturn {
  // Ref to allow bypassing the blocker for intentional navigation (e.g., after save).
  // Set skipBlockerRef.current = true before calling navigate() to prevent the
  // blocker from firing when isDirty hasn't re-rendered to false yet.
  const skipBlockerRef = useRef(false);

  // Block in-app navigation when form is dirty.
  // Note: Only compares pathname, not search params or hash. This is intentional —
  // forms in this app don't use query params, so hash/search changes are safe to ignore.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => {
      if (skipBlockerRef.current) {
        skipBlockerRef.current = false;
        return false;
      }
      return isDirty && currentLocation.pathname !== nextLocation.pathname;
    },
  );

  const isBlocked = blocker.state === 'blocked';

  // Register beforeunload handler for browser-level protection
  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      // Modern browsers ignore custom messages but still show a generic prompt
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const proceed = useCallback(() => {
    if (blocker.state === 'blocked') {
      blocker.proceed();
    }
  }, [blocker]);

  const reset = useCallback(() => {
    if (blocker.state === 'blocked') {
      blocker.reset();
    }
  }, [blocker]);

  const skipNextBlock = useCallback(() => {
    skipBlockerRef.current = true;
  }, []);

  return { blocker, isBlocked, proceed, reset, skipNextBlock };
}

// ============================================================================
// Exports
// ============================================================================

export type { UseUnsavedChangesReturn };
