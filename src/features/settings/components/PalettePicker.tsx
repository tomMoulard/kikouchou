/**
 * @fileoverview Colour palette picker, shown in the theme card.
 *
 * @module features/settings/components/PalettePicker
 */

import {
  type KeyboardEvent,
  type ReactElement,
  memo,
  useCallback,
  useRef,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';

import { usePalettePreferences } from '@/hooks/usePalettePreferences';
import {
  BASE_PALETTES,
  storeBasePalette,
  type BasePalette,
} from '@/lib/palette';
import { captureEvent } from '@/lib/posthog';
import { cn } from '@/lib/utils';

// ============================================================================
// Component
// ============================================================================

/**
 * Lets the user pick their base palette, one of the year-round ones.
 *
 * Seasonal palettes are not listed: they are not picked, they take over for
 * their month when `SeasonalPalettesToggle` is on. So the checked swatch is
 * always the user's own choice, even in October when Halloween is on screen.
 *
 * Each swatch carries its own `data-palette`, so `index.css` paints it in that
 * palette's colours, in the current light or dark mode, with plain utility
 * classes.
 *
 * @returns The palette radiogroup
 */
export const PalettePicker = memo(function PalettePicker(): ReactElement {
  const { t } = useTranslation();
  const { base } = usePalettePreferences();
  const refs = useRef(new Map<BasePalette, HTMLButtonElement>());

  const select = useCallback((palette: BasePalette): void => {
    captureEvent('palette_changed', { palette });
    storeBasePalette(palette);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      const delta =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0;

      if (delta === 0) {
        return;
      }

      event.preventDefault();
      const index = BASE_PALETTES.indexOf(base),
        next =
          BASE_PALETTES[
            (index + delta + BASE_PALETTES.length) % BASE_PALETTES.length
          ];

      if (next !== undefined) {
        select(next);
        refs.current.get(next)?.focus();
      }
    },
    [base, select],
  );

  const registerRef = useCallback(
    (palette: BasePalette, node: HTMLButtonElement | null): void => {
      if (node) {
        refs.current.set(palette, node);
      } else {
        refs.current.delete(palette);
      }
    },
    [],
  );

  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- APG's radio-group pattern puts a roving `tabIndex` on the radios and leaves the group itself out of the tab order, as `ViewSwitcher` does.
    <div
      role="radiogroup"
      aria-label={t('settings.palette', 'Colors')}
      className="grid grid-cols-3 gap-2"
      onKeyDown={handleKeyDown}
    >
      {BASE_PALETTES.map((palette) => {
        const checked = palette === base;

        return (
          <button
            key={palette}
            ref={(node) => registerRef(palette, node)}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => select(palette)}
            className={cn(
              'flex flex-col gap-2 rounded-lg border p-2 text-left text-sm transition-colors',
              'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              checked ? 'border-primary ring-1 ring-primary' : 'border-border',
            )}
          >
            <span
              data-palette={palette}
              aria-hidden="true"
              className="flex h-10 items-center gap-1.5 rounded-md border border-border bg-background px-2"
            >
              <span className="size-5 rounded-full bg-primary" />
              <span className="size-5 rounded-full bg-accent" />
              <span className="size-5 rounded-full bg-ring" />
            </span>
            <span className="flex items-center justify-between gap-1">
              <span className="font-medium">
                {t(`settings.palettes.${palette}`, palette)}
              </span>
              {checked && (
                <Check className="size-4 text-primary" aria-hidden="true" />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
});
