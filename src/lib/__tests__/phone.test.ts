/**
 * @fileoverview Tests for checking and tidying guests' phone numbers.
 */

import { describe, expect, it } from 'vitest';

import { formatPhone, phoneCountriesFor, phoneCountryFor, phoneProblem } from '../phone';

describe('phoneProblem', () => {
  it.each([
    '',
    '   ',
    '0612345678',
    '+33 6 12 34 56 78',
    '+33 (0)6 12-34-56-78',
    '06.12.34.56.78',
    '+1 212 555 0100 x12',
    '06 12 34 56 78 ext. 12',
    '112',
  ])('accepts %j', (value) => {
    expect(phoneProblem(value)).toBeNull();
  });

  it('refuses letters', () => {
    expect(phoneProblem('call me maybe')).toBe('characters');
    expect(phoneProblem('06 12 AB 56 78')).toBe('characters');
  });

  it('refuses a number with fewer than three digits', () => {
    expect(phoneProblem('+3')).toBe('tooShort');
  });

  // The number from the bug report: 25 digits, which no country has.
  it('refuses more than fifteen digits', () => {
    expect(phoneProblem('6466464646464665656656565')).toBe('tooLong');
    expect(phoneProblem('+123 456 789 012 345')).toBeNull();
    expect(phoneProblem('+123 456 789 012 3456')).toBe('tooLong');
  });

  it('does not count an extension towards the digits', () => {
    expect(phoneProblem('+33 6 12 34 56 78 ext. 123456789')).toBeNull();
  });
});

describe('phoneCountryFor', () => {
  it('reads the region of a language tag', () => {
    expect(phoneCountryFor('fr-FR')).toBe('FR');
    expect(phoneCountryFor('en-GB')).toBe('GB');
    expect(phoneCountryFor('en_us')).toBe('US');
  });

  it('reads French without a region as France', () => {
    expect(phoneCountryFor('fr')).toBe('FR');
  });

  it('cannot tell from a language alone otherwise', () => {
    expect(phoneCountryFor('en')).toBeUndefined();
    expect(phoneCountryFor(undefined)).toBeUndefined();
  });
});

describe('phoneCountriesFor', () => {
  it('lists each country once, France last', () => {
    expect(phoneCountriesFor('en-US', 'en')).toEqual(['US', 'FR']);
    expect(phoneCountriesFor('fr-FR', 'fr')).toEqual(['FR']);
    expect(phoneCountriesFor(undefined)).toEqual(['FR']);
  });
});

describe('formatPhone', () => {
  const FRANCE = ['FR'] as const;
  const US_THEN_FRANCE = ['US', 'FR'] as const;

  it('lays out a national number the way its country writes it', () => {
    expect(formatPhone('0612345678', FRANCE)).toBe('06 12 34 56 78');
    expect(formatPhone('2125550123', US_THEN_FRANCE)).toBe('(212) 555-0123');
  });

  it('keeps a number typed with its country code international', () => {
    expect(formatPhone('+33612345678', FRANCE)).toBe('+33 6 12 34 56 78');
    expect(formatPhone('0033612345678', FRANCE)).toBe('+33 6 12 34 56 78');
    expect(formatPhone('+33 (0)6 12 34 56 78', FRANCE)).toBe('+33 6 12 34 56 78');
  });

  // A Pixel set to US English, used in France: its owner's numbers are French.
  it('reads a number that is not valid in the first country from the next', () => {
    expect(formatPhone('0612345678', US_THEN_FRANCE)).toBe('+33 6 12 34 56 78');
  });

  it('keeps an extension', () => {
    expect(formatPhone('06 12 34 56 78 ext. 12', FRANCE)).toBe('06 12 34 56 78 ext. 12');
  });

  it('leaves what it cannot recognise exactly as typed', () => {
    expect(formatPhone('0123', FRANCE)).toBe('0123');
    expect(formatPhone('0612345678')).toBe('0612345678');
    expect(formatPhone(' abc ', FRANCE)).toBe(' abc ');
    expect(formatPhone('6466464646464665656656565', FRANCE)).toBe('6466464646464665656656565');
  });
});
