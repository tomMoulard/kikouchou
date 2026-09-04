/**
 * @fileoverview Tests for timeline viewport layout computation.
 *
 * @module lib/utils/__tests__/timeline-viewport-layout.test
 */

import { describe, it, expect } from 'vitest';

import {
  timelineNeedsFullPageWidth,
  resolveLabelCollapse,
  TIMELINE_LABEL_COLLAPSE_MARGIN_PX,
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
// Label collapse
// ============================================================================

describe('resolveLabelCollapse', () => {
  const WIDTHS = { expandedLabelWidth: 200, collapsedLabelWidth: 40 } as const;
  const DELTA = WIDTHS.expandedLabelWidth - WIDTHS.collapsedLabelWidth;

  it('does not collapse before there is enough scroll to pay for the width it removes', () => {
    // The old rule collapsed past 8px while owing 160px of compensation, so the
    // grid jumped the whole delta with nothing to take it from.
    const decision = resolveLabelCollapse({
      scrollLeft: 9,
      isCollapsed: false,
      ...WIDTHS,
    });

    expect(decision.collapsed).toBe(false);
    expect(decision.changed).toBe(false);
  });

  it('collapses once past the delta and compensates it exactly', () => {
    const scrollLeft = DELTA + TIMELINE_LABEL_COLLAPSE_MARGIN_PX + 1;
    const decision = resolveLabelCollapse({ scrollLeft, isCollapsed: false, ...WIDTHS });

    expect(decision.collapsed).toBe(true);
    // Exactly the width removed, so the day under the pointer does not move.
    expect(decision.nextScrollLeft).toBe(scrollLeft - DELTA);
  });

  // The jitter itself: collapsing must not leave the scroll position somewhere
  // that immediately expands again, and vice versa.
  it('settles after collapsing instead of bouncing back', () => {
    const first = resolveLabelCollapse({
      scrollLeft: DELTA + TIMELINE_LABEL_COLLAPSE_MARGIN_PX + 1,
      isCollapsed: false,
      ...WIDTHS,
    });
    expect(first.collapsed).toBe(true);

    // Feed the compensated offset straight back in, as the scroll event does.
    const second = resolveLabelCollapse({
      scrollLeft: first.nextScrollLeft!,
      isCollapsed: true,
      ...WIDTHS,
    });

    expect(second.collapsed).toBe(true);
    expect(second.changed).toBe(false);
  });

  it('leaves a margin of scroll between collapsing and expanding again', () => {
    const collapse = resolveLabelCollapse({
      scrollLeft: DELTA + TIMELINE_LABEL_COLLAPSE_MARGIN_PX + 1,
      isCollapsed: false,
      ...WIDTHS,
    });

    // Still collapsed part-way back — the two thresholds do not touch.
    expect(
      resolveLabelCollapse({
        scrollLeft: collapse.nextScrollLeft! - 1,
        isCollapsed: true,
        ...WIDTHS,
      }).collapsed,
    ).toBe(true);
  });

  it('expands only once scrolled fully back to the start', () => {
    expect(
      resolveLabelCollapse({ scrollLeft: 1, isCollapsed: true, ...WIDTHS }).collapsed,
    ).toBe(true);

    const expanded = resolveLabelCollapse({ scrollLeft: 0, isCollapsed: true, ...WIDTHS });
    expect(expanded.collapsed).toBe(false);
    expect(expanded.nextScrollLeft).toBeNull();
  });

  it('settles after expanding instead of bouncing back', () => {
    const expanded = resolveLabelCollapse({ scrollLeft: 0, isCollapsed: true, ...WIDTHS });
    expect(expanded.collapsed).toBe(false);

    expect(
      resolveLabelCollapse({ scrollLeft: 0, isCollapsed: false, ...WIDTHS }).changed,
    ).toBe(false);
  });

  // The rooms timeline uses a 140px column, so the delta differs from the
  // calendar's. The thresholds have to follow the widths, not a constant.
  it('scales both thresholds to the column widths it is given', () => {
    const rooms = { expandedLabelWidth: 140, collapsedLabelWidth: 40 } as const;
    const roomsDelta = 100;

    expect(
      resolveLabelCollapse({ scrollLeft: 130, isCollapsed: false, ...rooms }).collapsed,
    ).toBe(false);

    const collapsed = resolveLabelCollapse({
      scrollLeft: roomsDelta + TIMELINE_LABEL_COLLAPSE_MARGIN_PX + 1,
      isCollapsed: false,
      ...rooms,
    });
    expect(collapsed.collapsed).toBe(true);
    expect(collapsed.nextScrollLeft).toBe(41);
  });

  it('never collapses a column that would not get any narrower', () => {
    const decision = resolveLabelCollapse({
      scrollLeft: 5000,
      isCollapsed: false,
      expandedLabelWidth: 40,
      collapsedLabelWidth: 40,
    });

    expect(decision.collapsed).toBe(false);
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
