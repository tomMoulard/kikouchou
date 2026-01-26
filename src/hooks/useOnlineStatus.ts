/**
 * @fileoverview Custom hook for tracking online/offline network status.
 * Provides reactive online status detection with proper cleanup.
 *
 * @module hooks/useOnlineStatus
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Return type for the useOnlineStatus hook.
 */
export interface UseOnlineStatusResult {
  /**
   * Whether the browser currently has network connectivity.
   * Note: `navigator.onLine` can have false positives (connected to network but no internet).
   */
  readonly isOnline: boolean;

  /**
   * Whether the network status recently changed (for showing transition feedback).
   * Resets to false after a short delay.
   */
  readonly hasRecentlyChanged: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Duration in milliseconds to show "recently changed" state.
 * Used to provide visual feedback when coming back online.
 */
const RECENT_CHANGE_DURATION_MS = 3000;

// ============================================================================
// Store for useSyncExternalStore
// ============================================================================

/**
 * Subscriptions for the online status store.
 */
const subscribers = new Set<() => void>();

/**
 * Notify all subscribers of a status change.
 */
function notifySubscribers(): void {
  subscribers.forEach((callback) => callback());
}

/**
 * Subscribe to online status changes.
 *
 * @param callback - Function to call when status changes
 * @returns Unsubscribe function
 */
function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Get the current online status snapshot.
 *
 * @returns Current navigator.onLine value
 */
function getSnapshot(): boolean {
  return navigator.onLine;
}

/**
 * Get the server snapshot for SSR.
 * Always returns true during SSR (assume online).
 *
 * @returns True (optimistic assumption for SSR)
 */
function getServerSnapshot(): boolean {
  return true;
}

// ============================================================================
// Global Event Listener Setup
// ============================================================================

// Set up global event listeners once (not per-hook instance)
if (typeof window !== 'undefined') {
  window.addEventListener('online', notifySubscribers);
  window.addEventListener('offline', notifySubscribers);
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Custom hook for tracking online/offline network status.
 *
 * Features:
 * - Uses `useSyncExternalStore` for proper SSR handling and tear-safe updates
 * - Provides `hasRecentlyChanged` flag for showing "back online" feedback
 * - Handles rapid connection fluctuations with debounced UI feedback
 * - SSR-safe: assumes online during server rendering
 * - Properly cleans up subscriptions
 *
 * @returns Object containing isOnline and hasRecentlyChanged
 *
 * @example
 * ```tsx
 * function NetworkStatus() {
 *   const { isOnline, hasRecentlyChanged } = useOnlineStatus();
 *
 *   if (!isOnline) {
 *     return <div>You are offline</div>;
 *   }
 *
 *   if (hasRecentlyChanged) {
 *     return <div>Back online!</div>;
 *   }
 *
 *   return null;
 * }
 * ```
 */
export function useOnlineStatus(): UseOnlineStatusResult {
  // ============================================================================
  // State via useSyncExternalStore
  // ============================================================================

  /**
   * Current online status using useSyncExternalStore for proper React 18 handling.
   * This avoids hydration mismatches and tearing issues.
   */
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // ============================================================================
  // Local State
  // ============================================================================

  /**
   * Tracks whether the network status recently changed.
   * Used for showing "back online" feedback.
   */
  const [hasRecentlyChanged, setHasRecentlyChanged] = useState(false);

  /**
   * Previous online status for detecting changes.
   */
  const previousOnlineRef = useRef(isOnline);

  // ============================================================================
  // Refs
  // ============================================================================

  /**
   * Timer ref for clearing the "recently changed" state.
   */
  const recentChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Tracks whether the component is still mounted.
   */
  const isMountedRef = useRef(true);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Cleanup effect to track component unmount.
   */
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (recentChangeTimerRef.current) {
        clearTimeout(recentChangeTimerRef.current);
      }
    };
  }, []);

  /**
   * Detect status changes and update hasRecentlyChanged.
   */
  useEffect(() => {
    // Only trigger "recently changed" when going from offline to online
    if (isOnline && !previousOnlineRef.current) {
      // Clear any existing timer
      if (recentChangeTimerRef.current) {
        clearTimeout(recentChangeTimerRef.current);
      }

      setHasRecentlyChanged(true);

      // Reset after duration
      recentChangeTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setHasRecentlyChanged(false);
        }
      }, RECENT_CHANGE_DURATION_MS);
    }

    // Going offline - clear the "recently changed" state
    if (!isOnline && hasRecentlyChanged) {
      setHasRecentlyChanged(false);
      if (recentChangeTimerRef.current) {
        clearTimeout(recentChangeTimerRef.current);
        recentChangeTimerRef.current = null;
      }
    }

    // Update previous state
    previousOnlineRef.current = isOnline;
  }, [isOnline, hasRecentlyChanged]);

  // ============================================================================
  // Return
  // ============================================================================

  return {
    isOnline,
    hasRecentlyChanged,
  };
}
