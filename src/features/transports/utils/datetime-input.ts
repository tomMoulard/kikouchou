/**
 * @fileoverview The two conversions between a `datetime-local` input and the
 * stored instant a transport carries.
 *
 * `TransportForm` owns the only `datetime-local` input in the transports
 * feature, and these were private to it. They live here now for one reason:
 * `TransportDatetime.test.ts` — the BUG-2 timezone regression guard — used to
 * keep private *copies* of both and assert those, so the round trip could be
 * broken in the form without a single assertion going red. A guard that
 * exercises its own reimplementation guards nothing, and a function a test
 * must import is a function that cannot be duplicated by accident.
 *
 * The rendering direction (a stored instant → what a surface displays) is not
 * here: that is `@/lib/utils/datetime-format`, the single app-wide renderer.
 * This module is only the form's input plumbing.
 *
 * @module features/transports/utils/datetime-input
 */

import { format, parseISO } from 'date-fns';

/**
 * Converts an ISO datetime string to the `datetime-local` input format.
 *
 * Rendered in the viewer's timezone: the value handed back to the input has to
 * be the wall clock they will read off it, not the stored UTC one.
 *
 * @param isoDatetime - ISO datetime string
 * @returns datetime-local format (YYYY-MM-DDTHH:mm), or `''` when unparseable
 *
 * @example
 * ```typescript
 * // In UTC+2:
 * formatDatetimeLocal('2024-01-10T13:30:00.000Z'); // '2024-01-10T15:30'
 * ```
 */
export function formatDatetimeLocal(isoDatetime: string): string {
  try {
    const date = parseISO(isoDatetime);
    if (isNaN(date.getTime())) {
      return '';
    }
    return format(date, "yyyy-MM-dd'T'HH:mm");
  } catch {
    return '';
  }
}

/**
 * Converts the `datetime-local` input format to the stored ISO datetime string.
 *
 * The input yields a wall clock with no offset, so it is read as the viewer's
 * local time and normalised to the UTC instant every other surface stores.
 *
 * @param localDatetime - datetime-local format (YYYY-MM-DDTHH:mm)
 * @returns ISO datetime string (UTC), or `''` when unparseable
 *
 * @example
 * ```typescript
 * // In UTC+2:
 * toISODatetime('2024-01-10T15:30'); // '2024-01-10T13:30:00.000Z'
 * ```
 */
export function toISODatetime(localDatetime: string): string {
  if (!localDatetime) {
    return '';
  }
  try {
    // Datetime-local gives us local time, convert to ISO
    const date = new Date(localDatetime);
    if (isNaN(date.getTime())) {
      return '';
    }
    return date.toISOString();
  } catch {
    return '';
  }
}
