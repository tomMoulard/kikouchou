/**
 * Unit tests for timeline lane packing.
 *
 * @module lib/utils/__tests__/timeline-lanes.test
 */
import { describe, it, expect } from 'vitest';

import { allocateTimelineLanes } from '../timeline-lanes';

describe('allocateTimelineLanes', () => {
  it('returns an empty array for no items', () => {
    expect(allocateTimelineLanes([])).toEqual([]);
  });

  it('keeps non-overlapping spans in the same lane', () => {
    const lanes = allocateTimelineLanes([
      { startIndex: 0, endIndex: 1 },
      { startIndex: 2, endIndex: 3 },
    ]);

    expect(lanes.map((item) => item.laneIndex)).toEqual([0, 0]);
  });

  it('stacks overlapping spans into separate lanes', () => {
    const lanes = allocateTimelineLanes([
      { startIndex: 0, endIndex: 2 },
      { startIndex: 1, endIndex: 3 },
    ]);

    expect(lanes.map((item) => item.laneIndex)).toEqual([0, 1]);
  });

  it('treats touching spans as overlapping (a shared column is still shared)', () => {
    const lanes = allocateTimelineLanes([
      { startIndex: 0, endIndex: 1 },
      { startIndex: 1, endIndex: 2 },
    ]);

    expect(lanes.map((item) => item.laneIndex)).toEqual([0, 1]);
  });

  it('reuses a lane once its previous span has ended', () => {
    const lanes = allocateTimelineLanes([
      { startIndex: 0, endIndex: 1 },
      { startIndex: 0, endIndex: 4 },
      { startIndex: 2, endIndex: 3 },
    ]);

    // Sorted by start, longest first: [0-4] lane 0, [0-1] lane 1, [2-3] lane 1
    expect(lanes.map((item) => [item.startIndex, item.endIndex, item.laneIndex])).toEqual([
      [0, 4, 0],
      [0, 1, 1],
      [2, 3, 1],
    ]);
  });

  it('preserves the other properties of each span', () => {
    const lanes = allocateTimelineLanes([
      { id: 'a', startIndex: 0, endIndex: 0 },
    ]);

    expect(lanes[0]?.id).toBe('a');
  });
});
