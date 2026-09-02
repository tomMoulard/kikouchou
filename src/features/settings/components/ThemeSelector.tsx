/**
 * @fileoverview Theme preference card for the settings page.
 *
 * @module features/settings/components/ThemeSelector
 */

import { type ReactElement, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Palette, Sun, type LucideIcon } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ViewSwitcher,
  type ViewSwitcherOption,
} from '@/components/ui/view-switcher';
import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  type ThemePreference,
} from '@/lib/theme';

// ============================================================================
// Constants
// ============================================================================

/**
 * The icon for each preference, in display order.
 *
 * Ordered light -> dark -> system so the two concrete choices sit together and
 * "follow the device" reads as the fallback it is.
 */
const THEME_ICONS: Record<ThemePreference, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

/**
 * Display order of the preferences.
 */
const THEME_ORDER: readonly ThemePreference[] = ['light', 'dark', 'system'];

// ============================================================================
// Component
// ============================================================================

/**
 * Lets the user pick light, dark, or the operating system setting.
 *
 * The choice is persisted by `next-themes` (see `App.tsx`) and takes effect
 * immediately, so — unlike the language selector next to it — there is no
 * confirmation toast: the whole screen changing colour is the confirmation.
 *
 * @returns The theme preference card
 */
export const ThemeSelector = memo(function ThemeSelector(): ReactElement {
  const { t } = useTranslation(),
    { theme, setTheme } = useTheme(),
    // `useTheme` returns `undefined` outside a `ThemeProvider`, and could
    // return a value written by an older build; either way fall back rather
    // than render a segmented control with nothing selected.
    current: ThemePreference = isThemePreference(theme)
      ? theme
      : DEFAULT_THEME_PREFERENCE,
    handleChange = useCallback(
      (value: ThemePreference): void => {
        setTheme(value);
      },
      [setTheme],
    ),
    options = useMemo<readonly ViewSwitcherOption<ThemePreference>[]>(
      () =>
        THEME_ORDER.map((preference) => {
          const Icon = THEME_ICONS[preference];

          return {
            value: preference,
            label: (
              <>
                <Icon className="size-4" aria-hidden="true" />
                {t(`settings.themes.${preference}`, preference)}
              </>
            ),
          };
        }),
      [t],
    );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <Palette className="size-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">
              {t('settings.theme', 'Theme')}
            </CardTitle>
            <CardDescription>
              {t('settings.themeDescription', 'Choose how the app looks')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ViewSwitcher
          value={current}
          onValueChange={handleChange}
          options={options}
          ariaLabel={t('settings.theme', 'Theme')}
          className="w-full sm:w-[320px]"
        />
      </CardContent>
    </Card>
  );
});
