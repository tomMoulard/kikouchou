/**
 * @fileoverview Tests for the shared luminance / text-contrast helper.
 *
 * @module lib/utils/__tests__/color-contrast.test
 */

import { describe, expect, it } from 'vitest';

import {
  LUMINANCE_THRESHOLD,
  getContrastTextColor,
  getContrastTextHex,
  getLuminance,
  parseHexColor,
} from '@/lib/utils/color-contrast';

describe('parseHexColor', () => {
  it('parses six-digit hex with and without the hash', () => {
    expect(parseHexColor('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(parseHexColor('000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('expands three-digit shorthand', () => {
    expect(parseHexColor('#fff')).toEqual(parseHexColor('#ffffff'));
  });

  it('drops an alpha suffix', () => {
    expect(parseHexColor('#ffffff80')).toEqual(parseHexColor('#ffffff'));
  });

  it('is case-insensitive', () => {
    expect(parseHexColor('#AbCdEf')).toEqual(parseHexColor('#abcdef'));
  });

  it('returns null for anything that is not a hex colour', () => {
    expect(parseHexColor('rebeccapurple')).toBeNull();
    expect(parseHexColor('#12345')).toBeNull();
    expect(parseHexColor('')).toBeNull();
  });

  it('rejects an eight-character value whose alpha pair is not hex', () => {
    // Slicing to six before validating would have accepted these.
    expect(parseHexColor('#003366zz')).toBeNull();
    expect(parseHexColor('#ffffff!!')).toBeNull();
  });
});

describe('getLuminance', () => {
  it('spans black to white', () => {
    expect(getLuminance('#000000')).toBe(0);
    expect(getLuminance('#ffffff')).toBe(1);
  });

  it('falls back to mid-grey luminance for an invalid colour', () => {
    expect(getLuminance('not-a-colour')).toBe(0.5);
  });
});

describe('getContrastTextColor', () => {
  it('puts white on dark backgrounds', () => {
    expect(getContrastTextColor('#000000')).toBe('white');
    expect(getContrastTextColor('#1a1a1a')).toBe('white');
    expect(getContrastTextColor('#0000ff')).toBe('white');
  });

  it('puts black on light backgrounds', () => {
    expect(getContrastTextColor('#ffffff')).toBe('black');
    expect(getContrastTextColor('#ffff00')).toBe('black');
    expect(getContrastTextColor('#00ff00')).toBe('black');
  });

  it('answers the same for shorthand, alpha and full hex of one colour', () => {
    expect(getContrastTextColor('#036')).toBe(getContrastTextColor('#003366'));
    expect(getContrastTextColor('#003366ff')).toBe(getContrastTextColor('#003366'));
  });

  it('flips at the WCAG break-even luminance', () => {
    // #757575 sits at 0.1779 and #767676 at 0.1812 — one either side of the
    // luminance where white and black contrast equally.
    expect(LUMINANCE_THRESHOLD).toBeCloseTo(Math.sqrt(1.05 * 0.05) - 0.05, 3);
    expect(getContrastTextColor('#757575')).toBe('white');
    expect(getContrastTextColor('#767676')).toBe('black');
  });
});

describe('getContrastTextHex', () => {
  it('mirrors getContrastTextColor as a hex value', () => {
    expect(getContrastTextHex('#000000')).toBe('#FFFFFF');
    expect(getContrastTextHex('#ffffff')).toBe('#000000');
    // The neutral-grey fallback used by PersonBadge takes white text.
    expect(getContrastTextHex('#6B7280')).toBe('#FFFFFF');
  });
});
