/**
 * @fileoverview Checking and tidying the phone numbers guests are given.
 *
 * The number is stored as people type it, and is still only ever read by
 * people: these helpers never reject a number a phone could dial. They catch
 * what no phone can dial (letters, more digits than any country has) and lay
 * out a number they recognise the way that country writes it, so
 * "0612345678" reads "06 12 34 56 78" on the guest card.
 *
 * @module lib/phone
 */

import { type TFunction } from 'i18next';
import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js/min';

// ============================================================================
// Constants
// ============================================================================

/** E.164: no number anywhere has more digits than this, country code included. */
export const MAX_PHONE_DIGITS = 15;

/**
 * Fewer than this is not a phone number, even a short service code is
 * written with more.
 */
const MIN_PHONE_DIGITS = 3;

/**
 * Everything a written phone number legitimately contains besides digits:
 * a leading +, separators, the "(0)" of French numbers, and the "ext"/"x"
 * of an extension.
 */
const PHONE_CHARACTERS = /^[\d\s+\-()./]*(?:\s*(?:ext\.?|x|#)\s*\d+)?$/i;

// ============================================================================
// Type Definitions
// ============================================================================

/** Why a phone number cannot be right. */
export type PhoneProblem = 'characters' | 'tooShort' | 'tooLong';

// ============================================================================
// Functions
// ============================================================================

/**
 * The country a number without a "+" most likely belongs to, read from a
 * BCP 47 language tag ("fr-FR", "en-GB"), or from the language alone for
 * French, which is the app's home market. `undefined` when it cannot tell;
 * such numbers are then only tidied when they carry their own "+".
 *
 * @param languageTag - `navigator.language`, or the app's language
 */
export function phoneCountryFor(languageTag: string | undefined): CountryCode | undefined {
  if (!languageTag) {
    return undefined;
  }
  const region = /^[a-z]{2,3}[-_]([a-z]{2})\b/i.exec(languageTag)?.[1];
  if (region) {
    return region.toUpperCase() as CountryCode;
  }
  return /^fr\b/i.test(languageTag) ? 'FR' : undefined;
}

/**
 * What is wrong with a phone number, or `null` when nothing visibly is.
 * An empty number is fine: the field is optional.
 *
 * @param raw - The number as typed
 */
export function phoneProblem(raw: string): PhoneProblem | null {
  const value = raw.trim();
  if (value === '') {
    return null;
  }
  if (!PHONE_CHARACTERS.test(value)) {
    return 'characters';
  }
  // The extension does not count towards the number's own digits.
  const digits = value.replace(/(?:ext\.?|x|#)\s*\d+$/i, '').replace(/\D/g, '').length;
  if (digits < MIN_PHONE_DIGITS) {
    return 'tooShort';
  }
  if (digits > MAX_PHONE_DIGITS) {
    return 'tooLong';
  }
  return null;
}

/**
 * Why a phone number cannot be right, worded for the person who typed it, or
 * `undefined` when nothing visibly is.
 *
 * @param t - The translation function
 * @param value - The number as typed
 */
export function phoneErrorMessage(t: TFunction, value: string): string | undefined {
  switch (phoneProblem(value)) {
    case 'characters':
      return t('persons.phoneCharacters', 'Only digits, spaces and + ( ) - . can go in a phone number');
    case 'tooShort':
      return t('persons.phoneTooShort', 'This number is too short to call');
    case 'tooLong':
      return t('persons.phoneTooLong', 'A phone number has 15 digits at most');
    default:
      return undefined;
  }
}

/**
 * The number laid out the way its country writes it: nationally when it was
 * typed without a country code and belongs to the first of `countries`,
 * internationally otherwise. A number without a "+" is read as from the first
 * of `countries` it is a valid number in, so a French mobile typed on a phone
 * set to US English is still read as French, and never forced into a US
 * layout. A number it cannot recognise comes back exactly as given, so
 * tidying never loses anything.
 *
 * @param raw - The number as typed
 * @param countries - Where a number without a "+" may be from, likeliest first
 */
export function formatPhone(raw: string, countries: readonly CountryCode[] = []): string {
  const value = raw.trim();
  if (value === '' || phoneProblem(value) !== null) {
    return raw;
  }
  const hasCountryCode = /^(?:\+|00)/.test(value);
  const candidates = hasCountryCode ? [undefined] : countries;
  for (const country of candidates) {
    // "00" is how most of the world dials a "+".
    const parsed = parsePhoneNumberFromString(value.replace(/^00/, '+'), country);
    if (parsed?.isValid()) {
      // Typed with its country code, it stays international: the number is
      // read by everyone on the trip, not all of whom are in one country.
      // Both formats carry an extension themselves, as " ext. 12".
      return hasCountryCode || parsed.country !== countries[0]
        ? parsed.formatInternational()
        : parsed.formatNational();
    }
  }
  return raw;
}

/**
 * The countries a number typed without a "+" is likeliest from: the phone's
 * region, the app's language, then France, the app's home market.
 *
 * @param languageTags - `navigator.language`, the app's language, …
 */
export function phoneCountriesFor(...languageTags: readonly (string | undefined)[]): CountryCode[] {
  const countries = [...languageTags.map(phoneCountryFor), 'FR' as CountryCode];
  return [...new Set(countries.filter((c): c is CountryCode => c !== undefined))];
}
