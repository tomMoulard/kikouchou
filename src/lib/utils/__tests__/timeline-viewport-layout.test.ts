/**
 * @fileoverview Tests for timeline viewport layout computation.
 *
 * @module lib/utils/__tests__/timeline-viewport-layout.test
 */

import { describe, it, expect } from 'vitest';

import {
  timelineNeedsFullPageWidth,
  resolveLabelColumnWidth,
  labelColumnFoldDistance,
  computeTimelineViewportLayout,
  computeRoomTimelineViewportLayout,
  computeDayGridTemplateColumns,
  computeTimelineScrollLeftToCenterDay,
  TIMELINE_PREFERRED_DAY_WIDTH_PX,
} from '../timeline-viewport-layout';

// ============================================================================
// computeTimelineViewportLayout
// ============================================================================

describe('computeTimelineViewportLayout', () => {
  const preferred = TIMELINE_PREFERRED_DAY_WIDTH_PX;

  it('returns zero canvas for dayCount < 1', () => {
    const result = computeTimelineViewportLayout({
      viewportWidth: 800,
      labelColumnWidth: 100,
      dayCount: 0,
    });
    expect(result.canvasWidth).toBe(0);
    expect(result.dayWidthPx).toBe(preferred);
    expect(result.useFractionalColumns).toBe(false);
  });

  it('uses preferred width when viewport smaller than label column', () => {
    const result = computeTimelineViewportLayout({
      viewportWidth: 50,
      labelColumnWidth: 100,
      dayCount: 7,
    });
    expect(result.dayWidthPx).toBe(preferred);
    expect(result.canvasWidth).toBe(7 * preferred);
    expect(result.useFractionalColumns).toBe(false);
  });

  it('uses fractional columns when viewport is wide enough for preferred width', () => {
    // 7 days * 44px = 308px needed, available = 800 - 100 = 700px → ideal = 100px > preferred
    const result = computeTimelineViewportLayout({
      viewportWidth: 800,
      labelColumnWidth: 100,
      dayCount: 7,
    });
    expect(result.useFractionalColumns).toBe(true);
    expect(result.canvasWidth).toBe(700);
    expect(result.dayWidthPx).toBe(100);
  });

  it('uses compressed fractional columns for medium viewport', () => {
    // Available = 250 - 100 = 150, ideal = 150/7 ≈ 21.4, < minCompressed=28
    // So it should fall to preferred scroll mode
    const result = computeTimelineViewportLayout({
      viewportWidth: 250,
      labelColumnWidth: 100,
      dayCount: 7,
    });
    // ideal ≈ 21.4 < 28 (minCompressed) → scrollable with preferred width
    expect(result.useFractionalColumns).toBe(false);
    expect(result.dayWidthPx).toBe(preferred);
  });

  it('uses fractional when ideal is between min compressed and preferred', () => {
    // Available = 380 - 100 = 280, ideal = 280/7 = 40, 28 <= 40 < 44 → fractional
    const result = computeTimelineViewportLayout({
      viewportWidth: 380,
      labelColumnWidth: 100,
      dayCount: 7,
    });
    expect(result.useFractionalColumns).toBe(true);
    expect(result.dayWidthPx).toBe(40);
    expect(result.canvasWidth).toBe(280);
  });

  it('scrolls horizontally when viewport is too narrow even for compressed', () => {
    // Available = 200 - 100 = 100, ideal = 100/30 ≈ 3.3 < minCompressed → scroll
    const result = computeTimelineViewportLayout({
      viewportWidth: 200,
      labelColumnWidth: 100,
      dayCount: 30,
    });
    expect(result.useFractionalColumns).toBe(false);
    expect(result.dayWidthPx).toBe(preferred);
    expect(result.canvasWidth).toBe(30 * preferred);
  });
});

// ============================================================================
// computeRoomTimelineViewportLayout (deprecated wrapper)
// ============================================================================

describe('computeRoomTimelineViewportLayout', () => {
  it('delegates to computeTimelineViewportLayout', () => {
    const a = computeTimelineViewportLayout({
      viewportWidth: 800,
      labelColumnWidth: 100,
      dayCount: 7,
    });
    const b = computeRoomTimelineViewportLayout({
      viewportWidth: 800,
      roomColWidth: 100,
      dayCount: 7,
    });
    expect(a).toEqual(b);
  });
});

