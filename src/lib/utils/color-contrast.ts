/**
 * @fileoverview Relative luminance and the black-or-white text decision.
 *
 * Two implementations of this existed — `features/calendar/utils/calendar-utils`
 * for calendar chips and `components/shared/PersonBadge` for guest badges — and
 * they were written to disagree at the boundary (`< 0.179 ? white` against
 * `> 0.179 ? black`) and to accept different inputs: only the badge's parser
 * understood `#rgb` shorthand or an `#rrggbbaa` alpha suffix. The same guest
 * colour could therefore be given white text on the calendar and black on a
 * badge.
 *
 * @module lib/utils/color-contrast
 */

/** RGB channels normalised to 0–1. */
export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * The luminance at which white and black text contrast equally against a
 * background: `sqrt(1.05 * 0.05) - 0.05`, per the WCAG contrast formula.
 *
 * Below it white wins, above it black. The comparison is `<`, so a colour
 * sitting exactly on the line gets *black* text — the calendar's answer, kept
 * over `PersonBadge`'s, though no 8-bit colour lands on it.
 */
export const LUMINANCE_THRESHOLD = 0.179;

/**
 * Middle luminance, returned for a colour that cannot be parsed. It picks black
 * text, which is legible on the light surfaces an unparseable colour tends to
 * fall back to.
 */
const UNKNOWN_LUMINANCE = 0.5;

/**
 * Parses a hex colour into 0–1 RGB channels.
 *
 * Accepts `#rgb`, `#rrggbb` and `#rrggbbaa`, with or without the leading `#`,
 * in either case. The alpha channel is dropped: text contrast is decided
 * against the colour as painted, and the badge that carries it is opaque.
 *
 * @param hex - The colour to parse
 * @returns The channels, or `null` if the string is not a hex colour
 *
 * @example
 * ```ts
 * parseHexColor('#f50');    // { r: 1, g: 0.333…, b: 0 }
 * parseHexColor('nonsense'); // null
 * ```
 */
export function parseHexColor(hex: string): RgbColor | null {
  let normalized = hex.replace(/^#/, '').toLowerCase();

  // Drop an alpha suffix — but only from something that is hex all the way
  // through. Slicing first would let `#003366zz` through as a valid colour,
  // which is a hole the calendar's stricter parser did not have.
  if (/^[0-9a-f]{8}$/.test(normalized)) {
    normalized = normalized.slice(0, 6);
  }

  // Expand shorthand.
  if (normalized.length === 3) {
    normalized = normalized
      .split('')
      .map((channel) => channel + channel)
      .join('');
  }

  if (!/^[0-9a-f]{6}$/.test(normalized)) {
    return null;
  }

  return {
    r: parseInt(normalized.slice(0, 2), 16) / 255,
    g: parseInt(normalized.slice(2, 4), 16) / 255,
    b: parseInt(normalized.slice(4, 6), 16) / 255,
  };
}

/**
 * Relative luminance of already-parsed channels, per WCAG 2.1.
 *
 * @param rgb - Channels normalised to 0–1
 * @returns Luminance from 0 (black) to 1 (white)
 *
 * @see https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
export function getRgbLuminance(rgb: RgbColor): number {
  const linearize = (channel: number): number =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

  return (
    0.2126 * linearize(rgb.r) +
    0.7152 * linearize(rgb.g) +
    0.0722 * linearize(rgb.b)
  );
}

/**
 * Relative luminance of a hex colour.
 *
 * @param hex - Hex colour, with or without `#`
 * @returns Luminance from 0 to 1, or 0.5 for anything unparseable
 */
export function getLuminance(hex: string): number {
  const rgb = parseHexColor(hex);
  return rgb === null ? UNKNOWN_LUMINANCE : getRgbLuminance(rgb);
}

/**
 * Picks the text colour that reads best on a background.
 *
 * @param bgColor - Background hex colour
 * @returns `'white'` or `'black'`
 *
 * @example
 * ```ts
 * getContrastTextColor('#1d4ed8'); // 'white'
 * getContrastTextColor('#fde047'); // 'black'
 * ```
 */
export function getContrastTextColor(bgColor: string): 'white' | 'black' {
  return getLuminance(bgColor) < LUMINANCE_THRESHOLD ? 'white' : 'black';
}

/**
 * The same decision as {@link getContrastTextColor}, as a hex value for the
 * places that set `color` inline rather than through a class.
 *
 * @param bgColor - Background hex colour
 * @returns `'#FFFFFF'` or `'#000000'`
 */
export function getContrastTextHex(bgColor: string): '#FFFFFF' | '#000000' {
  return getContrastTextColor(bgColor) === 'white' ? '#FFFFFF' : '#000000';
}
