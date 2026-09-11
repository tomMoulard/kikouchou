/**
 * @fileoverview Tests for the shared timeline zoom state.
 * @module components/shared/__tests__/useTimelineAxis.test
 */

import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { enUS } from 'date-fns/locale';

import { useTimelineAxis } from '../useTimelineAxis';
import { buildDayColumns, toDayKeys } from '@/lib/utils/trip-days';
import type { ISODateString } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

/** A four-day trip: 14 to 17 July 2026 inclusive. */
const TRIP_DAYS = buildDayColumns('2026-07-14' as ISODateString, '2026-07-17' as ISODateString);
const TRIP_DAY_KEYS = toDayKeys(TRIP_DAYS);
const TODAY = new Date(2026, 6, 15, 9, 30);

function renderAxis() {
  return renderHook(() =>
    useTimelineAxis({
      days: TRIP_DAYS,
      dayKeys: TRIP_DAY_KEYS,
      dateLocale: enUS,
      today: TODAY,
    }),
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('useTimelineAxis', () => {
  it('starts on the trip scale, one column per trip day', () => {
    const { result } = renderAxis();

    expect(result.current.scale).toBe('month');
    expect(result.current.columns).toHaveLength(TRIP_DAYS.length);
    expect(result.current.columns[0]?.dayKey).toBe(TRIP_DAY_KEYS[0]);
  });

  // Zooming in means finer columns over the same trip, never a shorter trip.
  it('still covers the whole trip once the columns are quarter-hours', () => {
    const { result } = renderAxis();

    act(() => {
      result.current.setScale('hours');
    });

    expect(result.current.columns).toHaveLength(TRIP_DAYS.length * 96);
    expect(result.current.columns[0]?.start).toEqual(TRIP_DAYS[0]);
  });

  it('still covers the whole trip once the columns are hours', () => {
    const { result } = renderAxis();

    act(() => {
      result.current.setScale('day');
    });

    expect(result.current.columns).toHaveLength(TRIP_DAYS.length * 24);
  });

  it('offers each scale the column width its own labels need', () => {
    const { result } = renderAxis();
    const tripWidth = result.current.preferredColumnWidthPx;

    act(() => {
      result.current.setScale('hours');
    });

    // `14:15` needs more room than `Jul` over `14`.
    expect(result.current.preferredColumnWidthPx).toBeGreaterThan(tripWidth);
  });

  it('asks the frame to centre again every time the reader presses now', () => {
    const { result } = renderAxis();
    const before = result.current.recenterToken;

    act(() => {
      result.current.goToNow();
    });
    const once = result.current.recenterToken;

    act(() => {
      result.current.goToNow();
    });

    expect(once).not.toBe(before);
    expect(result.current.recenterToken).not.toBe(once);
  });

  it('keeps the same axis object while nothing changes', () => {
    const { result, rerender } = renderAxis();
    const first = result.current.columns;

    rerender();

    // The model builders memoize on this identity; a new array every render
    // would rebuild every row of the timeline on every render.
    expect(result.current.columns).toBe(first);
  });
});
