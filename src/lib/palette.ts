/**
 * @fileoverview Colour palette preference: which palettes exist, which of
 * them the calendar currently offers, and how the stored one reaches the DOM.
 *
 * A palette is a second axis beside the light / dark mode in `lib/theme`, not
 * a replacement for it. The mode stays a class on `<html>` owned by
 * `next-themes`; the palette is a `data-palette` attribute on the same element,
 * and every palette in `index.css` carries a light and a dark variant. So a
 * user picks "Ocean" once and still gets the dark ocean at night.
 *
 * Some palettes are seasonal: Halloween exists in October and nowhere else.
 * They are small easter eggs, so the picker lists one only in its month, and a
 * stored seasonal palette whose month has passed reads as the default.
 *
 * @module lib/palette
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * localStorage key holding the palette.
 *
 * Separate from `THEME_STORAGE_KEY`, because `next-themes` owns that one and
 * rewrites any value it does not know.
 */
export const PALETTE_STORAGE_KEY = 'kikouchou-palette';

/**
 * The attribute written on `<html>`. `index.css` selects on it.
 */
export const PALETTE_ATTRIBUTE = 'data-palette';

/**
 * Every palette, in the order the picker shows them: the brand default first,
 * the year-round ones next, then the seasonal ones in calendar order.
 */
export const PALETTES = [
  'default',
  'ocean',
  'forest',
  'valentine',
  'stpatrick',
  'halloween',
  'christmas',
] as const;

/**
 * A palette identifier.
 */
export type Palette = (typeof PALETTES)[number];

/**
 * Palette used when nothing is stored, or when the stored one is out of season.
 */
export const DEFAULT_PALETTE: Palette = 'default';

/**
 * The month (1 to 12) each seasonal palette is offered in.
 *
 * A palette absent from this map is offered all year. One month each, on
 * purpose: a window that crosses a year boundary, or depends on a moving feast
 * such as Easter, is where a date bug hides, and a month is what people
 * recognise as "the Halloween month".
 */
export const SEASONAL_PALETTE_MONTHS: Partial<Record<Palette, number>> = {
  valentine: 2,
  stpatrick: 3,
  halloween: 10,
  christmas: 12,
};

// ============================================================================
// Functions
// ============================================================================

/**
 * Narrows an unknown value to a palette identifier.
 *
 * @param value - Candidate value, typically read off localStorage
 * @returns Whether the value names a palette
 */
export function isPalette(value: unknown): value is Palette {
  return (
    typeof value === 'string' && (PALETTES as readonly string[]).includes(value)
  );
}

/**
 * Tells whether a palette only exists for part of the year.
 *
 * @param palette - The palette to test
 * @returns Whether the palette is seasonal
 */
export function isSeasonalPalette(palette: Palette): boolean {
  return SEASONAL_PALETTE_MONTHS[palette] !== undefined;
}

/**
 * Tells whether a palette is on offer on a given day.
 *
 * @param palette - The palette to test
 * @param date - The day, read in local time: October is October where the
 *   user is, not in UTC
 * @returns Whether the palette may be picked and painted on that day
 */
export function isPaletteAvailable(palette: Palette, date: Date): boolean {
  const month = SEASONAL_PALETTE_MONTHS[palette];

  return month === undefined || month === date.getMonth() + 1;
}

/**
 * Lists the palettes on offer on a given day, in picker order.
 *
 * @param date - The day, read in local time
 * @returns The palettes the picker shows
 */
export function listAvailablePalettes(date: Date): readonly Palette[] {
  return listPalettesForMonth(date.getMonth() + 1);
}

/**
 * Lists the palettes on offer in a given month, in picker order.
 *
 * The same answer as {@link listAvailablePalettes}, keyed by a number, so a
 * component can memoize on a primitive rather than on a `Date`.
 *
 * @param month - The month, 1 to 12
 * @returns The palettes the picker shows
 */
export function listPalettesForMonth(month: number): readonly Palette[] {
  return PALETTES.filter((palette) => {
    const seasonMonth = SEASONAL_PALETTE_MONTHS[palette];

    return seasonMonth === undefined || seasonMonth === month;
  });
}

/**
 * Resolves a stored value to the palette to paint on a given day.
 *
 * @param value - The stored value, validated here
 * @param date - The day, read in local time
 * @returns The stored palette when it is valid and in season, else the default
 */
export function resolvePalette(value: unknown, date: Date): Palette {
  return isPalette(value) && isPaletteAvailable(value, date)
    ? value
    : DEFAULT_PALETTE;
}

/**
 * Reads the stored palette as it applies on a given day.
 *
 * @param date - The day, read in local time
 * @returns The palette to paint
 *
 * @remarks
 * `localStorage` throws in Safari's private mode and when site data is
 * blocked, so the read is guarded, as `lib/theme` guards its own.
 */
export function readStoredPalette(date: Date = new Date()): Palette {
  try {
    return resolvePalette(window.localStorage.getItem(PALETTE_STORAGE_KEY), date);
  } catch {
    return DEFAULT_PALETTE;
  }
}

/**
 * Writes a palette onto `<html>`.
 *
 * @param palette - The palette to paint
 */
export function applyPalette(palette: Palette): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.setAttribute(PALETTE_ATTRIBUTE, palette);
}

/**
 * Stores a palette and paints it.
 *
 * The default is stored by removing the key, so a user who never touched the
 * picker and one who went back to the default are in the same state.
 *
 * @param palette - The palette the user picked
 */
export function storePalette(palette: Palette): void {
  applyPalette(palette);

  try {
    if (palette === DEFAULT_PALETTE) {
      window.localStorage.removeItem(PALETTE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PALETTE_STORAGE_KEY, palette);
    }
  } catch {
    // Storage unavailable: the palette is painted for this visit only.
  }
}

/**
 * Writes the stored palette onto `<html>` before the first frame.
 *
 * Called at module scope from `App.tsx`, next to `applyStoredTheme`, so it
 * must never throw: a throw there blanks the app before React renders.
 *
 * A seasonal palette whose month has passed is also cleared from storage. It
 * would otherwise come back on its own a year later, which reads as a bug
 * rather than as an easter egg.
 */
export function applyStoredPalette(): void {
  try {
    const palette = readStoredPalette();

    applyPalette(palette);

    if (
      palette === DEFAULT_PALETTE &&
      window.localStorage.getItem(PALETTE_STORAGE_KEY) !== null
    ) {
      window.localStorage.removeItem(PALETTE_STORAGE_KEY);
    }
  } catch (error) {
    console.error('Failed to apply the stored palette:', error);
  }
}
