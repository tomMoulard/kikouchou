/**
 * @fileoverview Positioning for assignment span bars on horizontal trip timelines.
 *
 * @module lib/utils/timeline-bar-geometry
 */

import type { CSSProperties } from 'react';

/** One horizontal band (lane) in room or guest timeline rows — matches calendar + rooms UI. */
export const TIMELINE_LANE_HEIGHT_PX = 28;

/**
 * Absolute CSS for a multi-day assignment pill inside the timeline canvas.
 */
export function timelineAssignmentBarStyle(
  item: { readonly startIndex: number; readonly endIndex: number },
  options: {
    readonly dayCount: number;
    readonly useFractionalColumns: boolean;
    readonly dayWidthPx: number;
    readonly laneIndex: number;
    readonly laneHeightPx?: number;
  },
): CSSProperties {
  const laneH = options.laneHeightPx ?? TIMELINE_LANE_HEIGHT_PX;
  const top = options.laneIndex * laneH + 2;
  const height = laneH - 6;
  const span = item.endIndex - item.startIndex + 1;
  if (options.useFractionalColumns) {
    const leftPct = (100 * item.startIndex) / options.dayCount;
    const widthPct = (100 * span) / options.dayCount;
    return {
      left: `calc(${leftPct}% + 2px)`,
      width: `max(12px, calc(${widthPct}% - 4px))`,
      top,
      height,
    };
  }
  return {
    left: item.startIndex * options.dayWidthPx + 2,
    width: Math.max(12, span * options.dayWidthPx - 4),
    top,
    height,
  };
}
