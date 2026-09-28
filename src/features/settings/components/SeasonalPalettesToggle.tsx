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
import { useToday } from '@/hooks/useToday';
import { seasonalPaletteFor, storeSeasonalPalettes } from '@/lib/palette';
import { captureEvent } from '@/lib/posthog';

// ============================================================================
// Constants
// ============================================================================

const SWITCH_ID = 'seasonal-palettes';
const DESCRIPTION_ID = 'seasonal-palettes-description';

// ============================================================================
// Component
// ============================================================================

/**
 * Turns seasonal palettes on or off. Off by default.
 *
 * Off means never: no seasonal palette, whatever the month. On, the month's
 * palette replaces the user's colors for the month and the colors come back
 * afterwards. When one is on screen right now, a line under the switch says
 * which, so the checked swatch above it does not look like a lie.
 *
 * @returns The toggle row
 */
export const SeasonalPalettesToggle = memo(
  function SeasonalPalettesToggle(): ReactElement {
    const { t } = useTranslation();
    const { seasonal } = usePalettePreferences();
    const { today } = useToday();
    const thisMonth = seasonal ? seasonalPaletteFor(today) : undefined;

    const handleChange = useCallback((enabled: boolean): void => {
      captureEvent('seasonal_palettes_toggled', { enabled });
      storeSeasonalPalettes(enabled);
    }, []);

    return (
      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div className="space-y-1">
          <Label htmlFor={SWITCH_ID} className="text-sm font-medium">
            {t('settings.seasonalPalettes', 'Seasonal themes')}
          </Label>
          <p id={DESCRIPTION_ID} className="text-sm text-muted-foreground">
            {t(
              'settings.seasonalPalettesDescription',
              "Halloween in October, Christmas in December, Valentine's Day in February and Saint Patrick's in March replace your colors for that month.",
            )}
          </p>
          {thisMonth !== undefined && (
            <p className="text-sm font-medium text-primary">
              {t('settings.seasonalPalettesActive', {
                defaultValue: 'This month: {{name}}',
                name: t(`settings.palettes.${thisMonth}`, thisMonth),
              })}
            </p>
          )}
        </div>
        <Switch
          id={SWITCH_ID}
          checked={seasonal}
          onCheckedChange={handleChange}
          aria-describedby={DESCRIPTION_ID}
        />
      </div>
    );
  },
);
