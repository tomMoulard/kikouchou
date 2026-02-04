/**
 * @fileoverview Utility functions for the Calendar feature.
 * Contains helper functions for date handling, color calculations, and event rendering.
 *
 * @module features/calendar/utils/calendar-utils
 */

import { format, parseISO } from 'date-fns';
import { type Locale, enUS, fr } from 'date-fns/locale';
import type { HexColor } from '@/types';
import type { CalendarEvent, SegmentPosition } from '../types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Stable empty array constant to prevent re-renders for days without events.
 * Using a module-level constant ensures referential equality across renders.
 */
export const EMPTY_EVENTS: readonly CalendarEvent[] = [];

/**
 * Stable empty array constant to prevent re-renders for days without transports.
 */
export const EMPTY_TRANSPORTS: readonly import('../types').CalendarTransport[] = [];

/** Maximum number of visible event slots before showing "+N more" */
export const MAX_VISIBLE_EVENT_SLOTS = 3;

// ============================================================================
// Date Locale Functions
// ============================================================================

/**
 * Gets the date-fns locale based on the i18n language.
 *
 * @param language - The i18n language code (e.g., 'en', 'fr')
 * @returns The corresponding date-fns locale
 */
export function getDateLocale(language: string): Locale {
  return language === 'fr' ? fr : enUS;
}

// ============================================================================
// Color Functions
// ============================================================================

/**
 * Calculates the relative luminance of a hex color.
 * Used to determine if text should be white or black for contrast.
 *
 * @param hex - Hex color string (with or without #)
 * @returns Relative luminance (0-1), defaults to 0.5 for invalid input
 */
export function getLuminance(hex: string): number {
  // Remove # if present
  let cleanHex = hex.replace('#', '');

  // Handle shorthand hex colors (e.g., #fff -> #ffffff)
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split('')
      .map((c) => c + c)
      .join('');
  }

  // Validate hex format - must be exactly 6 hex characters
  if (!/^[0-9A-Fa-f]{6}$/.test(cleanHex)) {
    // Return middle luminance as safe default for invalid colors
    return 0.5;
  }

  // Parse RGB values
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255,
    g = parseInt(cleanHex.substring(2, 4), 16) / 255,
    b = parseInt(cleanHex.substring(4, 6), 16) / 255,
    // Calculate relative luminance using sRGB formula
    linearize = (c: number) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Determines the optimal text color (white or black) for a given background.
 *
 * @param bgColor - Background hex color
 * @returns 'white' or 'black' for optimal contrast
 */
export function getContrastTextColor(bgColor: HexColor): 'white' | 'black' {
  const luminance = getLuminance(bgColor);
  // WCAG recommends using white text on dark backgrounds (luminance < 0.179)
  return luminance < 0.179 ? 'white' : 'black';
}

// ============================================================================
// Event Rendering Functions
// ============================================================================

/**
 * Get the CSS classes for segment border radius based on position.
 * Handles both logical segment position (start/middle/end/single) and
 * visual row boundaries (week breaks require rounded corners).
 *
 * @param segmentPosition - Position within the multi-day event
 * @param isRowStart - Whether this segment is at the start of a week row
 * @param isRowEnd - Whether this segment is at the end of a week row
 * @returns CSS class string for border radius
 */
export function getSegmentBorderRadiusClasses(
  segmentPosition: SegmentPosition,
  isRowStart: boolean,
  isRowEnd: boolean,
): string {
  // Single-day event: fully rounded
  if (segmentPosition === 'single') {
    return 'rounded';
  }

  // For multi-day events, we need to consider both logical position and row boundaries
  // A 'middle' segment that's at row start needs rounded left corners
  // A 'middle' segment that's at row end needs rounded right corners

  const isLogicalStart = segmentPosition === 'start',
    isLogicalEnd = segmentPosition === 'end',
    // Rounded left corner if: logical start OR visual row start (week boundary)
    needsRoundedLeft = isLogicalStart || isRowStart,
    // Rounded right corner if: logical end OR visual row end (week boundary)
    needsRoundedRight = isLogicalEnd || isRowEnd;

  if (needsRoundedLeft && needsRoundedRight) {
    return 'rounded';
  }
  if (needsRoundedLeft) {
    return 'rounded-l';
  }
  if (needsRoundedRight) {
    return 'rounded-r';
  }
  return 'rounded-none';
}

// ============================================================================
// Time Formatting Functions
// ============================================================================

/**
 * Formats a datetime string to show just the time (HH:mm) in local timezone.
 *
 * @param datetime - ISO datetime string (e.g., "2024-01-10T13:00:00.000Z")
 * @returns Time string in HH:mm format (local timezone)
 */
export function formatTime(datetime: string): string {
  try {
    // Parse ISO datetime to Date object (preserves UTC instant)
    const date = parseISO(datetime);
    if (Number.isNaN(date.getTime())) return '';
    // Format in local timezone using date-fns format
    return format(date, 'HH:mm');
  } catch {
    return '';
  }
}
