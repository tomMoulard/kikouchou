/**
 * @fileoverview Canonical date-fns locale lookup.
 *
 * This mapping was independently reimplemented in 12 files. It lives here, in
 * `lib/`, so both shared components and features can reach it without a
 * feature-to-feature import — and so a change lands once.
 *
 * @module lib/i18n/date-locale
 */

import { enUS, fr } from 'date-fns/locale';
import type { Locale } from 'date-fns';

// ============================================================================
// Locale Lookup
// ============================================================================

/**
 * Maps an i18next language code to its date-fns locale.
 *
 * @param language - The active i18next language (e.g. `i18n.language`)
 * @returns The matching date-fns locale, defaulting to English
 *
 * @example
 * ```typescript
 * const locale = getDateLocale(i18n.language);
 * format(date, 'PPPP', { locale });
 * ```
 */
export function getDateLocale(language: string): Locale {
  return language === 'fr' ? fr : enUS;
}
