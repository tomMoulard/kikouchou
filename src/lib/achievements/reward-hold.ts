/**
 * @fileoverview Holds the "achievement unlocked" message back while a screen
 * needs the whole page.
 *
 * The first-trip wizard unlocks `trips_1` as it reaches its invite screen,
 * and that screen is where a visitor signs in. The toast and its close
 * button sat right over the sign-in buttons. A screen like that calls
 * {@link holdRewards}, and the message waits until it lets go.
 *
 * @module lib/achievements/reward-hold
 */

// ============================================================================
// State
// ============================================================================

let holds = 0;
const listeners = new Set<() => void>();

// ============================================================================
// API
// ============================================================================

/**
 * Holds the reward message until the returned function is called.
 *
 * Holds stack: the message waits until every holder has let go. Calling the
 * release twice releases once.
 *
 * @returns The release.
 */
export function holdRewards(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    holds -= 1;
    if (holds === 0) {
      for (const listener of [...listeners]) {
        listener();
      }
    }
  };
}

/**
 * Whether a screen holds the reward message back right now.
 *
 * @returns True while at least one hold is in place.
 */
export function areRewardsHeld(): boolean {
  return holds > 0;
}

/**
 * Calls `listener` each time the last hold is released.
 *
 * @param listener - Called with no argument.
 * @returns The unsubscribe.
 */
export function onRewardsReleased(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
