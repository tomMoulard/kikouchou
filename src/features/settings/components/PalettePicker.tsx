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
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  Clover,
  Ghost,
  Heart,
  TreePine,
  type LucideIcon,
} from 'lucide-react';

import { useToday } from '@/hooks/useToday';
import {
  DEFAULT_PALETTE,
  isPaletteAvailable,
  isSeasonalPalette,
  listPalettesForMonth,
  readStoredPalette,
  storePalette,
  type Palette,
} from '@/lib/palette';
import { captureEvent } from '@/lib/posthog';
import { cn } from '@/lib/utils';

// ============================================================================
// Constants
// ============================================================================

/**
 * The mark drawn on a seasonal swatch, so it reads as an occasion rather than
 * as one more colour.
 */
const SEASONAL_ICONS: Partial<Record<Palette, LucideIcon>> = {
  valentine: Heart,
  stpatrick: Clover,
  halloween: Ghost,
  christmas: TreePine,
};

// ============================================================================
// Component
// ============================================================================

/**
 * Lets the user pick a colour palette.
 *
 * Seasonal palettes are listed only in their month (`lib/palette`). The day
 * comes from `useToday`, so a tab left open across midnight on 31 October
 * drops Halloween, and the page with it, without a reload.
 *
 * Each swatch carries its own `data-palette`, so `index.css` paints it in that
 * palette's colours, in the current light or dark mode, with plain utility
 * classes.
 *
 * @returns The palette radiogroup
 */
export const PalettePicker = memo(function PalettePicker(): ReactElement {
  const { t } = useTranslation();
  const { today } = useToday();
  const [selected, setSelected] = useState<Palette>(() => readStoredPalette());
  const refs = useRef(new Map<Palette, HTMLButtonElement>());
  const month = today.getMonth() + 1;
  const options = useMemo(() => listPalettesForMonth(month), [month]);
  const current = isPaletteAvailable(selected, today)
    ? selected
    : DEFAULT_PALETTE;

  const select = useCallback((palette: Palette): void => {
    captureEvent('palette_changed', {
      palette,
      seasonal: isSeasonalPalette(palette),
    });
    storePalette(palette);
    setSelected(palette);
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
      const index = options.indexOf(current),
        next = options[(index + delta + options.length) % options.length];

      if (next !== undefined) {
        select(next);
        refs.current.get(next)?.focus();
      }
    },
    [current, options, select],
  );

  const registerRef = useCallback(
    (palette: Palette, node: HTMLButtonElement | null): void => {
      if (node) {
        refs.current.set(palette, node);
      } else {
        refs.current.delete(palette);
      }
    },
    [],
  );

  // The month ran out while the page was open: paint the default again and
  // forget the seasonal choice, the same thing a reload would do. `selected`
  // keeps its old value on purpose; `current` is what every render reads.
  useEffect(() => {
    if (current !== selected) {
      storePalette(current);
    }
  }, [current, selected]);

  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- APG's radio-group pattern puts a roving `tabIndex` on the radios and leaves the group itself out of the tab order, as `ViewSwitcher` does.
    <div
      role="radiogroup"
      aria-label={t('settings.palette', 'Colors')}
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      onKeyDown={handleKeyDown}
    >
      {options.map((palette) => {
        const checked = palette === current,
          SeasonalIcon = SEASONAL_ICONS[palette];

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
              {SeasonalIcon && (
                <SeasonalIcon className="ml-auto size-4 text-primary" />
              )}
            </span>
            <span className="flex items-center justify-between gap-1">
              <span className="font-medium">
                {t(`settings.palettes.${palette}`, palette)}
              </span>
              {checked && (
                <Check className="size-4 text-primary" aria-hidden="true" />
              )}
            </span>
            {SeasonalIcon && (
              <span className="text-xs text-muted-foreground">
                {t('settings.paletteSeasonal', 'This month only')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});
