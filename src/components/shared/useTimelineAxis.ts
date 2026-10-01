/**
 * @fileoverview The zoom state every horizontal timeline shares: which scale is
 * showing, the axis that scale produces, and the way back to the present.
 *
 * Kept out of the individual timelines so the guest calendar and the room
 * occupancy board cannot drift apart — one of them gaining a scale the other
 * does not have is exactly the kind of difference a reader has to relearn.
 *
 * @module components/shared/useTimelineAxis
 */

import { useCallback, useMemo, useState } from 'react';
import { addDays, type Locale } from 'date-fns';

import {
  TIMELINE_SCALES,
  type TimelineColumn,
  type TimelineScaleId,
  buildTimelineColumns,
  columnsFromDays,
} from '@/lib/utils/timeline-scale';
import type { ISODateString } from '@/types';

// ============================================================================
// Types
// ============================================================================

export interface TimelineAxis {
  readonly scale: TimelineScaleId;
  readonly setScale: (scale: TimelineScaleId) => void;
  /** The columns to hand the frame and the model builders. */
  readonly columns: readonly TimelineColumn[];
  /** Column width this scale's labels need; pass it to the frame. */
  readonly preferredColumnWidthPx: number;
  /** Hand to the frame: any new value asks it to centre on the present again. */
  readonly recenterToken: number;
  /** Sends the axis back to the present moment. */
  readonly goToNow: () => void;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Holds a timeline's scale and builds the axis it implies.
 *
 * The whole trip is always on the axis, at every scale. Zooming in to a quarter
 * of an hour a column does not cut the trip down to one day: it makes the same
 * trip longer to scroll, which is what a reader means by zooming in. The
 * `month` scale is the day-per-column axis the timelines had before scales
 * existed, and it is passed straight through so nothing about it changes.
 *
 * @param args - The day axis the page already built, the locale, and the present instant
 * @returns The scale, its axis, and the controls to drive both
 *
 * @example
 * ```tsx
 * const axis = useTimelineAxis({ days: model.days, dayKeys: model.dayKeys, dateLocale, today });
 * <TripTimelineFrame columns={axis.columns} recenterToken={axis.recenterToken} ... />
 * ```
 */
export function useTimelineAxis(args: {
  /** One local midnight per day the timeline must reach, from `buildDayColumns`. */
  readonly days: readonly Date[];
  /** The matching day keys, from `toDayKeys`. */
  readonly dayKeys: readonly ISODateString[];
  readonly dateLocale: Locale;
  /** The present moment: what the now-marker marks and what "now" scrolls to. */
  readonly today: Date;
}): TimelineAxis {
  const { days, dayKeys, dateLocale, today } = args;

  const [scale, setScale] = useState<TimelineScaleId>('month');
  const [recenterToken, setRecenterToken] = useState(0);

  const goToNow = useCallback(() => {
    setRecenterToken((token) => token + 1);
  }, []);

  const columns = useMemo(() => {
    if (scale === 'month') {
      return columnsFromDays(days, dayKeys, dateLocale);
    }

    const first = days[0];
    const last = days[days.length - 1];
    // A trip whose days are not known yet has no span to cover, so the scale
    // falls back to its own window around the present.
    const range =
      first && last ? { start: first, end: addDays(last, 1) } : undefined;

    return buildTimelineColumns({ scale, anchor: today, range, locale: dateLocale });
  }, [scale, days, dayKeys, dateLocale, today]);

  return {
    scale,
    setScale,
    columns,
    preferredColumnWidthPx: TIMELINE_SCALES[scale].preferredColumnWidthPx,
    recenterToken,
    goToNow,
  };
}
