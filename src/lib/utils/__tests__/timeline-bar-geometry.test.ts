/**
 * @fileoverview Tests for timeline assignment bar geometry.
 *
 * @module lib/utils/__tests__/timeline-bar-geometry.test
 */

import { describe, it, expect } from 'vitest';

import {
  timelineAssignmentBarStyle,
  TIMELINE_LANE_HEIGHT_PX,
} from '../timeline-bar-geometry';

// ============================================================================
// Constants
// ============================================================================

describe('TIMELINE_LANE_HEIGHT_PX', () => {
  it('is 28', () => {
    expect(TIMELINE_LANE_HEIGHT_PX).toBe(28);
  });
});

// ============================================================================
// timelineAssignmentBarStyle - fractional mode
// ============================================================================

describe('timelineAssignmentBarStyle (fractional)', () => {
  it('computes percentage-based left and width', () => {
    const style = timelineAssignmentBarStyle(
      { startIndex: 2, endIndex: 4 },
      { dayCount: 10, useFractionalColumns: true, dayWidthPx: 44, laneIndex: 0 },
    );
    // leftPct = (100 * 2) / 10 = 20
    // widthPct = (100 * 3) / 10 = 30
    expect(style.left).toBe('calc(20% + 2px)');
    expect(style.width).toBe('max(12px, calc(30% - 4px))');
  });

  it('computes top and height from laneIndex', () => {
    const style = timelineAssignmentBarStyle(
      { startIndex: 0, endIndex: 0 },
      { dayCount: 7, useFractionalColumns: true, dayWidthPx: 44, laneIndex: 2 },
    );
    // top = 2 * 28 + 2 = 58
    expect(style.top).toBe(58);
    // height = 28 - 6 = 22
    expect(style.height).toBe(22);
  });

  it('uses custom laneHeightPx', () => {
    const style = timelineAssignmentBarStyle(
      { startIndex: 0, endIndex: 0 },
      { dayCount: 7, useFractionalColumns: true, dayWidthPx: 44, laneIndex: 1, laneHeightPx: 40 },
    );
    // top = 1 * 40 + 2 = 42
    expect(style.top).toBe(42);
    // height = 40 - 6 = 34
    expect(style.height).toBe(34);
  });
});

// ============================================================================
// timelineAssignmentBarStyle - fixed pixel mode
// ============================================================================

describe('timelineAssignmentBarStyle (fixed)', () => {
  it('computes pixel-based left and width', () => {
    const style = timelineAssignmentBarStyle(
      { startIndex: 2, endIndex: 4 },
      { dayCount: 10, useFractionalColumns: false, dayWidthPx: 44, laneIndex: 0 },
    );
    // left = 2 * 44 + 2 = 90
    expect(style.left).toBe(90);
    // width = max(12, 3 * 44 - 4) = max(12, 128) = 128
    expect(style.width).toBe(128);
  });

  it('applies minimum width of 12px', () => {
    const style = timelineAssignmentBarStyle(
      { startIndex: 0, endIndex: 0 },
      { dayCount: 10, useFractionalColumns: false, dayWidthPx: 5, laneIndex: 0 },
    );
    // width = max(12, 1 * 5 - 4) = max(12, 1) = 12
    expect(style.width).toBe(12);
  });
});
