/**
 * @fileoverview The contract between the timeline frame and its sticky label
 * cells: the custom properties the frame writes as it folds, and the sizing
 * every cell must use to fold with it.
 *
 * Its own module rather than part of `TripTimelineFrame` so the frame's file
 * exports only its component — a file that exports both a component and an
 * object breaks fast refresh for everything importing it.
 *
 * @module components/shared/timeline-label-cell
 */

import type { CSSProperties } from 'react';

// ============================================================================
// Custom properties
// ============================================================================

/**
 * The label column's width right now, rewritten on every scroll frame.
 *
 * Driven through CSS rather than React state on purpose: it changes once per
 * frame while scrolling, and re-rendering a timeline of rows that often would
 * drop frames on the very gesture it exists to smooth. One custom property lets
 * the browser resize every cell in a single style recalculation.
 */
export const TIMELINE_LABEL_WIDTH_VAR = '--timeline-label-width';

/** The column's unfolded width — constant for the life of a timeline. */
export const TIMELINE_LABEL_EXPANDED_VAR = '--timeline-label-expanded';

// ============================================================================
// Cell sizing
// ============================================================================

/**
 * Sizing every sticky label cell must use, so they all fold together.
 *
 * The margin makes up the difference between the cell's current width and its
 * unfolded one, which keeps the *slot* it occupies exactly as wide as it
 * started. That is what holds the day columns still: only the visible part of
 * the column narrows, so no day changes position and the scrollable width never
 * moves underfoot. It is also why the first visible day sits against the
 * column's edge for the whole fold — the column gives up exactly what the
 * scroll takes.
 *
 * Spread it and add the row's own height:
 * `style={{ ...TIMELINE_LABEL_CELL_STYLE, height: rowHeight }}`.
 */
export const TIMELINE_LABEL_CELL_STYLE: CSSProperties = {
  width: `var(${TIMELINE_LABEL_WIDTH_VAR})`,
  minWidth: `var(${TIMELINE_LABEL_WIDTH_VAR})`,
  marginRight: `calc(var(${TIMELINE_LABEL_EXPANDED_VAR}) - var(${TIMELINE_LABEL_WIDTH_VAR}))`,
};
