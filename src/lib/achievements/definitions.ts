/**
 * @fileoverview The achievements the app offers, in display order.
 *
 * Two shapes:
 *
 * - **Families.** Nine of them, each a lifetime counter read against five
 *   stages: trips created, guests added, and so on. Reaching a stage's target
 *   unlocks that stage and shows the next one, so the card can always say how
 *   far the next stage is.
 * - **Specials.** One-shot achievements outside the families. Three are
 *   milestones anybody can read; five are hidden, and the card shows no name
 *   and no hint until one is unlocked.
 *
 * Every stage and every special has its own key. The key is stored on the
 * device and on the server (`public.achievements`), so a key is never renamed:
 * that is why the first stage of the guests family is still `first_guest`.
 * A key that a build does not know is ignored by every reader, which is how
 * an old build survives a new achievement.
 *
 * @module lib/achievements/definitions
 */

// ============================================================================
// Type Definitions
// ============================================================================

/** The device-local counters that families and counting specials read. */
export type AchievementCounter =
  | 'tripsCreated'
  | 'guestsAdded'
  | 'activitiesJoined'
  | 'journeysAdded'
  | 'passengersDriven'
  | 'roomNights'
  | 'moneyLines'
  | 'questionsAsked'
  | 'daysOpened'
  | 'petTaps';

/** Every family, in the order the card shows them. */
export type AchievementFamilyId =
  | 'trips'
  | 'guests'
  | 'activities'
  | 'transports'
  | 'rides'
  | 'rooms'
  | 'money'
  | 'assistant'
  | 'loyalty';

/** The key of a family's stage. Stored as is: never rename one. */
export type AchievementStageKey =
  | 'trips_1'
  | 'trips_3'
  | 'trips_10'
  | 'trips_100'
  | 'trips_1000'
  | 'first_guest'
  | 'guests_10'
  | 'guests_50'
  | 'guests_200'
  | 'guests_1000'
  | 'activities_1'
  | 'activities_5'
  | 'activities_20'
  | 'activities_50'
  | 'activities_100'
  | 'journeys_1'
  | 'journeys_10'
  | 'journeys_50'
  | 'journeys_200'
  | 'journeys_500'
  | 'passengers_1'
  | 'passengers_5'
  | 'passengers_20'
  | 'passengers_50'
  | 'passengers_100'
  | 'nights_1'
  | 'nights_10'
  | 'nights_50'
  | 'nights_200'
  | 'nights_1000'
  | 'money_1'
  | 'money_10'
  | 'money_50'
  | 'money_200'
  | 'money_500'
  | 'first_question'
  | 'questions_10'
  | 'questions_50'
  | 'questions_200'
  | 'questions_500'
  | 'days_5'
  | 'days_15'
  | 'days_30'
  | 'days_60'
  | 'days_100';

/** The key of a one-shot achievement. Stored as is: never rename one. */
export type AchievementSpecialKey =
  | 'full_room'
  | 'group_activity'
  | 'trip_shared'
  | 'midnight_pet'
  | 'petting_zoo'
  | 'leap_day'
  | 'polyglot'
  | 'night_owl';

/** Every achievement key. */
export type AchievementKey = AchievementStageKey | AchievementSpecialKey;

/** One stage of a family. */
export interface AchievementStage {
  readonly key: AchievementStageKey;
  /** The counter value that reaches it. */
  readonly target: number;
}

/** A family: one counter, and its stages from the smallest target up. */
export interface AchievementFamily {
  readonly id: AchievementFamilyId;
  readonly counter: AchievementCounter;
  readonly stages: readonly AchievementStage[];
}

/** How the card shows a special. */
export type AchievementSpecialKind = 'milestone' | 'hidden';

/** A one-shot achievement. */
export interface AchievementSpecial {
  readonly key: AchievementSpecialKey;
  readonly kind: AchievementSpecialKind;
  /** For a counting special: the counter it reads and the value it needs. */
  readonly goal?: {
    readonly counter: AchievementCounter;
    readonly target: number;
  };
}

/** Where a key belongs, for the card, the message and the analytics. */
export type AchievementPlace =
  | { readonly type: 'stage'; readonly family: AchievementFamily; readonly index: number }
  | { readonly type: 'special'; readonly special: AchievementSpecial };

// ============================================================================
// Constants
// ============================================================================

/** The trip stages, smallest first. */
export const TRIP_TIERS = [1, 3, 10, 100, 1000] as const;

/** How many taps on the pet unlock `petting_zoo`. */
export const PETTING_ZOO_TAPS = 100;

/** How many people an activity needs for `group_activity`. */
export const GROUP_ACTIVITY_SIZE = 3;

function stages(
  prefix: string,
  targets: readonly number[],
  firstKey?: AchievementStageKey,
): AchievementStage[] {
  return targets.map((target, index) => ({
    key: (index === 0 && firstKey ? firstKey : `${prefix}_${target}`) as AchievementStageKey,
    target,
  }));
}

