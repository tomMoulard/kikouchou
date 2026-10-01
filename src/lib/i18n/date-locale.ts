/**
 * @fileoverview Canonical date-fns locale lookup.
 *
 * This mapping had been independently reimplemented in 12 other files; they now
 * all import this one. It lives here, in `lib/`, so both shared components and
 * features can reach it without a feature-to-feature import — and so a change
 * lands once. Do not add a thirteenth copy.
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
 * Only the primary subtag is compared. `supportedLngs` normally narrows
 * `i18n.language` to a bare `fr`/`en` before a component reads it, but nothing
 * in the type guarantees that: a regional tag arriving from a stale
 * `i18nextLng` value or a test's i18n mock would otherwise silently print
 * English month names in a French UI.
 *
 * A missing language is tolerated for the same reason — a component that reads
 * `i18n.language` before init must fall back to English, not throw.
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
  if (typeof language !== 'string') {
    return enUS;
  }
  const primarySubtag = language.toLowerCase().split('-')[0] ?? '';
  return primarySubtag === 'fr' ? fr : enUS;
}
