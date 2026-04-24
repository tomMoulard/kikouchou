/**
 * @fileoverview Tests for timeline viewport layout computation.
 *
 * @module lib/utils/__tests__/timeline-viewport-layout.test
 */

import { describe, it, expect } from 'vitest';

import {
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
