/**
 * @fileoverview The phone navigation preferences of this device.
 *
 * Read from the settings row, which is device-local: the order and the mode
 * never travel with a trip or an account.
 *
 * @module hooks/useMobileNavPreferences
 */

import { useLiveQuery } from 'dexie-react-hooks';

import {
  DEFAULT_MOBILE_NAV_MODE,
  TRIP_NAV_ITEMS,
  resolveMobileNavMode,
  resolveMobileNavOrder,
} from '@/components/shared/nav-items';
import { getSettings } from '@/lib/db';
import type { MobileNavMode, MobileNavPage } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The resolved preferences: always complete, never `undefined`.
 */
export interface MobileNavPreferences {
  /** Every trip page once; the first four go in the bottom bar */
  readonly order: readonly MobileNavPage[];
  /** Bottom bar, menu button, or automatic */
  readonly mode: MobileNavMode;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * What a render gets before Dexie answers, and on a device that never chose.
 *
 * The default rather than nothing, so the bar is drawn on the first frame and
 * the page does not jump up and down by 64px on every cold start.
 */
const DEFAULT_PREFERENCES: MobileNavPreferences = {
  order: TRIP_NAV_ITEMS.map((item) => item.pathSuffix),
  mode: DEFAULT_MOBILE_NAV_MODE,
};

// ============================================================================
// Hook
// ============================================================================

/**
 * Reads the phone navigation preferences, and follows every change to them.
 *
 * @returns The order and the mode, resolved against their defaults
 */
export function useMobileNavPreferences(): MobileNavPreferences {
  const preferences = useLiveQuery(async (): Promise<MobileNavPreferences> => {
    const settings = await getSettings();
    return {
      order: resolveMobileNavOrder(settings.mobileNavOrder),
      mode: resolveMobileNavMode(settings.mobileNavMode),
    };
  }, []);

  return preferences ?? DEFAULT_PREFERENCES;
}
