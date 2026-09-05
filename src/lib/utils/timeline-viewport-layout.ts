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

/**
 * Horizontal scroll offset so the center of day column `columnIndex` aligns with the
 * scroll container’s horizontal center (sticky label column included in layout math).
 */
export function computeTimelineScrollLeftToCenterDay(args: {
  readonly scrollContainerClientWidth: number;
  readonly scrollContainerScrollWidth: number;
  readonly labelColumnWidth: number;
  readonly columnIndex: number;
  readonly cellWidthPx: number;
}): number {
  const {
    scrollContainerClientWidth: cw,
    scrollContainerScrollWidth: sw,
    labelColumnWidth,
    columnIndex,
    cellWidthPx,
  } = args;
  if (cw <= 0 || columnIndex < 0) {
    return 0;
  }
  const columnStart = labelColumnWidth + columnIndex * cellWidthPx;
  const columnCenter = columnStart + cellWidthPx / 2;
  const target = columnCenter - cw / 2;
  const max = Math.max(0, sw - cw);
  return Math.max(0, Math.min(max, target));
}

// ============================================================================
// Page width
// ============================================================================

/**
 * Tailwind's `max-w-7xl`, in pixels — the widest cap a timeline page uses.
 */
export const TIMELINE_PAGE_WIDTH_CAP_PX = 1280;

/**
 * Whether a timeline needs the page's full width rather than a reading-width cap.
 *
 * A timeline page is normally capped so text does not run to the edges of a
 * wide monitor. That cap is the right call only while the whole trip fits
 * inside it: once it does not, the cap is spending screen the day axis needs,
 * and the reader pays for it by scrolling further to see the same trip.
 *
 * Answered from the day count rather than from a measurement on purpose.
 * Removing the cap widens the container, a wider container fits more days, and
 * a rule that read the resulting width back would flip-flop between the two
 * layouts — the same feedback loop that made the sticky label column jitter.
 * The day count cannot be changed by the layout it decides, so it settles.
 *
 * @param args - Day count, the sticky label column, and the cap being tested
 * @returns True when the trip cannot be shown at once within `cappedWidth`
 */
export function timelineNeedsFullPageWidth(args: {
  readonly dayCount: number;
  readonly labelColumnWidth: number;
  readonly cappedWidth?: number;
}): boolean {
  const { dayCount, labelColumnWidth, cappedWidth = TIMELINE_PAGE_WIDTH_CAP_PX } = args;

  if (dayCount < 1) {
    return false;
  }

  const widthToShowEveryDay =
    dayCount * TIMELINE_PREFERRED_DAY_WIDTH_PX + labelColumnWidth;

  return widthToShowEveryDay > cappedWidth;
}

// ============================================================================
// Label folding
// ============================================================================

/**
 * How wide the sticky label column should be at a given scroll offset.
 *
 * The column sheds exactly the width that has been scrolled, down to a floor
 * that leaves only the colour dot or glyph. One pixel of scroll folds one pixel
 * of column, so the fold tracks the finger instead of snapping between an open
 * and a shut state — and because the column gives up exactly what the scroll
 * takes, the first visible day holds still against the column's edge for the
 * whole fold.
 *
 * Continuity is also what removes a whole class of bug. The old two-state
 * version had to jump the column 160px at the moment it flipped, compensate
 * that jump by rewriting `scrollLeft`, and keep its two thresholds far enough
 * apart that neither transition could trigger the other. A width that is a
 * plain function of the scroll offset cannot oscillate: there is no state to
 * flip, and the same offset always gives the same width.
 *
 * A negative offset — rubber-band scrolling past the start, which macOS does
 * routinely — leaves the column fully open rather than growing it past its
 * natural width.
 *
 * @param args - Current scroll offset and the column's open and folded widths
 * @returns The column width in pixels, never outside those two bounds
 */
export function resolveLabelColumnWidth(args: {
  readonly scrollLeft: number;
  readonly expandedWidth: number;
  readonly collapsedWidth: number;
}): number {
  const { scrollLeft, expandedWidth, collapsedWidth } = args;

  // A column that would not get narrower has nothing to fold.
  if (expandedWidth <= collapsedWidth) {
    return expandedWidth;
  }

  const scrolled = Math.max(0, scrollLeft);
  const folded = expandedWidth - scrolled;

  if (folded <= collapsedWidth) {
    return collapsedWidth;
  }
  return folded;
}

/**
 * The scroll offset at which the column reaches its floor and stops folding.
 *
 * @param expandedWidth - The column's open width
 * @param collapsedWidth - The width left once only the colours remain
 * @returns Pixels of scroll that fold the column completely
 */
export function labelColumnFoldDistance(
  expandedWidth: number,
  collapsedWidth: number,
): number {
  return Math.max(0, expandedWidth - collapsedWidth);
}
