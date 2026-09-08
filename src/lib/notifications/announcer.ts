/**
 * @fileoverview The screen-reader half of a confirmation.
 *
 * A sonner toast carried its own `role="status"`, so moving confirmations to
 * the operating system would have made them silent for anyone using a screen
 * reader: an OS notification is outside the document, and nothing in the page
 * says the room was created. This is the live region that keeps saying it.
 *
 * A pub/sub rather than a context because {@link notify} is called from
 * plain functions as well as components — event handlers, `useTripActions`,
 * the sharing helpers — and none of them can read a React context.
 *
 * @module lib/notifications/announcer
 */

// ============================================================================
// Type Definitions
// ============================================================================

/** Receives each message as it is announced. */
export type StatusListener = (message: string) => void;

// ============================================================================
// Module State
// ============================================================================

/**
 * The mounted live regions.
 *
 * A set, not a single slot: React remounts `StatusAnnouncer` on a fast refresh
 * and mounts a second one in tests, and an announcement lost to a stale
 * reference is the exact bug the `Toaster` remount caused for toasts
 * (`src/App.tsx`).
 */
const listeners = new Set<StatusListener>();

// ============================================================================
// API
// ============================================================================

/**
 * Announces a message in every mounted live region.
 *
 * Silently does nothing when none is mounted. The announcement is a courtesy
 * on top of the OS notification, so it never gates delivery.
 *
 * @param message - The message, already translated.
 */
export function announceStatus(message: string): void {
  for (const listener of listeners) {
    listener(message);
  }
}

/**
 * Subscribes a live region, and returns its unsubscribe.
 *
 * @param listener - Called with each announced message.
 * @returns The cleanup to run on unmount.
 *
 * @example
 * ```ts
 * useEffect(() => subscribeToStatus(setMessage), []);
 * ```
 */
export function subscribeToStatus(listener: StatusListener): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}
