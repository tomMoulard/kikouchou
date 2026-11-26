/**
 * @fileoverview The achievements the app offers, in display order.
 *
 * Fifteen of them, in three groups:
 *
 * - **Tiers**: trips created, at 1, 3, 10, 100 and 1000. They read one
 *   lifetime counter, so the card can show how far the next tier is.
 * - **Milestones**: the first time somebody uses a feature that matters.
 * - **Hidden**: the card shows no name and no hint until one is unlocked.
 *
 * The key is stored on the device and on the server (`public.achievements`),
 * so a key is never renamed. A key that a build does not know is ignored by
 * every reader, which is how an old build survives a new achievement.
 *
 * @module lib/achievements/definitions
 */

// ============================================================================
// Type Definitions
// ============================================================================

/** Which group an achievement belongs to, and so how the card shows it. */
export type AchievementKind = 'tier' | 'milestone' | 'hidden';

/** The device-local counters that tiers and counting achievements read. */
export type AchievementCounter = 'tripsCreated' | 'petTaps';

/** Every achievement key. Stored as is: never rename one. */
export type AchievementKey =
  | 'trips_1'
  | 'trips_3'
  | 'trips_10'
  | 'trips_100'
  | 'trips_1000'
  | 'first_guest'
  | 'full_room'
  | 'group_activity'
  | 'first_question'
  | 'trip_shared'
  | 'midnight_pet'
  | 'petting_zoo'
  | 'leap_day'
  | 'polyglot'
  | 'night_owl';

/** One achievement, as the card and the unlock logic read it. */
export interface AchievementDefinition {
  readonly key: AchievementKey;
  readonly kind: AchievementKind;
  /** For a counting achievement: the counter it reads and the value it needs. */
  readonly goal?: {
    readonly counter: AchievementCounter;
    readonly target: number;
  };
}

// ============================================================================
// Constants
// ============================================================================

/** The trip tiers, smallest first. */
export const TRIP_TIERS = [1, 3, 10, 100, 1000] as const;

/** How many taps on the pet unlock `petting_zoo`. */
export const PETTING_ZOO_TAPS = 100;

/** Every achievement, in the order the card lists them. */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  ...TRIP_TIERS.map(
    (target): AchievementDefinition => ({
      key: `trips_${target}` as AchievementKey,
      kind: 'tier',
      goal: { counter: 'tripsCreated', target },
    }),
  ),
  { key: 'first_guest', kind: 'milestone' },
  { key: 'full_room', kind: 'milestone' },
  { key: 'group_activity', kind: 'milestone' },
  { key: 'first_question', kind: 'milestone' },
  { key: 'trip_shared', kind: 'milestone' },
  { key: 'midnight_pet', kind: 'hidden' },
  {
    key: 'petting_zoo',
    kind: 'hidden',
    goal: { counter: 'petTaps', target: PETTING_ZOO_TAPS },
  },
  { key: 'leap_day', kind: 'hidden' },
  { key: 'polyglot', kind: 'hidden' },
  { key: 'night_owl', kind: 'hidden' },
];

const KNOWN_KEYS: ReadonlySet<string> = new Set(ACHIEVEMENTS.map((a) => a.key));

/** How many people an activity needs for `group_activity`. */
export const GROUP_ACTIVITY_SIZE = 3;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Narrows a string read from storage or the server to a known key.
 *
 * @param value - Anything.
 * @returns Whether this build knows the key.
 */
export function isAchievementKey(value: unknown): value is AchievementKey {
  return typeof value === 'string' && KNOWN_KEYS.has(value);
}

/**
 * The achievements a counter value earns.
 *
 * @param counter - Which counter moved.
 * @param value - Its new value.
 * @returns The keys whose goal the value reaches.
 */
export function keysEarnedByCounter(
  counter: AchievementCounter,
  value: number,
): AchievementKey[] {
  return ACHIEVEMENTS.filter(
    (a) => a.goal?.counter === counter && value >= a.goal.target,
  ).map((a) => a.key);
}