/** Every family, in the order the card shows them. */
export const ACHIEVEMENT_FAMILIES: readonly AchievementFamily[] = [
  { id: 'trips', counter: 'tripsCreated', stages: stages('trips', TRIP_TIERS) },
  {
    id: 'guests',
    counter: 'guestsAdded',
    stages: stages('guests', [1, 10, 50, 200, 1000], 'first_guest'),
  },
  {
    id: 'activities',
    counter: 'activitiesJoined',
    stages: stages('activities', [1, 5, 20, 50, 100]),
  },
  {
    id: 'transports',
    counter: 'journeysAdded',
    stages: stages('journeys', [1, 10, 50, 200, 500]),
  },
  {
    id: 'rides',
    counter: 'passengersDriven',
    stages: stages('passengers', [1, 5, 20, 50, 100]),
  },
  { id: 'rooms', counter: 'roomNights', stages: stages('nights', [1, 10, 50, 200, 1000]) },
  { id: 'money', counter: 'moneyLines', stages: stages('money', [1, 10, 50, 200, 500]) },
  {
    id: 'assistant',
    counter: 'questionsAsked',
    stages: stages('questions', [1, 10, 50, 200, 500], 'first_question'),
  },
  { id: 'loyalty', counter: 'daysOpened', stages: stages('days', [5, 15, 30, 60, 100]) },
];

/** Every special, in the order the card lists them. */
export const ACHIEVEMENT_SPECIALS: readonly AchievementSpecial[] = [
  { key: 'full_room', kind: 'milestone' },
  { key: 'group_activity', kind: 'milestone' },
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

/** Every key, families first, in display order. */
export const ACHIEVEMENT_KEYS: readonly AchievementKey[] = [
  ...ACHIEVEMENT_FAMILIES.flatMap((family) => family.stages.map((stage) => stage.key)),
  ...ACHIEVEMENT_SPECIALS.map((special) => special.key),
];

const PLACES: ReadonlyMap<string, AchievementPlace> = new Map<string, AchievementPlace>([
  ...ACHIEVEMENT_FAMILIES.flatMap((family) =>
    family.stages.map(
      (stage, index) =>
        [stage.key, { type: 'stage', family, index }] as [string, AchievementPlace],
    ),
  ),
  ...ACHIEVEMENT_SPECIALS.map(
    (special) => [special.key, { type: 'special', special }] as [string, AchievementPlace],
  ),
]);

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
  return typeof value === 'string' && PLACES.has(value);
}

/**
 * Where a key belongs.
 *
 * @param key - A known key.
 * @returns Its family and stage, or its special.
 */
export function placeOfAchievement(key: AchievementKey): AchievementPlace {
  return PLACES.get(key)!;
}

/**
 * The translation key of an achievement's name.
 *
 * A stage is named in `achievements.stages`, a special in
 * `achievements.items`.
 *
 * @param key - A known key.
 * @returns The `t()` key.
 */
export function achievementNameKey(key: AchievementKey): string {
  return placeOfAchievement(key).type === 'stage'
    ? `achievements.stages.${key}`
    : `achievements.items.${key}.name`;
}

/**
 * The achievements a counter value earns.
 *
 * @param counter - Which counter moved.
 * @param value - Its new value.
 * @returns The keys whose target the value reaches, smallest first.
 */
export function keysEarnedByCounter(
  counter: AchievementCounter,
  value: number,
): AchievementKey[] {
  return [
    ...ACHIEVEMENT_FAMILIES.filter((family) => family.counter === counter).flatMap((family) =>
      family.stages.filter((stage) => value >= stage.target).map((stage) => stage.key),
    ),
    ...ACHIEVEMENT_SPECIALS.filter(
      (special) => special.goal?.counter === counter && value >= special.goal.target,
    ).map((special) => special.key),
  ];
}

/** Where a family stands, as the card draws it. */
export interface FamilyProgress {
  /** The highest stage reached, or -1 before the first. */
  readonly reached: number;
  /** The stage being worked on, or null once every stage is reached. */
  readonly next: AchievementStage | null;
  /** How many more the counter needs for `next`; 0 once complete. */
  readonly remaining: number;
  /** The share of the way from the last stage reached to `next`, 0 to 1. */
  readonly fraction: number;
}

/**
 * Where a family stands.
 *
 * A stage counts as reached when its key is held or the counter has reached
 * its target: a stage pulled from another device is held before the counter
 * catches up.
 *
 * @param family - The family.
 * @param value - Its counter.
 * @param held - The keys held on this device.
 * @returns The progress.
 */
export function familyProgress(
  family: AchievementFamily,
  value: number,
  held: ReadonlySet<string>,
): FamilyProgress {
  let reached = -1;
  family.stages.forEach((stage, index) => {
    if (held.has(stage.key) || value >= stage.target) {
      reached = index;
    }
  });
  const next = family.stages[reached + 1] ?? null;
  if (!next) {
    return { reached, next: null, remaining: 0, fraction: 1 };
  }
  const floor = reached >= 0 ? family.stages[reached]!.target : 0,
    effective = Math.max(value, floor),
    span = next.target - floor;
  return {
    reached,
    next,
    remaining: Math.max(0, next.target - effective),
    fraction: span > 0 ? Math.min(1, Math.max(0, (effective - floor) / span)) : 0,
  };
}
