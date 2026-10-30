/**
 * @fileoverview The switch that lets a seasonal palette replace the user's
 * colors for its month.
 *
 * @module features/settings/components/SeasonalPalettesToggle
 */

import { type ReactElement, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { usePalettePreferences } from '@/hooks/usePalettePreferences';
import { storeSeasonalPalettes } from '@/lib/palette';
import { captureEvent } from '@/lib/posthog';

// ============================================================================
// Constants
// ============================================================================

const SWITCH_ID = 'seasonal-palettes';

// ============================================================================
// Component
// ============================================================================

/**
 * Turns seasonal palettes on or off. Off by default.
 *
 * Off means never: no seasonal palette, whatever the month. On, the month's
 * palette replaces the user's colors for the month and the colors come back
 * afterwards.
 *
 * The label says "Special themes" and nothing more, on purpose: which theme
 * arrives, and when, is left for the user to find out. It is an easter egg.
 *
 * @returns The toggle row
 */
export const SeasonalPalettesToggle = memo(
  function SeasonalPalettesToggle(): ReactElement {
    const { t } = useTranslation();
    const { seasonal } = usePalettePreferences();

    const handleChange = useCallback((enabled: boolean): void => {
      captureEvent('seasonal_palettes_toggled', { enabled });
      storeSeasonalPalettes(enabled);
    }, []);

    return (
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={SWITCH_ID} className="text-sm font-medium">
          {t('settings.seasonalPalettes', 'Special themes')}
        </Label>
        <Switch
          id={SWITCH_ID}
          checked={seasonal}
          onCheckedChange={handleChange}
        />
      </div>
    );
  },
);
