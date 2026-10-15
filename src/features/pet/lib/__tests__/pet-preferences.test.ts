/**
 * @fileoverview Tests for the pet preference store.
 *
 * @module features/pet/lib/__tests__/pet-preferences.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installLocalStorageDouble } from '@/test/local-storage';

import { DEFAULT_PET_PREFERENCES } from '../../constants';
import {
  PET_STORAGE_KEY,
  getPetPreferences,
  parsePetPreferences,
  storePetEnabled,
  storePetOutfit,
  storePetOutfitItem,
  storePetSpecies,
  subscribePetPreferences,
} from '../pet-preferences';

const storage = installLocalStorageDouble();

describe('parsePetPreferences', () => {
  it('answers the default for nothing stored, and for garbage', () => {
    expect(parsePetPreferences(null)).toBe(DEFAULT_PET_PREFERENCES);
    expect(parsePetPreferences('{not json')).toBe(DEFAULT_PET_PREFERENCES);
    expect(parsePetPreferences('"a string"')).toBe(DEFAULT_PET_PREFERENCES);
    expect(parsePetPreferences('null')).toBe(DEFAULT_PET_PREFERENCES);
  });

  it('falls back field by field, so one unknown item keeps the rest', () => {
    expect(
      parsePetPreferences(
        JSON.stringify({
          enabled: true,
          species: 'cat',
          outfit: { hat: 'sombrero', coat: 'raincoat', pants: 42, shoes: 'boots' },
        }),
      ),
    ).toEqual({
      enabled: true,
      species: 'cat',
      outfit: { hat: 'beret', coat: 'raincoat', pants: 'none', shoes: 'boots' },
    });
  });

  it('reads an unknown animal as the mascot and a missing outfit as the default one', () => {
    expect(parsePetPreferences(JSON.stringify({ enabled: 'yes', species: 'dragon' }))).toEqual(
      DEFAULT_PET_PREFERENCES,
    );
  });
});

describe('the store', () => {
  beforeEach(() => {
    storage.clear();
    storage.setThrowing(false);
  });

  it('keeps the animal and the outfit when the pet is turned off', () => {
    storePetSpecies('beaver');
    storePetOutfitItem('shoes', 'boots');
    storePetEnabled(true);
    storePetEnabled(false);

    expect(getPetPreferences()).toEqual({
      enabled: false,
      species: 'beaver',
      outfit: { ...DEFAULT_PET_PREFERENCES.outfit, shoes: 'boots' },
    });
  });

  it('removes the key when the preference is back to the default', () => {
    storePetEnabled(true);
    expect(storage.entries.has(PET_STORAGE_KEY)).toBe(true);

    storePetEnabled(false);
    expect(storage.entries.has(PET_STORAGE_KEY)).toBe(false);
  });

  it('returns the same object until something changes', () => {
    const first = getPetPreferences();

    expect(getPetPreferences()).toBe(first);

    storePetOutfit({ hat: 'crown', coat: 'none', pants: 'tutu', shoes: 'socks' });
    expect(getPetPreferences()).not.toBe(first);
    expect(getPetPreferences().outfit.pants).toBe('tutu');
  });

  it('tells subscribers, and follows a write from another tab', () => {
    const listener = vi.fn(),
      unsubscribe = subscribePetPreferences(listener);

    storePetEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new StorageEvent('storage', { key: PET_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    storePetEnabled(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('survives storage that refuses writes', () => {
    storage.setThrowing(true);

    expect(() => storePetEnabled(true)).not.toThrow();
    expect(getPetPreferences()).toEqual(DEFAULT_PET_PREFERENCES);
  });
});
