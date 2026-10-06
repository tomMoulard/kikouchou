/**
 * @fileoverview Picking a colour for a new guest.
 *
 * Colour is how guests are told apart on the calendar, the room timeline and
 * every badge, so two people sharing one is not cosmetic — it is the feature
 * failing quietly. Hence "unused first": the palette is exhausted before any
 * colour repeats.
 *
 * Random rather than the next free swatch in palette order, which is the part
 * worth stating because the deterministic version looks equally correct. In
 * order, every trip and every group starts red, orange, yellow, green — so the
 * first four people a user ever adds always look the same, and two guests they
 * think of as a pair get whichever colours their typing order happened to
 * produce. Random inside the unused set keeps the "no duplicates" guarantee and
 * drops the false pattern.
 *
 * Lives here rather than in `ColorPicker` so it stays a pure function of the
 * palette it is handed: the caller passes `DEFAULT_COLORS`, and `lib/` keeps
 * out of `components/`.
 *
 * @module lib/utils/guest-colors
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Last resort when the palette is empty, which no caller in this app does — but
 * a `readonly string[]` parameter allows it and returning `undefined` would push
 * the same fallback into every call site.
 */
const FALLBACK_COLOR = '#3b82f6';

// ============================================================================
// Public API
// ============================================================================

export interface PickRandomUnusedColorArgs {
  /** Colours already spoken for. Compared case-insensitively. */
  readonly usedColors: ReadonlySet<string>;
  /** The palette to choose from, usually `DEFAULT_COLORS`. */
  readonly palette: readonly string[];
}

/**
 * A colour from the palette that nothing is using yet, chosen at random.
 *
 * Falls back to the whole palette once every colour is taken: a repeat is worse
 * than no colour at all, and refusing to return one would leave a guest unable
 * to be created.
 *
 * @param args - The colours in use and the palette to draw from
 * @returns A hex colour string from the palette
 *
 * @example
 * ```typescript
 * const color = pickRandomUnusedColor({
 *   usedColors: new Set(persons.map((person) => person.color)),
 *   palette: DEFAULT_COLORS,
 * });
 * ```
 */
export function pickRandomUnusedColor(args: PickRandomUnusedColorArgs): string {
  const { usedColors, palette } = args,
    normalizedUsed = new Set(Array.from(usedColors, (color) => color.toLowerCase())),
    unused = palette.filter((color) => !normalizedUsed.has(color.toLowerCase())),
    pool = unused.length > 0 ? unused : palette;

  if (pool.length === 0) {
    return FALLBACK_COLOR;
  }

  return pool[Math.floor(Math.random() * pool.length)] ?? FALLBACK_COLOR;
}
