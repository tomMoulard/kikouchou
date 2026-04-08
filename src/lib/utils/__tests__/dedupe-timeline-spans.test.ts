/**
 * @fileoverview Tests for timeline span deduplication utilities.
 *
 * @module lib/utils/__tests__/dedupe-timeline-spans.test
 */

import { describe, it, expect } from 'vitest';

import {
  dedupeContainedTimelineSpans,
  dedupeContainedTimelineSpansByGroup,
} from '../dedupe-timeline-spans';
import type { TimelineSpanItem } from '../dedupe-timeline-spans';

// ============================================================================
// Helpers
// ============================================================================

function span(id: string, startIndex: number, endIndex: number): TimelineSpanItem {
  return { id, startIndex, endIndex };
}

// ============================================================================
// dedupeContainedTimelineSpans
// ============================================================================

describe('dedupeContainedTimelineSpans', () => {
  it('returns empty array for empty input', () => {
    expect(dedupeContainedTimelineSpans([])).toEqual([]);
  });

  it('returns single item unchanged', () => {
    const items = [span('a', 0, 5)];
    expect(dedupeContainedTimelineSpans(items)).toEqual(items);
  });

  it('keeps non-overlapping items', () => {
    const items = [span('a', 0, 2), span('b', 4, 6)];
    const result = dedupeContainedTimelineSpans(items);
    expect(result).toHaveLength(2);
  });

  it('removes exact duplicates', () => {
    const items = [span('a', 0, 5), span('b', 0, 5)];
    const result = dedupeContainedTimelineSpans(items);
    expect(result).toHaveLength(1);
  });

  it('removes strict subsets', () => {
    const items = [span('big', 0, 10), span('small', 2, 5)];
    const result = dedupeContainedTimelineSpans(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('big');
  });

  it('keeps partially overlapping items', () => {
    const items = [span('a', 0, 5), span('b', 3, 8)];
    const result = dedupeContainedTimelineSpans(items);
    expect(result).toHaveLength(2);
  });

  it('removes nested subsets in a chain', () => {
    const items = [
      span('outer', 0, 10),
      span('mid', 2, 8),
      span('inner', 3, 6),
    ];
    const result = dedupeContainedTimelineSpans(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('outer');
  });

  it('does not modify the original array', () => {
    const items = [span('a', 0, 5)];
    const result = dedupeContainedTimelineSpans(items);
    expect(result).not.toBe(items);
  });
});

// ============================================================================
// dedupeContainedTimelineSpansByGroup
// ============================================================================

describe('dedupeContainedTimelineSpansByGroup', () => {
  interface GroupedSpan extends TimelineSpanItem {
    readonly groupId: string;
  }

  function gSpan(id: string, groupId: string, startIndex: number, endIndex: number): GroupedSpan {
    return { id, groupId, startIndex, endIndex };
  }

  it('returns empty array for empty input', () => {
    expect(dedupeContainedTimelineSpansByGroup<GroupedSpan>([], (i) => i.id)).toEqual([]);
  });

  it('dedupes within groups independently', () => {
    const items: GroupedSpan[] = [
      gSpan('a1', 'A', 0, 10),
      gSpan('a2', 'A', 2, 5),   // subset of a1 → removed
      gSpan('b1', 'B', 2, 5),   // different group → kept
    ];
    const result = dedupeContainedTimelineSpansByGroup(items, (i) => i.groupId);
    expect(result).toHaveLength(2);
    const ids = result.map(r => r.id);
    expect(ids).toContain('a1');
    expect(ids).toContain('b1');
  });

  it('does not remove items across different groups even when one contains the other', () => {
    const items: GroupedSpan[] = [
      gSpan('a1', 'A', 0, 10),
      gSpan('b1', 'B', 2, 5),   // would be subset of a1, but different group
    ];
    const result = dedupeContainedTimelineSpansByGroup(items, (i) => i.groupId);
    expect(result).toHaveLength(2);
  });
});
