/**
 * @fileoverview How a timeline row learns where the day axis has been scrolled
 * to, without the frame re-rendering the rows to tell it.
 *
 * The question — "is this row's pill off screen, and which way" — has to be
 * answered on every scroll frame. Putting the answer in React state would
 * re-render every row of the timeline on the one gesture the frame works
 * hardest to keep smooth, so the frame publishes its visible range through this
 * context and each row writes its own DOM in response.
 *
 * Its own module rather than part of `TripTimelineFrame` so the frame's file
 * exports only its component — a file that exports both a component and a
 * context breaks fast refresh for everything importing it.
 *
 * @module components/shared/timeline-scroll-context
 */

import { createContext, useContext } from 'react';

// ============================================================================
// Types
// ============================================================================

/**
 * What the day axis currently shows, in canvas pixels.
 *
 * The canvas starts where the label column ends, so `start` is 0 when the axis
 * is scrolled home. Both edges account for the sticky label column, which
 * covers the leftmost pixels of the canvas rather than sitting beside them —
 * otherwise a pill hidden behind the guest names would count as visible.
 */
export interface TimelineVisibleRange {
  readonly start: number;
  readonly end: number;
}

export interface TimelineScrollApi {
  /**
   * Watches the part of the axis currently on screen.
   *
   * The listener fires once on subscribe with the current range, and again on
   * every scroll and every layout change.
   *
   * @returns An unsubscribe function
   */
  readonly subscribeVisibleRange: (
    listener: (range: TimelineVisibleRange) => void,
  ) => () => void;
  /** Scrolls the axis so a canvas x-offset sits in the middle of the viewport. */
  readonly scrollCanvasPositionIntoView: (canvasX: number) => void;
}

// ============================================================================
// Context
// ============================================================================

/**
 * The no-op API, for a row rendered outside a frame (a test, a storybook).
 *
 * It reports one fixed range covering nothing and scrolls nowhere, so a row
 * outside a frame simply shows no off-screen arrows rather than throwing.
 */
const INERT_TIMELINE_SCROLL_API: TimelineScrollApi = {
  subscribeVisibleRange: () => () => undefined,
  scrollCanvasPositionIntoView: () => undefined,
};

export const TimelineScrollContext = createContext<TimelineScrollApi>(
  INERT_TIMELINE_SCROLL_API,
);

/**
 * Reads the timeline scroll API a `TripTimelineFrame` is publishing.
 *
 * @returns The frame's API, or an inert one outside a frame
 *
 * @example
 * ```tsx
 * const { subscribeVisibleRange } = useTimelineScroll();
 * useEffect(() => subscribeVisibleRange((range) => { ... }), [subscribeVisibleRange]);
 * ```
 */
export function useTimelineScroll(): TimelineScrollApi {
  return useContext(TimelineScrollContext);
}
