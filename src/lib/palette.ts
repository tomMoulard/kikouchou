/**
 * @fileoverview Colour palette preference: which palettes exist, what the user
 * chose, and which palette that choice paints on a given day.
 *
 * A palette is a second axis beside the light / dark mode in `lib/theme`, not
 * a replacement for it. The mode stays a class on `<html>` owned by
 * `next-themes`; the palette is a `data-palette` attribute on the same element,
 * and every palette in `index.css` carries a light and a dark variant.
 *
 * The user makes two choices:
 *
 * - a **base** palette, one of the year-round ones, picked in Settings;
 * - whether **seasonal palettes** are on. Off by default. When on, the
 *   month's palette (Halloween in October, and so on) replaces the base for
 *   that month, and the base comes back on the first day of the next one.
 *
 * A seasonal palette is never picked directly. That is what makes "off" mean
 * never: no stored value can paint Halloween while the toggle is off.
 *
 * @module lib/palette
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * localStorage key holding the base palette.
 *
 * Separate from `THEME_STORAGE_KEY`, because `next-themes` owns that one and
 * rewrites any value it does not know.
 */
export const PALETTE_STORAGE_KEY = 'kikouchou-palette';

/**
 * localStorage key holding the seasonal toggle: `on`, or absent for off.
 */
export const SEASONAL_PALETTES_STORAGE_KEY = 'kikouchou-seasonal-palettes';

/**
 * The attribute written on `<html>`. `index.css` selects on it.
 */
export const PALETTE_ATTRIBUTE = 'data-palette';

/**
 * Every palette: the brand default first, the year-round ones next, then the
 * seasonal ones in calendar order.
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
 * The palettes a user can pick as their base, in picker order.
 */
export const BASE_PALETTES = ['default', 'ocean', 'forest'] as const;

/**
 * A palette that can be picked as the base.
 */
export type BasePalette = (typeof BASE_PALETTES)[number];

/**
 * Base palette used when nothing valid is stored.
 */
export const DEFAULT_PALETTE: BasePalette = 'default';

/**
 * The month (1 to 12) each seasonal palette takes over.
 *
 * One month each, on purpose: a window that crosses a year boundary, or
 * depends on a moving feast such as Easter, is where a date bug hides, and a
 * month is what people recognise as "the Halloween month".
 */
export const SEASONAL_PALETTE_MONTHS: Readonly<
  Record<Exclude<Palette, BasePalette>, number>
> = {
  valentine: 2,
  stpatrick: 3,
  halloween: 10,
  christmas: 12,
};

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * What the user chose in Settings.
 */
export interface PalettePreferences {
  readonly base: BasePalette;
  readonly seasonal: boolean;
}

// ============================================================================
// Pure functions
// ============================================================================

/**
 * Narrows an unknown value to a palette identifier.
 *
 * @param value - Candidate value, typically read off the DOM
 * @returns Whether the value names a palette
 */
export function isPalette(value: unknown): value is Palette {
  return (
    typeof value === 'string' && (PALETTES as readonly string[]).includes(value)
  );
}

/**
 * Narrows an unknown value to a base palette.
 *
 * @param value - Candidate value, typically read off localStorage
 * @returns Whether the value names a palette that can be picked
 */
export function isBasePalette(value: unknown): value is BasePalette {
  return (
    typeof value === 'string' &&
    (BASE_PALETTES as readonly string[]).includes(value)
  );
}

/**
 * Finds the seasonal palette of a month.
 *
 * @param month - The month, 1 to 12
 * @returns The month's palette, or `undefined` for an ordinary month
 */
export function seasonalPaletteForMonth(month: number): Palette | undefined {
  return (Object.keys(SEASONAL_PALETTE_MONTHS) as Array<
    keyof typeof SEASONAL_PALETTE_MONTHS
  >).find((palette) => SEASONAL_PALETTE_MONTHS[palette] === month);
}

/**
 * Finds the seasonal palette of a day.
 *
 * @param date - The day, read in local time: October is October where the
 *   user is, not in UTC
 * @returns The day's palette, or `undefined` for an ordinary month
 */
export function seasonalPaletteFor(date: Date): Palette | undefined {
  return seasonalPaletteForMonth(date.getMonth() + 1);
}

/**
 * Decides which palette to paint on a given day.
 *
 * @param preferences - What the user chose
 * @param date - The day, read in local time
 * @returns The month's palette when seasonal palettes are on and the month
 *   has one, else the base
 */
