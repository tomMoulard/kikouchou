/**
 * @fileoverview What the pet says when it is tapped.
 *
 * The lines are translation keys under `pet.*`, listed here rather than read
 * from the bundle as an array: the unit tests mock i18next to echo keys back,
 * and a key that exists in code can be checked against both locale files.
 *
 * @module features/pet/lib/pet-reactions
 */

import { type PetSpecies } from '../constants';

// ============================================================================
// Constants
// ============================================================================

/** Friendly things to say, under `pet.phrases`. */
export const PET_PHRASES = [
  'hello',
  'happy',
  'favorite',
  'adventure',
  'snacks',
  'scratch',
] as const;

/** Jokes, under `pet.jokes`. */
export const PET_JOKES = ['suitcase', 'dates', 'roomService', 'tent', 'carpool'] as const;

/** Tips on using the app, under `pet.tips`. Each describes a real feature. */
export const PET_TIPS = [
  'share',
  'rooms',
  'headcount',
  'transports',
  'money',
  'assistant',
  'offline',
  'groups',
  'drag',
] as const;

/**
 * How often each kind comes up, out of 1. A heart is the most common because
 * it needs no reading.
 */
const WEIGHTS = [
  ['heart', 0.3],
  ['sound', 0.15],
  ['phrase', 0.2],
  ['joke', 0.15],
  ['tip', 0.2],
] as const;

// ============================================================================
// Type Definitions
// ============================================================================

/** One reply, in a bubble. */
export type PetReaction =
  | { readonly kind: 'heart' }
  | { readonly kind: 'sound' }
  | { readonly kind: 'phrase'; readonly key: (typeof PET_PHRASES)[number] }
  | { readonly kind: 'joke'; readonly key: (typeof PET_JOKES)[number] }
  | { readonly kind: 'tip'; readonly key: (typeof PET_TIPS)[number] };

/** The kind of a reply, as analytics reports it. */
export type PetReactionKind = PetReaction['kind'];

// ============================================================================
// Functions
// ============================================================================

function pickFrom<T>(list: readonly T[], random: () => number, avoid?: T): T {
  const pool = list.length > 1 && avoid !== undefined ? list.filter((item) => item !== avoid) : list;

  return pool[Math.floor(random() * pool.length)] ?? (list[0] as T);
}

function keyOf(reaction: PetReaction | undefined): string | undefined {
  return reaction !== undefined && 'key' in reaction ? reaction.key : undefined;
}

/**
 * Picks a reply to a tap.
 *
 * Never the same line twice in a row: the second tap on a pet that repeats
 * itself is the last one.
 *
 * @param random - A `[0, 1)` source, injectable for tests
 * @param previous - The last reply, to avoid repeating it
 * @returns The reply
 */
export function pickReaction(random: () => number, previous?: PetReaction): PetReaction {
  const roll = random(),
    avoid = keyOf(previous);
  let total = 0,
    kind: PetReactionKind = 'heart';

  for (const [candidate, weight] of WEIGHTS) {
    total += weight;
    if (roll < total) {
      kind = candidate;
      break;
    }
  }

  switch (kind) {
    case 'phrase':
      return { kind, key: pickFrom(PET_PHRASES, random, avoid as (typeof PET_PHRASES)[number]) };
    case 'joke':
      return { kind, key: pickFrom(PET_JOKES, random, avoid as (typeof PET_JOKES)[number]) };
    case 'tip':
      return { kind, key: pickFrom(PET_TIPS, random, avoid as (typeof PET_TIPS)[number]) };
    default:
      return { kind };
  }
}

/**
 * The translation key for a reply's text.
 *
 * @param reaction - The reply
 * @param species - The animal, whose sound depends on it
 * @returns The key
 */
export function reactionTextKey(reaction: PetReaction, species: PetSpecies): string {
  switch (reaction.kind) {
    case 'heart':
      return 'pet.heart';
    case 'sound':
      return `pet.sounds.${species}`;
    case 'phrase':
      return `pet.phrases.${reaction.key}`;
    case 'joke':
      return `pet.jokes.${reaction.key}`;
    case 'tip':
      return `pet.tips.${reaction.key}`;
  }
}
