/**
 * @fileoverview Reads the user's palette preferences, live.
 *
 * @module hooks/usePalettePreferences
 */

import { useSyncExternalStore } from 'react';

import {
  DEFAULT_PALETTE,
  getPalettePreferences,
  subscribePalettePreferences,
  type PalettePreferences,
} from '@/lib/palette';

const SERVER_PREFERENCES: PalettePreferences = {
  base: DEFAULT_PALETTE,
  seasonal: false,
};

/**
 * Returns the base palette and the seasonal toggle, and re-renders when
 * either changes, in this tab or another.
 *
 * @returns The preferences
 */
export function usePalettePreferences(): PalettePreferences {
  return useSyncExternalStore(
    subscribePalettePreferences,
    getPalettePreferences,
    () => SERVER_PREFERENCES,
  );
}
