/**
 * @fileoverview Custom hook for tracking the current day with automatic midnight updates.
 * Handles overnight sessions and page visibility changes to ensure "today" is always current.
 *
 * @module hooks/useToday
 */

import { useEffect, useRef, useState } from 'react';
import { startOfDay, isSameDay } from 'date-fns';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Return type for the useToday hook.
 */
export interface UseTodayResult {
  /**
   * The current day as a Date object.
   * Updated automatically at midnight and when the page becomes visible.
   */
  readonly today: Date;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Interval for checking if the day has changed (in milliseconds).
 * We check every minute rather than setting a timer for exactly midnight
 * because:
 * 1. System sleep/wake can cause timers to drift
 * 2. Simpler and more reliable than calculating exact midnight
 * 3. 1-minute delay is acceptable for this use case
 */
const CHECK_INTERVAL_MS = 60_000; // 1 minute

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Custom hook that provides the current date and automatically updates at midnight.
 * Also updates when the page visibility changes (user returns to tab).
 *
 * This solves the issue where users who leave the app open overnight would see
 * stale "today" highlighting on the calendar.
 *
 * @returns Object containing the current date
 *
 * @example
 * ```tsx
 * function CalendarPage() {
 *   const { today } = useToday();
 *
 *   return (
 *     <div>
 *       {days.map(day => (
 *         <DayCell
 *           key={day.toISOString()}
 *           isToday={isSameDay(day, today)}
 *         />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useToday(): UseTodayResult {
  // Store today at start of day for consistent comparison
  const [today, setToday] = useState<Date>(() => startOfDay(new Date()));

  // Ref to track if component is mounted
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    /**
     * Check if the day has changed and update state if needed.
     * Uses isSameDay to handle timezone edge cases.
     */
    function checkAndUpdateDay(): void {
      if (!isMountedRef.current) return;

      const now = new Date();
      const newToday = startOfDay(now);

      // Only update if the day has actually changed
      setToday((prevToday) => {
        if (isSameDay(prevToday, newToday)) {
          return prevToday; // No change, return same reference
        }
        return newToday;
      });
    }

    /**
     * Handle visibility change - check for day change when user returns to tab.
     * This handles cases where:
     * 1. User left tab open and came back the next day
     * 2. Device was asleep and woke up on a new day
     */
    function handleVisibilityChange(): void {
      if (document.visibilityState === 'visible') {
        checkAndUpdateDay();
      }
    }

    // Set up periodic check (every minute)
    const intervalId = setInterval(checkAndUpdateDay, CHECK_INTERVAL_MS);

    // Set up visibility change listener
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Also check on focus (some browsers don't fire visibilitychange reliably)
    window.addEventListener('focus', checkAndUpdateDay);

    // Cleanup
    return () => {
      isMountedRef.current = false;
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', checkAndUpdateDay);
    };
  }, []);

  return { today };
}

/**
 * Calculate milliseconds until the next midnight.
 * Useful for setting precise timeouts if needed.
 *
 * @returns Milliseconds until next midnight in local time
 *
 * @example
 * ```ts
 * const msUntilMidnight = getMsUntilMidnight();
 * setTimeout(updateDay, msUntilMidnight);
 * ```
 */
export function getMsUntilMidnight(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.getTime() - now.getTime();
}
