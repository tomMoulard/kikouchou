/**
 * @fileoverview Remove redundant timeline bars when one span is fully contained in another.
 *
 * Used by room occupancy and calendar horizontal timelines when duplicate
 * {@link RoomAssignment} rows exist for the same guest (e.g. after editing stay dates).
 *
 * @module lib/utils/dedupe-timeline-spans
 */

/** Minimal shape for index-based timeline bars (same row: same room or same person). */
export interface TimelineSpanItem {
  readonly id: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * Drops bars whose night span is a strict subset of another bar’s span, and drops exact
 * duplicates. Keeps the widest span when one contains another.
 */
export function dedupeContainedTimelineSpans<T extends TimelineSpanItem>(items: readonly T[]): T[] {
  if (items.length <= 1) {
    return [...items];
  }

  const sorted = [...items].sort((a, b) => {
    const spanDiff = b.endIndex - b.startIndex - (a.endIndex - a.startIndex);
    if (spanDiff !== 0) return spanDiff;
    return a.id.localeCompare(b.id);
  });

  const kept: T[] = [];
  for (const item of sorted) {
    const exactDup = kept.some(
      (k) => k.startIndex === item.startIndex && k.endIndex === item.endIndex,
    );
    if (exactDup) {
      continue;
    }
    const strictSubset = kept.some(
      (k) =>
        item.startIndex >= k.startIndex &&
        item.endIndex <= k.endIndex &&
        (item.startIndex !== k.startIndex || item.endIndex !== k.endIndex),
    );
    if (strictSubset) {
      continue;
    }
    kept.push(item);
  }

  return kept;
}

/**
 * Runs {@link dedupeContainedTimelineSpans} independently per group (e.g. per person).
 * Use this when one timeline row mixes multiple entities (e.g. all guests in a room);
 * otherwise a long stay for guest A would incorrectly hide a shorter stay for guest B
 * when B’s nights are strictly inside A’s range.
 */
export function dedupeContainedTimelineSpansByGroup<T extends TimelineSpanItem>(
  items: readonly T[],
  groupKey: (item: T) => string,
): T[] {
  const byGroup = new Map<string, T[]>();
  for (const item of items) {
    const key = groupKey(item);
    let bucket = byGroup.get(key);
    if (!bucket) {
      bucket = [];
      byGroup.set(key, bucket);
    }
    bucket.push(item);
  }
  const result: T[] = [];
  for (const group of byGroup.values()) {
    result.push(...dedupeContainedTimelineSpans(group));
  }
  return result;
}
