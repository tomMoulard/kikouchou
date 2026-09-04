/**
 * @fileoverview The single definition of "a raw Tailwind palette class".
 *
 * Two things need this pattern and they must never drift apart:
 *
 * 1. `kikoushou/no-raw-palette-class` (see `./index.js`), which rejects the
 *    class at lint time wherever it is written.
 * 2. `src/components/ui/__tests__/status.variants.test.ts`, which asserts that
 *    `statusVariants` — the thing you are supposed to use instead — never
 *    resolves to one.
 *
 * If the lint rule and that test disagreed about what a palette shade is, the
 * one that mattered would be whichever ran second. So the regex lives here and
 * both import it. Plain JavaScript rather than TypeScript because
 * `eslint.config.js` is loaded by Node with no transpiler in front of it;
 * `raw-palette.d.ts` gives the TypeScript side its types.
 *
 * @module eslint-rules/raw-palette
 */

/**
 * Tailwind utility prefixes that can take a colour.
 *
 * `to`/`from`/`via` are gradient stops, `divide` is the between-children
 * border — all of them spell a colour the same way, so all of them can smuggle
 * one in.
 */
const COLOUR_PREFIXES =
  'bg|text|border|ring|from|to|via|fill|stroke|divide';

/**
 * Tailwind's default palette, plus the two achromatic literals.
 *
 * `white` and `black` are in the list deliberately: they are the shades most
 * often reached for by reflex, and the ones that break dark mode hardest.
 */
const PALETTE_SHADES =
  'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|white|black';

/**
 * Source text of the palette pattern, without flags.
 *
 * The numeric suffix is optional so that `bg-white` and `text-black/80` match
 * alongside `bg-amber-100`.
 */
export const RAW_PALETTE_PATTERN = `\\b(?:${COLOUR_PREFIXES})-(?:${PALETTE_SHADES})(?:-\\d{2,3})?\\b`;

/**
 * Any Tailwind palette shade — what the theme tokens exist to keep out.
 *
 * Deliberately un-flagged: a `g` regex carries `lastIndex` between calls, which
 * makes `expect(...).toMatch()` return different answers on identical input.
 */
export const RAW_PALETTE = new RegExp(RAW_PALETTE_PATTERN);

/**
 * The same pattern, global.
 *
 * Hoisted rather than constructed per call: the lint rule runs `matchRawPalette`
 * on every string literal and template chunk in the repo, and `String#match`
 * zeroes `lastIndex` itself, so sharing one instance is both cheaper and safe.
 */
const RAW_PALETTE_GLOBAL = new RegExp(RAW_PALETTE_PATTERN, 'g');

/**
 * Every palette class in `text`, in source order, deduplicated.
 *
 * @param {string} text Arbitrary source text — a string literal, a template chunk.
 * @returns {string[]} The matched class names, e.g. `['bg-white', 'text-black/80']`.
 */
export function matchRawPalette(text) {
  const matches = text.match(RAW_PALETTE_GLOBAL);
  return matches === null ? [] : [...new Set(matches)];
}
