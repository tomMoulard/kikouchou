/**
 * @fileoverview What a pet can be and wear.
 *
 * The lists are closed on purpose: a stored preference is checked against
 * them on every read, so a value an older or newer build wrote reads as the
 * default instead of drawing nothing.
 *
 * @module features/pet/constants
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * The animals, the mascot first.
 *
 * `papillon` is the Continental Toy Spaniel with the butterfly ears.
 */
export const PET_SPECIES = ['pomeranian', 'papillon', 'beaver', 'cat'] as const;

/** Hats, `none` first. */
export const PET_HATS = ['none', 'beret', 'party', 'crown', 'beanie', 'bow'] as const;

/** Coats, `none` first. */
export const PET_COATS = ['none', 'scarf', 'raincoat', 'sweater'] as const;

/** Pants, `none` first. */
export const PET_PANTS = ['none', 'jeans', 'shorts', 'tutu'] as const;

/** Shoes, `none` first. */
export const PET_SHOES = ['none', 'sneakers', 'boots', 'socks'] as const;

/**
 * Every outfit slot and what it accepts, in the order the settings card
 * lists them: head to toe.
 */
export const PET_SLOTS = {
  hat: PET_HATS,
  coat: PET_COATS,
  pants: PET_PANTS,
  shoes: PET_SHOES,
} as const;

// ============================================================================
// Type Definitions
// ============================================================================

/** An animal. */
export type PetSpecies = (typeof PET_SPECIES)[number];

/** A hat. */
export type PetHat = (typeof PET_HATS)[number];

/** A coat. */
export type PetCoat = (typeof PET_COATS)[number];

/** A pair of pants. */
export type PetPants = (typeof PET_PANTS)[number];

/** A pair of shoes. */
export type PetShoes = (typeof PET_SHOES)[number];

/** One outfit slot. */
export type PetSlot = keyof typeof PET_SLOTS;

/** What the pet wears, one item per slot. */
export interface PetOutfit {
  readonly hat: PetHat;
  readonly coat: PetCoat;
  readonly pants: PetPants;
  readonly shoes: PetShoes;
}

/** The whole preference, as the settings card edits it. */
export interface PetPreferences {
  readonly enabled: boolean;
  readonly species: PetSpecies;
  readonly outfit: PetOutfit;
}

// ============================================================================
// Defaults
// ============================================================================

/**
 * The mascot as it ships: a Pomeranian in a beret and a scarf. Off until the
 * user turns it on.
 */
export const DEFAULT_PET_PREFERENCES: PetPreferences = {
  enabled: false,
  species: 'pomeranian',
  outfit: { hat: 'beret', coat: 'scarf', pants: 'none', shoes: 'none' },
};
