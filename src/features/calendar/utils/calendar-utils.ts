/**
 * @fileoverview Utility functions for the Calendar feature.
 * Contains helper functions for date handling, color calculations, and event rendering.
 *
 * @module features/calendar/utils/calendar-utils
 */


import { getContrastTextColor as getSharedContrastTextColor } from '@/lib/utils/color-contrast';
import { formatTransportDatetime } from '@/lib/utils/datetime-format';
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
// Color Functions
// ============================================================================

/**
 * Luminance and the white-or-black text decision live in
 * `@/lib/utils/color-contrast`, shared with `PersonBadge` — which used to carry
 * a second copy that answered differently on the same colour.
 */
export { getLuminance } from '@/lib/utils/color-contrast';

/**
 * Determines the optimal text color (white or black) for a given background.
 *
 * Delegates to the shared implementation but keeps the branded `HexColor`
 * parameter: the shared helper has to take a plain `string` for `PersonBadge`,
 * whose colour prop is unbranded, and widening the calendar's call sites too
 * would drop the check that a colour went through `toHexColor` first.
 *
 * @param bgColor - Background hex color
 * @returns 'white' or 'black' for optimal contrast
 */
export function getContrastTextColor(bgColor: HexColor): 'white' | 'black' {
  return getSharedContrastTextColor(bgColor);
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
 * Formats a stored instant to show just the wall-clock time, in the viewer's
 * local timezone.
 *
 * Delegates to the app-wide renderer so a calendar pill shows exactly the time
 * the transport list, the map popup and the detail dialog show.
 *
 * @param datetime - ISO datetime string (e.g., "2024-01-10T13:00:00.000Z")
 * @returns Time string in HH:mm format (local timezone)
 */
export function formatTime(datetime: string): string {
  return formatTransportDatetime(datetime, undefined, 'timeOnly');
}

