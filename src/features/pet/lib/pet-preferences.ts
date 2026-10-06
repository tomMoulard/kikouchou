/**
 * @fileoverview The pet preference: on or off, which animal, what it wears.
 *
 * A device preference, like the palette in `lib/palette`: it lives in
 * localStorage, never syncs, and follows the same module-level store so the
 * settings card and the pet on screen see one write at once, in this tab and
 * in any other.
 *
 * @module features/pet/lib/pet-preferences
 */

import {
  DEFAULT_PET_PREFERENCES,
  PET_SLOTS,
  PET_SPECIES,
  type PetOutfit,
  type PetPreferences,
  type PetSlot,
  type PetSpecies,
} from '../constants';

// ============================================================================
// Constants
// ============================================================================

/**
 * localStorage key holding the preference as JSON, or absent for the default.
 */
export const PET_STORAGE_KEY = 'kikouchou-pet';

// ============================================================================
// Parsing
// ============================================================================

function isSpecies(value: unknown): value is PetSpecies {
  return (PET_SPECIES as readonly unknown[]).includes(value);
}

function readSlot<S extends PetSlot>(
  slot: S,
  value: unknown,
): PetOutfit[S] {
  const allowed: readonly unknown[] = PET_SLOTS[slot];

  return (allowed.includes(value) ? value : DEFAULT_PET_PREFERENCES.outfit[slot]) as PetOutfit[S];
}

/**
 * Turns whatever storage held into a preference, field by field.
 *
 * A field that is missing or unknown falls back to its default on its own,
 * so a hat a later build added does not also cost the user their animal.
 *
 * @param raw - The stored string, or `null`
 * @returns The preference
 */
export function parsePetPreferences(raw: string | null): PetPreferences {
  if (raw === null) {
    return DEFAULT_PET_PREFERENCES;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_PET_PREFERENCES;
  }

  if (typeof value !== 'object' || value === null) {
    return DEFAULT_PET_PREFERENCES;
  }

  const record = value as Record<string, unknown>,
    outfit =
      typeof record.outfit === 'object' && record.outfit !== null
        ? (record.outfit as Record<string, unknown>)
        : {};

  return {
    enabled: record.enabled === true,
    species: isSpecies(record.species) ? record.species : DEFAULT_PET_PREFERENCES.species,
    outfit: {
      hat: readSlot('hat', outfit.hat),
      coat: readSlot('coat', outfit.coat),
      pants: readSlot('pants', outfit.pants),
      shoes: readSlot('shoes', outfit.shoes),
    },
  };
}

function isSamePreference(a: PetPreferences, b: PetPreferences): boolean {
  return (
    a.enabled === b.enabled &&
    a.species === b.species &&
    a.outfit.hat === b.outfit.hat &&
    a.outfit.coat === b.outfit.coat &&
    a.outfit.pants === b.outfit.pants &&
    a.outfit.shoes === b.outfit.shoes
  );
}

/**
 * Reads the stored preference.
 *
 * @returns The preference, with defaults for anything absent or invalid
 *
 * @remarks
 * `localStorage` throws in Safari's private mode and when site data is
 * blocked, so the read is guarded.
 */
export function readStoredPetPreferences(): PetPreferences {
  try {
    return parsePetPreferences(window.localStorage.getItem(PET_STORAGE_KEY));
  } catch {
    return DEFAULT_PET_PREFERENCES;
  }
}

function writePetPreferences(preferences: PetPreferences): void {
  try {
    if (isSamePreference(preferences, DEFAULT_PET_PREFERENCES)) {
      window.localStorage.removeItem(PET_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(preferences));
    }
  } catch {
    // Storage unavailable: the choice lasts until the next read.
  }
}

// ============================================================================
// Preference store
// ============================================================================

const listeners = new Set<() => void>();

let snapshot: PetPreferences | undefined;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function handleStorage(event: StorageEvent): void {
  if (event.key === null || event.key === PET_STORAGE_KEY) {
    emit();
  }
}

/**
 * Subscribes to preference changes, for `useSyncExternalStore`.
 *
 * @param listener - Called after every change
 * @returns The unsubscribe function
 */
export function subscribePetPreferences(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
    }
  };
}

/**
 * Returns the current preference, the same object until it changes.
 *
 * Storage is read on every call and compared with the last answer, as
 * `getPalettePreferences` does, so a write from elsewhere is never missed.
 *
 * @returns The preference
 */
export function getPetPreferences(): PetPreferences {
  const current = readStoredPetPreferences();

  if (snapshot === undefined || !isSamePreference(snapshot, current)) {
    snapshot = current;
  }

  return snapshot;
}

/**
 * Turns the pet on or off. The animal and the outfit are kept either way.
 *
 * @param enabled - Whether the pet is on screen
 */
export function storePetEnabled(enabled: boolean): void {
  writePetPreferences({ ...readStoredPetPreferences(), enabled });
  emit();
}

/**
 * Stores the animal.
 *
 * @param species - The animal the user picked
 */
export function storePetSpecies(species: PetSpecies): void {
  writePetPreferences({ ...readStoredPetPreferences(), species });
  emit();
}

/**
 * Stores one outfit item.
 *
 * @param slot - The slot
 * @param item - The item for that slot
 */
export function storePetOutfitItem<S extends PetSlot>(slot: S, item: PetOutfit[S]): void {
  const current = readStoredPetPreferences();

  writePetPreferences({ ...current, outfit: { ...current.outfit, [slot]: item } });
  emit();
}

/**
 * Stores a whole outfit at once, for "Surprise me".
 *
 * @param outfit - The outfit
 */
export function storePetOutfit(outfit: PetOutfit): void {
  writePetPreferences({ ...readStoredPetPreferences(), outfit });
  emit();
}