// ============================================================================
// computeDayGridTemplateColumns
// ============================================================================

describe('computeDayGridTemplateColumns', () => {
  it('returns undefined for dayCount < 1', () => {
    expect(computeDayGridTemplateColumns(0, 44, false)).toBeUndefined();
  });

  it('returns fractional columns when useFractionalColumns is true', () => {
    const result = computeDayGridTemplateColumns(7, 44, true);
    expect(result).toBe('repeat(7, minmax(0, 1fr))');
  });

  it('returns fixed pixel columns when useFractionalColumns is false', () => {
    const result = computeDayGridTemplateColumns(7, 44, false);
    expect(result).toBe('repeat(7, 44px)');
  });
});

// ============================================================================
// computeTimelineScrollLeftToCenterDay
// ============================================================================

describe('computeTimelineScrollLeftToCenterDay', () => {
  it('returns 0 when client width is not positive', () => {
    expect(
      computeTimelineScrollLeftToCenterDay({
        scrollContainerClientWidth: 0,
        scrollContainerScrollWidth: 800,
        labelColumnWidth: 150,
        columnIndex: 3,
        cellWidthPx: 44,
      }),
    ).toBe(0);
  });

  it('clamps to max scroll when centering would scroll past the end', () => {
    const label = 150;
    const cell = 44;
    const dayCount = 10;
    const sw = label + dayCount * cell;
    const cw = 400;
    const idx = 5;
    const columnCenter = label + idx * cell + cell / 2;
    const naive = columnCenter - cw / 2;
    const max = sw - cw;
    expect(max).toBeLessThan(naive);
    expect(
      computeTimelineScrollLeftToCenterDay({
        scrollContainerClientWidth: cw,
        scrollContainerScrollWidth: sw,
        labelColumnWidth: label,
        columnIndex: idx,
        cellWidthPx: cell,
      }),
    ).toBe(max);
  });

  it('centers an interior column when there is room to scroll both ways', () => {
    const label = 100;
    const cell = 50;
    const sw = label + 20 * cell;
    const cw = 300;
    const idx = 10;
    const columnCenter = label + idx * cell + cell / 2;
    const expected = columnCenter - cw / 2;
    expect(
      computeTimelineScrollLeftToCenterDay({
        scrollContainerClientWidth: cw,
        scrollContainerScrollWidth: sw,
        labelColumnWidth: label,
        columnIndex: idx,
        cellWidthPx: cell,
      }),
    ).toBe(expected);
  });
});

// ============================================================================
// Page width
// ============================================================================

describe('timelineNeedsFullPageWidth', () => {
  const LABEL = 140;

  it('keeps the reading-width cap while the whole trip fits inside it', () => {
    // 20 days at 44px plus the label column is 1020px — room to spare.
    expect(
      timelineNeedsFullPageWidth({ dayCount: 20, labelColumnWidth: LABEL }),
    ).toBe(false);
  });

  it('gives up the cap once the trip cannot be shown at once', () => {
    // 52 days is what a seven-week trip looks like: 2428px of day axis.
    expect(
      timelineNeedsFullPageWidth({ dayCount: 52, labelColumnWidth: LABEL }),
    ).toBe(true);
  });

  it('switches exactly where the day axis stops fitting', () => {
    const cappedWidth = 1000;
    // 860px of days + 140px label = 1000px, the last width that fits.
    expect(
      timelineNeedsFullPageWidth({ dayCount: 19, labelColumnWidth: 164, cappedWidth }),
    ).toBe(false);
    expect(
      timelineNeedsFullPageWidth({ dayCount: 20, labelColumnWidth: 164, cappedWidth }),
    ).toBe(true);
  });

  it('counts the sticky label column against the available width', () => {
    const dayCount = 25;
    expect(
      timelineNeedsFullPageWidth({ dayCount, labelColumnWidth: 140, cappedWidth: 1280 }),
    ).toBe(false);
    // Same trip, a wider label column, and now the days no longer fit.
    expect(
      timelineNeedsFullPageWidth({ dayCount, labelColumnWidth: 200, cappedWidth: 1280 }),
    ).toBe(true);
  });

  it('does not widen the page for a trip with no days', () => {
    expect(
      timelineNeedsFullPageWidth({ dayCount: 0, labelColumnWidth: LABEL }),
    ).toBe(false);
  });
});

