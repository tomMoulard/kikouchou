/**
 * @fileoverview Outfit helpers.
 *
 * @module features/pet/lib/pet-outfit
 */

import { PET_SLOTS, type PetOutfit, type PetSlot } from '../constants';

const SLOT_ORDER = Object.keys(PET_SLOTS) as PetSlot[];

/**
 * A random outfit, with at least one item on so "Surprise me" never answers
 * with a bare pet.
 *
 * @param random - A `[0, 1)` source
 * @returns The outfit
 */
export function randomOutfit(random: () => number = Math.random): PetOutfit {
  const pick = <S extends PetSlot>(slot: S): PetOutfit[S] => {
    const options = PET_SLOTS[slot];

    return options[Math.floor(random() * options.length)] as PetOutfit[S];
  };

  const outfit: PetOutfit = {
    hat: pick('hat'),
    coat: pick('coat'),
    pants: pick('pants'),
    shoes: pick('shoes'),
  };

  return SLOT_ORDER.every((slot) => outfit[slot] === 'none')
    ? { ...outfit, hat: PET_SLOTS.hat[1] }
    : outfit;
}