export function resolvePalette(
  preferences: PalettePreferences,
  date: Date,
): Palette {
  return (
    (preferences.seasonal ? seasonalPaletteFor(date) : undefined) ??
    preferences.base
  );
}

// ============================================================================
// Storage
// ============================================================================

/**
 * Reads the stored preferences.
 *
 * @returns The preferences, with defaults for anything absent or invalid.
 *   A seasonal palette stored as the base by an earlier build reads as the
 *   default: it can no longer be picked.
 *
 * @remarks
 * `localStorage` throws in Safari's private mode and when site data is
 * blocked, so the read is guarded, as `lib/theme` guards its own.
 */
export function readStoredPalettePreferences(): PalettePreferences {
  try {
    const base = window.localStorage.getItem(PALETTE_STORAGE_KEY),
      seasonal = window.localStorage.getItem(SEASONAL_PALETTES_STORAGE_KEY);

    return {
      base: isBasePalette(base) ? base : DEFAULT_PALETTE,
      seasonal: seasonal === 'on',
    };
  } catch {
    return { base: DEFAULT_PALETTE, seasonal: false };
  }
}

/**
 * Writes one preference, removing the key for its default value, so a user
 * who never touched the setting and one who went back to it are in the same
 * state.
 *
 * @param key - The storage key
 * @param value - The value to store, or `null` for the default
 */
function writePreference(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Storage unavailable: the choice cannot be kept, and the next read
    // falls back to the defaults.
  }
}

// ============================================================================
// Preference store
// ============================================================================

/*
 * Two readers need the preferences live: the picker, to show them, and
 * `PaletteSync`, to paint them. A module-level store lets a write from one
 * reach the other without a context, and it also follows a write from another
 * tab through the `storage` event.
 */

const listeners = new Set<() => void>();

let snapshot: PalettePreferences | undefined;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function handleStorage(event: StorageEvent): void {
  if (
    event.key === null ||
    event.key === PALETTE_STORAGE_KEY ||
    event.key === SEASONAL_PALETTES_STORAGE_KEY
  ) {
    emit();
  }
}

/**
 * Subscribes to preference changes, for `useSyncExternalStore`.
 *
 * @param listener - Called after every change
 * @returns The unsubscribe function
 */
export function subscribePalettePreferences(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
    }
  };
}

/**
 * Returns the current preferences, the same object until they change.
 *
 * Storage is read on every call and compared with the last answer, rather
 * than cached until a write here says otherwise: a write this module did not
 * make (another tab before its event lands, a test, the console) would
 * otherwise never be seen. `useSyncExternalStore` needs the same object back
 * while nothing changed, which the comparison gives it.
 *
 * @returns The preferences
 */
export function getPalettePreferences(): PalettePreferences {
  const current = readStoredPalettePreferences();

  if (
    snapshot === undefined ||
    snapshot.base !== current.base ||
    snapshot.seasonal !== current.seasonal
  ) {
    snapshot = current;
  }

  return snapshot;
}

/**
 * Stores the base palette.
 *
 * @param base - The palette the user picked
 */
export function storeBasePalette(base: BasePalette): void {
  writePreference(PALETTE_STORAGE_KEY, base === DEFAULT_PALETTE ? null : base);
  emit();
}

/**
 * Stores the seasonal toggle.
 *
 * @param enabled - Whether the month's palette may replace the base
 */
export function storeSeasonalPalettes(enabled: boolean): void {
  writePreference(SEASONAL_PALETTES_STORAGE_KEY, enabled ? 'on' : null);
  emit();
}

// ============================================================================
// DOM
// ============================================================================

/**
 * Writes a palette onto `<html>`.
 *
 * @param palette - The palette to paint
 */
export function applyPalette(palette: Palette): void {
  if (typeof document === 'undefined') {
    return;
  }

  if (document.documentElement.getAttribute(PALETTE_ATTRIBUTE) !== palette) {
    document.documentElement.setAttribute(PALETTE_ATTRIBUTE, palette);
  }
}

/**
 * Writes the stored palette onto `<html>` before the first frame.
 *
 * Called at module scope from `App.tsx`, next to `applyStoredTheme`, so it
 * must never throw: a throw there blanks the app before React renders.
 * `PaletteSync` keeps it right from then on.
 */
export function applyStoredPalette(): void {
  try {
    applyPalette(resolvePalette(readStoredPalettePreferences(), new Date()));
  } catch (error) {
    console.error('Failed to apply the stored palette:', error);
  }
}
