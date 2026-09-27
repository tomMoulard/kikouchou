/**
 * @fileoverview Reads the palette currently painted on `<html>`.
 *
 * @module hooks/useActivePalette
 */

import { useSyncExternalStore } from 'react';

import {
  DEFAULT_PALETTE,
  isPalette,
  PALETTE_ATTRIBUTE,
  type Palette,
} from '@/lib/palette';

// ============================================================================
// Store
// ============================================================================

/**
 * Watches the attribute rather than the picker's state.
 *
 * `lib/palette` writes the attribute from three places: the pre-paint call in
 * `App.tsx`, the picker, and the picker's midnight rollover. Observing the DOM
 * follows all three without any of them having to publish, and it also
 * follows a palette set by hand from the console, which is how a seasonal
 * palette is previewed out of its month.
 *
 * @param onChange - Called when the attribute changes
 * @returns The unsubscribe function
 */
function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined') {
    return () => undefined;
  }

  const observer = new MutationObserver(onChange);

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [PALETTE_ATTRIBUTE],
  });

  return () => observer.disconnect();
}

/**
 * @returns The painted palette, or the default when the attribute is missing
 *   or names no palette
 */
function getSnapshot(): Palette {
  const value = document.documentElement.getAttribute(PALETTE_ATTRIBUTE);

  return isPalette(value) ? value : DEFAULT_PALETTE;
}

/**
 * @returns The default: nothing is painted before the client runs
 */
function getServerSnapshot(): Palette {
  return DEFAULT_PALETTE;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Returns the palette painted on `<html>`, and re-renders when it changes.
 *
 * @returns The active palette
 */
export function useActivePalette(): Palette {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
