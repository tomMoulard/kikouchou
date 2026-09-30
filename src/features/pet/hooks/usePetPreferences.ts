/**
 * @fileoverview Reads the pet preference, live.
 *
 * @module features/pet/hooks/usePetPreferences
 */

import { useSyncExternalStore } from 'react';

import { DEFAULT_PET_PREFERENCES, type PetPreferences } from '../constants';
import { getPetPreferences, subscribePetPreferences } from '../lib/pet-preferences';

/**
 * Returns the pet preference and re-renders when it changes, in this tab or
 * another.
 *
 * @returns The preference
 */
export function usePetPreferences(): PetPreferences {
  return useSyncExternalStore(
    subscribePetPreferences,
    getPetPreferences,
    () => DEFAULT_PET_PREFERENCES,
  );
}
