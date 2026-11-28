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

import { isAchievementKey, type AchievementKey } from './definitions';

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

// ============================================================================
// Held messages that outlive the page
// ============================================================================

/**
 * Where the held unlocks wait while the page is away.
 *
 * The wizard's sign-in screen holds the message, and Google or a magic link
 * leaves the page from that very screen. Kept in memory, the unlock was gone
 * by the time the visitor came back, and the message never showed.
 */
export const HELD_REWARDS_KEY = 'kikouchou-held-rewards';

/** How long a held message stays worth showing: the sign-in's own window. */
export const HELD_REWARDS_TTL_MS = 30 * 60 * 1000;

/** At most this many keys are kept: more than every achievement is noise. */
const MAX_HELD_KEYS = 64;

/**
 * Remembers the unlocks a hold is keeping back, replacing what was there.
 *
 * An empty list forgets them. Storage that refuses costs the message, never
 * the page.
 *
 * @param keys - The unlocks that wait.
 * @param now - The clock, for tests.
 */
export function rememberHeldRewards(keys: readonly AchievementKey[], now = Date.now()): void {
  try {
    if (keys.length === 0) {
      localStorage.removeItem(HELD_REWARDS_KEY);
      return;
    }
    localStorage.setItem(
      HELD_REWARDS_KEY,
      JSON.stringify({ keys: keys.slice(0, MAX_HELD_KEYS), savedAt: now }),
    );
  } catch {
    // Private mode or a full quota: the message is lost, nothing else.
  }
}

/**
 * Reads and forgets the unlocks a hold kept back before the page went away.
 *
 * The stored value is read like remote input: anything that is not a known
 * key is dropped, and a value older than {@link HELD_REWARDS_TTL_MS} is
 * ignored.
 *
 * @param now - The clock, for tests.
 * @returns The keys still worth announcing, oldest first.
 */
export function takeHeldRewards(now = Date.now()): AchievementKey[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(HELD_REWARDS_KEY);
    localStorage.removeItem(HELD_REWARDS_KEY);
  } catch {
    return [];
  }
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return [];
    }
    const { keys, savedAt } = parsed as { keys?: unknown; savedAt?: unknown };
    if (
      typeof savedAt !== 'number' ||
      !Array.isArray(keys) ||
      savedAt > now ||
      now - savedAt > HELD_REWARDS_TTL_MS
    ) {
      return [];
    }
    return [...new Set(keys.filter(isAchievementKey))].slice(0, MAX_HELD_KEYS);
  } catch {
    return [];
  }
}
