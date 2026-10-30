/**
 * @fileoverview Pet feature public exports.
 *
 * `App` imports `components/PetMount` directly rather than this barrel, so
 * the settings card and the drawing stay out of the entry chunk.
 *
 * @module features/pet
 */

// ============================================================================
// Components
// ============================================================================

export { PetMount } from './components/PetMount';
export { PetSettingsCard } from './components/PetSettingsCard';
export { PetSprite } from './components/PetSprite';

// ============================================================================
// Hooks
// ============================================================================

export { usePetPreferences } from './hooks/usePetPreferences';

// ============================================================================
// Constants
// ============================================================================

export {
  DEFAULT_PET_PREFERENCES,
  PET_SLOTS,
  PET_SPECIES,
  type PetOutfit,
  type PetPreferences,
  type PetSlot,
  type PetSpecies,
} from './constants';
