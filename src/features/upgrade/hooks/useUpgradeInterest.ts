/**
 * @fileoverview Remembers what this browser already answered about paying.
 *
 * The prompt is shown on three screens at once, so without memory one person
 * would meet it three times on one visit and could answer it three times. That
 * would not break the counts — PostHog counts people, not clicks — but it makes
 * the app nag, and a nag is a bad way to ask somebody a question you want an
 * honest answer to.
 *
 * Two facts, two keys, two lifetimes:
 *
 * - **Declared.** A marker that the question was answered, and nothing else:
 *   not the address, not when it was given. Both would be a record of a person
 *   kept on their own device for no purpose this app has — the address is
 *   already on the PostHog person, which is where the waiting list lives, and
 *   the time it was typed answers no question anybody is asking. What the
 *   marker buys is one thing: the dialog stops asking somebody who already
 *   answered. It changes nothing about the card, which reads the same on every
 *   screen whether the question was answered or not.
 * - **Dismissed.** Kept 30 days, the same cooldown as `usePlanOwnTripPrompt`
 *   and `InstallPrompt`, for the same reason: an offer nobody asked for gets
 *   one answer and then goes away. A dismissal hides the card even after an
 *   address was left — the card is an offer, not a receipt.
 *
 * Both are per browser, like every other preference this app keeps. There is no
 * account behind them, and a person on a phone and a laptop is two answers.
 * That is the same limitation every localStorage flag here has, and the test
 * reads people through PostHog rather than through these keys.
 *
 * @module features/upgrade/hooks/useUpgradeInterest
 */

import { useCallback, useState } from 'react';

// ============================================================================
// Constants
// ============================================================================

/** LocalStorage key marking that this browser answered. */
const DECLARED_STORAGE_KEY = 'kikouchou-upgrade-intent-declared';

/**
 * What that key holds.
 *
 * A constant, deliberately. The obvious alternatives are the address and a
 * timestamp, and this app wants neither on the reader's device: one is a copy
 * of their identity that nothing here reads, the other is a record of when they
 * were asked. The only question is "did they answer", so that is all it stores.
 */
const DECLARED_MARKER = 'declared';

/** LocalStorage key holding the dismissal timestamp. */
const DISMISSAL_STORAGE_KEY = 'kikouchou-upgrade-prompt-dismissed';

/** How long a dismissal hides the prompt (30 days). */
const DISMISSAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * What a screen needs in order to render the prompt, or not render it.
 */
export interface UseUpgradeInterestResult {
  /** Whether the prompt belongs on screen at all. */
  readonly isVisible: boolean;
  /** Whether this browser already said it would pay. */
  readonly hasDeclared: boolean;
  /** Records that the question was answered, so the dialog stops asking. */
  readonly declare: () => void;
  /** Records the dismissal and hides the prompt for 30 days. */
  readonly dismiss: () => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Reads one timestamp key.
 *
 * @param key - The localStorage key to read
 * @returns The stored milliseconds, or null when absent or unreadable
 */
function readTimestamp(key: string): number | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return null;
    }

    const timestamp = parseInt(raw, 10);
    return Number.isNaN(timestamp) ? null : timestamp;
  } catch {
    // Private browsing, disabled storage. Treat it as never answered: showing
    // the prompt once more is a smaller cost than hiding it forever.
    return null;
  }
}

/**
 * Reads one string key.
 *
 * @param key - The localStorage key to read
 * @returns The stored value, or null when absent, empty or unreadable
 */
function readString(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw === null || raw === '' ? null : raw;
  } catch {
    // Private browsing, disabled storage. See above.
    return null;
  }
}

/**
 * Writes one key.
 *
 * Failure is ignored on purpose. What is stored only decides whether a card is
 * on screen and what it says, and the answer has already gone to PostHog by the
 * time this runs, so losing it costs the reader one extra prompt and costs the
 * test nothing.
 *
 * @param key - The localStorage key to write
 * @param value - What to store
 */
function write(key: string, value: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // See above: nothing here is worth surfacing to the reader.
  }
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Decides whether to ask this browser about paying, and remembers the answer.
 *
 * The two flags are read once, when the component mounts, and never watched.
 * Nothing outside this hook writes them, and a person who dismisses the prompt
 * on one screen is not looking at another screen at the same moment.
 *
 * @returns The visibility, the declared state, and the two recorders
 *
 * @example
 * ```tsx
 * const { isVisible, hasDeclared, declare, dismiss } = useUpgradeInterest();
 * ```
 */
export function useUpgradeInterest(): UseUpgradeInterestResult {
  const [hasDeclared, setHasDeclared] = useState<boolean>(
    () => readString(DECLARED_STORAGE_KEY) !== null,
  );

  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    const dismissedAt = readTimestamp(DISMISSAL_STORAGE_KEY);
    return dismissedAt !== null && Date.now() - dismissedAt < DISMISSAL_DURATION_MS;
  });

  const declare = useCallback((): void => {
    write(DECLARED_STORAGE_KEY, DECLARED_MARKER);
    setHasDeclared(true);
  }, []);

  const dismiss = useCallback((): void => {
    write(DISMISSAL_STORAGE_KEY, Date.now().toString());
    setIsDismissed(true);
  }, []);

  return {
    isVisible: !isDismissed,
    hasDeclared,
    declare,
    dismiss,
  };
}
