/**
 * @fileoverview Keeps the palette on `<html>` in step with the preferences
 * and the calendar.
 *
 * @module components/shared/PaletteSync
 */

import { useEffect } from 'react';

import { usePalettePreferences } from '@/hooks/usePalettePreferences';
import { useToday } from '@/hooks/useToday';
import { applyPalette, resolvePalette } from '@/lib/palette';

// ============================================================================
// Component
// ============================================================================

/**
 * Paints the palette the preferences resolve to today, and repaints when
 * either changes.
 *
 * Mounted once in `App`, beside the other global chrome, because a seasonal
 * palette has to arrive at midnight on 1 October on whatever page is open,
 * not only on Settings. `applyStoredPalette` paints before the first frame;
 * this takes over once React runs.
 *
 * @returns Nothing: it only writes an attribute
 */
export function PaletteSync(): null {
  const preferences = usePalettePreferences(),
    { today } = useToday(),
    palette = resolvePalette(preferences, today);

  useEffect(() => {
    applyPalette(palette);
  }, [palette]);

  return null;
}
