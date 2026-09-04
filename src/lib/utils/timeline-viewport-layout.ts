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

/**
 * Scroll left of the collapse point that must be travelled before the labels
 * come back — the gap that keeps the two thresholds from touching.
 *
 * See {@link resolveLabelCollapse} for why a gap is required at all.
 */
export const TIMELINE_LABEL_COLLAPSE_MARGIN_PX = 40;

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
// Label collapse
// ============================================================================

/**
 * What the sticky label column should do at a given scroll position.
 */
export interface LabelCollapseDecision {
  /** Whether the label column should be showing names. */
  readonly collapsed: boolean;
  /**
   * `scrollLeft` to write back so the same day stays under the pointer across
   * the width change, or `null` to leave the scroll position alone.
   */
  readonly nextScrollLeft: number | null;
  /** True when {@link collapsed} differs from the state passed in. */
  readonly changed: boolean;
}

/**
 * Decides whether the sticky label column collapses, and how to keep the view
 * still while it does.
 *
 * Collapsing removes `expandedLabelWidth - collapsedLabelWidth` of layout width
 * from the left of the content, so everything under the pointer slides left by
 * that much. The only way to stay still is to take the same amount off
 * `scrollLeft` — which is possible only if there is that much `scrollLeft` to
 * take. That is the whole reason the collapse point sits past the width delta
 * rather than a few pixels from the start: collapsing at 8px while owing 160px
 * of compensation left nowhere to take it from, so the grid jumped the full
 * delta, and scrolling a hair back to zero expanded it and jumped it back. Near
 * the left edge that pair of jumps repeated on every small movement, which is
 * the jitter this function exists to remove.
 *
 * The two thresholds are deliberately apart — collapse past
 * `delta + {@link TIMELINE_LABEL_COLLAPSE_MARGIN_PX}`, expand only back at the
 * very start — so neither transition can land the scroll position somewhere
 * that immediately triggers the other one.
 *
 * @param args - Current scroll offset, current state and the two column widths
 * @returns The state to be in, and the scroll offset that keeps the view still
 */
export function resolveLabelCollapse(args: {
  readonly scrollLeft: number;
  readonly isCollapsed: boolean;
  readonly expandedLabelWidth: number;
  readonly collapsedLabelWidth: number;
}): LabelCollapseDecision {
  const { scrollLeft, isCollapsed, expandedLabelWidth, collapsedLabelWidth } = args;

  const delta = expandedLabelWidth - collapsedLabelWidth;

  // Nothing to reclaim: a column that does not shrink must not collapse, or it
  // would swap the labels out and buy no width for the day axis.
  if (delta <= 0) {
    return { collapsed: false, nextScrollLeft: null, changed: isCollapsed };
  }

  if (isCollapsed) {
    // Back at the very start, so the labels have room to return. There is no
    // compensation to make: scrollLeft is already 0 and cannot go lower, and
    // the column reappearing at the left edge is what the reader asked for by
    // scrolling back to it.
    if (scrollLeft <= 0) {
      return { collapsed: false, nextScrollLeft: null, changed: true };
    }
    return { collapsed: true, nextScrollLeft: null, changed: false };
  }

  if (scrollLeft > delta + TIMELINE_LABEL_COLLAPSE_MARGIN_PX) {
    // Exact compensation, no clamp: the guard above guarantees the result is
    // at least the margin, so the day under the pointer does not move and the
    // reader is left far enough from zero not to bounce straight back.
    return { collapsed: true, nextScrollLeft: scrollLeft - delta, changed: true };
  }

  return { collapsed: false, nextScrollLeft: null, changed: false };
}
