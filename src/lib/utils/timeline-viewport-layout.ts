/**
 * @fileoverview Shared horizontal timeline viewport: day column width and canvas size.
 * Used by room occupancy and calendar guest timelines for matching layout and scroll behavior.
 *
 * @module lib/utils/timeline-viewport-layout
 */

// ============================================================================
// Constants
// ============================================================================

/** Default day column width when the grid must scroll horizontally. */
export const TIMELINE_PREFERRED_DAY_WIDTH_PX = 44;

/** Narrowest day width when compressing to avoid horizontal scroll. */
export const TIMELINE_MIN_COMPRESSED_DAY_WIDTH_PX = 28;

/** @deprecated Use {@link TIMELINE_PREFERRED_DAY_WIDTH_PX} */
export const ROOM_TIMELINE_PREFERRED_DAY_WIDTH_PX = TIMELINE_PREFERRED_DAY_WIDTH_PX;

/** @deprecated Use {@link TIMELINE_MIN_COMPRESSED_DAY_WIDTH_PX} */
export const ROOM_TIMELINE_MIN_COMPRESSED_DAY_WIDTH_PX = TIMELINE_MIN_COMPRESSED_DAY_WIDTH_PX;

// ============================================================================
// Types
// ============================================================================

export interface TimelineViewportLayout {
  readonly dayWidthPx: number;
  readonly canvasWidth: number;
  /**
   * When true, day columns use CSS `1fr` tracks so they fill `canvasWidth`.
   * Span bars should use percentage `left`/`width` or `cellWidthPx` from context.
   */
  readonly useFractionalColumns: boolean;
}

/** @deprecated Use {@link TimelineViewportLayout} */
export type RoomTimelineViewportLayout = TimelineViewportLayout;

// ============================================================================
// API
// ============================================================================

/**
 * Computes day column width so the date grid fits the scroll viewport when possible.
 */
export function computeTimelineViewportLayout(params: {
  readonly viewportWidth: number;
  readonly labelColumnWidth: number;
  readonly dayCount: number;
}): TimelineViewportLayout {
  const { viewportWidth, labelColumnWidth, dayCount } = params;
  const preferred = TIMELINE_PREFERRED_DAY_WIDTH_PX;
  const minCompressed = TIMELINE_MIN_COMPRESSED_DAY_WIDTH_PX;

  if (dayCount < 1) {
    return { dayWidthPx: preferred, canvasWidth: 0, useFractionalColumns: false };
  }

  const available = Math.max(0, viewportWidth - labelColumnWidth);
  if (available <= 0) {
    return {
      dayWidthPx: preferred,
      canvasWidth: dayCount * preferred,
      useFractionalColumns: false,
    };
  }

  const ideal = available / dayCount;
  if (ideal >= preferred) {
    return { dayWidthPx: ideal, canvasWidth: available, useFractionalColumns: true };
  }
  if (ideal >= minCompressed) {
    return { dayWidthPx: ideal, canvasWidth: available, useFractionalColumns: true };
  }

  return {
    dayWidthPx: preferred,
    canvasWidth: dayCount * preferred,
    useFractionalColumns: false,
  };
}

/** @deprecated Use {@link computeTimelineViewportLayout} */
export function computeRoomTimelineViewportLayout(params: {
  readonly viewportWidth: number;
  readonly roomColWidth: number;
  readonly dayCount: number;
}): TimelineViewportLayout {
  return computeTimelineViewportLayout({
    viewportWidth: params.viewportWidth,
    labelColumnWidth: params.roomColWidth,
    dayCount: params.dayCount,
  });
}

export function computeDayGridTemplateColumns(
  dayCount: number,
  dayWidthPx: number,
  useFractionalColumns: boolean,
): string | undefined {
  if (dayCount < 1) {
    return undefined;
  }
  return useFractionalColumns
    ? `repeat(${dayCount}, minmax(0, 1fr))`
    : `repeat(${dayCount}, ${dayWidthPx}px)`;
}
