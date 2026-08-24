/**
 * @fileoverview Lane packing for horizontal trip timelines.
 *
 * Spans that overlap on the day axis are stacked into lanes so no two bars
 * cover the same pixel. Shared by the calendar timeline and the activity timeline.
 *
 * @module lib/utils/timeline-lanes
 */

/**
 * Minimal shape a timeline span must expose to be packed into lanes.
 */
export interface TimelineSpan {
  /** First day column covered by the span (inclusive) */
  readonly startIndex: number;
  /** Last day column covered by the span (inclusive) */
  readonly endIndex: number;
}

/**
 * Assigns each span the topmost lane where it does not overlap an earlier span.
 *
 * Spans are processed left to right (longest first on ties), which produces a
 * stable, gap-minimising packing.
 *
 * @param items - Spans to pack
 * @returns The same spans with a `laneIndex`, ordered by start then length
 *
 * @example
 * ```typescript
 * allocateTimelineLanes([
 *   { startIndex: 0, endIndex: 2 },
 *   { startIndex: 1, endIndex: 3 },
 * ]);
 * // [{ …, laneIndex: 0 }, { …, laneIndex: 1 }]
 * ```
 */
export function allocateTimelineLanes<TItem extends TimelineSpan>(
  items: readonly TItem[],
): readonly (TItem & { readonly laneIndex: number })[] {
  if (items.length === 0) {
    return [];
  }

  const sorted = [...items].sort((a, b) => {
    const startDiff = a.startIndex - b.startIndex;
    if (startDiff !== 0) {
      return startDiff;
    }
    return b.endIndex - a.endIndex;
  });

  const laneEndByIndex: number[] = [];
  const result: (TItem & { readonly laneIndex: number })[] = [];

  for (const item of sorted) {
    let laneIndex = laneEndByIndex.findIndex((laneEnd) => item.startIndex > laneEnd);
    if (laneIndex === -1) {
      laneIndex = laneEndByIndex.length;
      laneEndByIndex.push(item.endIndex);
    } else {
      laneEndByIndex[laneIndex] = Math.max(
        laneEndByIndex[laneIndex] ?? item.endIndex,
        item.endIndex,
      );
    }

    result.push({ ...item, laneIndex } as TItem & { readonly laneIndex: number });
  }

  return result;
}
