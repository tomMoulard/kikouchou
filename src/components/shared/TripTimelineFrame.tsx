/**
 * @fileoverview Shared shell for horizontal trip timelines (calendar guests + room occupancy).
 * Provides sticky header, responsive day columns, and viewport metrics for row content.
 *
 * @module components/shared/TripTimelineFrame
 */

import {
  type ReactElement,
  type ReactNode,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Locale } from 'date-fns';
import { format } from 'date-fns';

import { cn } from '@/lib/utils';
import { toISODateString } from '@/lib/db/utils';
import { TIMELINE_LANE_HEIGHT_PX } from '@/lib/utils/timeline-bar-geometry';
import {
  computeDayGridTemplateColumns,
  computeTimelineScrollLeftToCenterDay,
  computeTimelineViewportLayout,
} from '@/lib/utils/timeline-viewport-layout';
import type { ISODateString } from '@/types';

// ============================================================================
// Types
// ============================================================================

export interface TripTimelineViewportContext {
  readonly labelColumnWidth: number;
  readonly canvasWidth: number;
  readonly dayCount: number;
  readonly dayWidthPx: number;
  readonly useFractionalColumns: boolean;
  readonly dayGridTemplateColumns: string | undefined;
  readonly laneHeightPx: number;
  /** Pixel width of one day column (`canvasWidth / dayCount`). */
  readonly cellWidthPx: number;
  readonly todayColumnIndex: number | undefined;
}

export interface TripTimelineFrameProps {
  readonly ariaLabel: string;
  readonly labelColumnWidth: number;
  readonly leftHeader: ReactNode;
  readonly days: readonly Date[];
  readonly dayKeys: readonly ISODateString[];
  readonly dateLocale: Locale;
  /** When set, that day column is highlighted in the header (local “today”). */
  readonly todayKey?: ISODateString;
  /**
   * Optional extra content rendered under each day number in the header
   * (e.g. the number of people on site that night).
   * Memoize the callback — the frame is a `memo` component.
   */
  readonly renderDayMeta?: (dayKey: ISODateString, index: number) => ReactNode;
  readonly children: (viewport: TripTimelineViewportContext) => ReactNode;
}

/**
 * Re-reads a `YYYY-MM-DD` day key as a local-midnight Date, so date-fns
 * `format()` prints exactly that calendar day in every timezone.
 *
 * @param dayKey - A day key from `buildTripDayColumns`
 * @returns A Date whose local calendar day equals `dayKey`
 */
function localDateFromDayKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(year, month - 1, day);
}

// ============================================================================
// Component
// ============================================================================

const TripTimelineFrame = memo(function TripTimelineFrame({
  ariaLabel,
  labelColumnWidth,
  leftHeader,
  days,
  dayKeys,
  dateLocale,
  todayKey,
  renderDayMeta,
  children,
}: TripTimelineFrameProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const update = (): void => {
      setViewportWidth(el.clientWidth);
    };

    update();
    const ro = new ResizeObserver(() => {
      update();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const dayCount = days.length;

  const { dayWidthPx, canvasWidth, useFractionalColumns } = useMemo(
    () =>
      computeTimelineViewportLayout({
        viewportWidth,
        labelColumnWidth,
        dayCount,
      }),
    [viewportWidth, labelColumnWidth, dayCount],
  );

  const dayGridTemplateColumns = useMemo(
    () => computeDayGridTemplateColumns(dayCount, dayWidthPx, useFractionalColumns),
    [dayCount, dayWidthPx, useFractionalColumns],
  );

  const todayColumnIndex = useMemo(() => {
    if (!todayKey) {
      return undefined;
    }
    const idx = dayKeys.indexOf(todayKey);
    return idx >= 0 ? idx : undefined;
  }, [dayKeys, todayKey]);

  const cellWidthPx = useMemo(() => {
    if (dayCount < 1) {
      return dayWidthPx;
    }
    return canvasWidth / dayCount;
  }, [canvasWidth, dayCount, dayWidthPx]);

  const viewport = useMemo(
    (): TripTimelineViewportContext => ({
      labelColumnWidth,
      canvasWidth,
      dayCount,
      dayWidthPx,
      useFractionalColumns,
      dayGridTemplateColumns,
      laneHeightPx: TIMELINE_LANE_HEIGHT_PX,
      cellWidthPx,
      todayColumnIndex,
    }),
    [
      labelColumnWidth,
      canvasWidth,
      dayCount,
      dayWidthPx,
      useFractionalColumns,
      dayGridTemplateColumns,
      cellWidthPx,
      todayColumnIndex,
    ],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (
      !el ||
      todayColumnIndex === undefined ||
      dayCount < 1 ||
      viewportWidth <= 0
    ) {
      return;
    }
    el.scrollLeft = computeTimelineScrollLeftToCenterDay({
      scrollContainerClientWidth: el.clientWidth,
      scrollContainerScrollWidth: el.scrollWidth,
      labelColumnWidth,
      columnIndex: todayColumnIndex,
      cellWidthPx,
    });
  }, [
    todayColumnIndex,
    labelColumnWidth,
    cellWidthPx,
    dayCount,
    viewportWidth,
    canvasWidth,
  ]);

  return (
    <div role="region" aria-label={ariaLabel} className="w-full min-w-0 border rounded-lg overflow-hidden">
      <div
        ref={scrollRef}
        className={cn('w-full min-w-0 max-h-[70vh]', 'overflow-x-auto overflow-y-auto')}
      >
        <div style={{ width: labelColumnWidth + canvasWidth }}>
          <div className="sticky top-0 z-20 flex border-b border-muted bg-background">
            <div
              className="sticky left-0 z-30 border-r border-muted bg-background px-3 py-2"
              style={{ width: labelColumnWidth, minWidth: labelColumnWidth }}
            >
              {leftHeader}
            </div>

            <div className="relative min-w-0 overflow-hidden" style={{ width: canvasWidth }}>
              <div
                className="grid h-full min-w-0 w-full"
                style={
                  dayGridTemplateColumns !== undefined
                    ? { gridTemplateColumns: dayGridTemplateColumns }
                    : undefined
                }
              >
                {days.map((day, index) => {
                  const key = toISODateString(day);
                  // `days` are built by stepping in UTC, so date-fns `format()`
                  // — which reads LOCAL components — prints the previous day at
                  // any negative offset, while the "today" highlight (matched on
                  // `key`) lands on the correct column. Label from the key.
                  const labelDate = localDateFromDayKey(key);
                  const monthLabel = format(labelDate, 'MMM', { locale: dateLocale });
                  const dayLabel = format(labelDate, 'dd', { locale: dateLocale });
                  const isToday = todayColumnIndex === index;
                  return (
                    <div
                      key={`timeline-day-${index}-${key}`}
                      className={cn(
                        'min-w-0 border-r border-muted px-1 py-2 text-xs text-muted-foreground',
                        isToday && 'bg-primary/12 text-foreground',
                      )}
                      title={format(labelDate, 'PPPP', { locale: dateLocale })}
                      {...(isToday ? { 'aria-current': 'date' as const } : {})}
                    >
                      <div className="flex flex-col items-center leading-none">
                        <div className="text-[10px] text-muted-foreground/80 truncate">
                          {monthLabel}
                        </div>
                        <div
                          className={cn(
                            'font-medium tabular-nums truncate',
                            isToday ? 'text-foreground font-semibold' : 'text-foreground',
                          )}
                        >
                          {dayLabel}
                        </div>
                        {renderDayMeta?.(key, index)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {children(viewport)}
        </div>
      </div>
    </div>
  );
});

export { TripTimelineFrame };