// ============================================================================
// Label folding
// ============================================================================

describe('resolveLabelColumnWidth', () => {
  const WIDTHS = { expandedWidth: 200, collapsedWidth: 40 } as const;

  it('leaves the column open at the start', () => {
    expect(resolveLabelColumnWidth({ scrollLeft: 0, ...WIDTHS })).toBe(200);
  });

  it('sheds exactly the width that has been scrolled', () => {
    // One pixel of scroll folds one pixel of column, so the first visible day
    // holds still against the column's edge instead of sliding under it.
    expect(resolveLabelColumnWidth({ scrollLeft: 1, ...WIDTHS })).toBe(199);
    expect(resolveLabelColumnWidth({ scrollLeft: 60, ...WIDTHS })).toBe(140);
    expect(resolveLabelColumnWidth({ scrollLeft: 120, ...WIDTHS })).toBe(80);
  });

  it('stops at the floor, where only the colours remain', () => {
    expect(resolveLabelColumnWidth({ scrollLeft: 160, ...WIDTHS })).toBe(40);
    expect(resolveLabelColumnWidth({ scrollLeft: 400, ...WIDTHS })).toBe(40);
    expect(resolveLabelColumnWidth({ scrollLeft: 100000, ...WIDTHS })).toBe(40);
  });

  it('keeps the column open when rubber-banding past the start', () => {
    // macOS reports a negative offset routinely; the column must not grow.
    expect(resolveLabelColumnWidth({ scrollLeft: -50, ...WIDTHS })).toBe(200);
  });

  // The old two-state version had to jump 160px, rewrite `scrollLeft` to
  // compensate, and keep its thresholds apart so neither flip triggered the
  // other. A plain function of the offset cannot oscillate.
  it('gives one width per offset, with no step between neighbours', () => {
    let previous = resolveLabelColumnWidth({ scrollLeft: 0, ...WIDTHS });

    for (let scrollLeft = 1; scrollLeft <= 240; scrollLeft++) {
      const width = resolveLabelColumnWidth({ scrollLeft, ...WIDTHS });
      // Never widens on the way in, never moves more than the scroll did.
      expect(width).toBeLessThanOrEqual(previous);
      expect(previous - width).toBeLessThanOrEqual(1);
      previous = width;
    }

    expect(previous).toBe(40);
  });

  it('is stable: the same offset always gives the same width', () => {
    expect(resolveLabelColumnWidth({ scrollLeft: 73, ...WIDTHS })).toBe(
      resolveLabelColumnWidth({ scrollLeft: 73, ...WIDTHS }),
    );
  });

  it('follows the widths it is given, not a fixed pair', () => {
    // The rooms column is 140px where the calendar's is 200px.
    const rooms = { expandedWidth: 140, collapsedWidth: 40 } as const;
    expect(resolveLabelColumnWidth({ scrollLeft: 60, ...rooms })).toBe(80);
    expect(resolveLabelColumnWidth({ scrollLeft: 100, ...rooms })).toBe(40);
  });

  it('never folds a column that would not get narrower', () => {
    expect(
      resolveLabelColumnWidth({ scrollLeft: 5000, expandedWidth: 40, collapsedWidth: 40 }),
    ).toBe(40);
  });
});

describe('labelColumnFoldDistance', () => {
  it('reports the scroll that folds the column completely', () => {
    expect(labelColumnFoldDistance(200, 40)).toBe(160);
    expect(labelColumnFoldDistance(140, 40)).toBe(100);
  });

  it('reports no distance for a column that cannot fold', () => {
    expect(labelColumnFoldDistance(40, 40)).toBe(0);
    expect(labelColumnFoldDistance(20, 40)).toBe(0);
  });
});
