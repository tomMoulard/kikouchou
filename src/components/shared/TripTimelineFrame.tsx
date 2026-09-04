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
import { toLocalISODateString } from '@/lib/db/utils';
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
  /** One local-midnight Date per column, from `buildDayColumns`. */
  readonly days: readonly Date[];
  /** Local day keys matching `days` one-for-one, from `toDayKeys`. */
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
      {/*
        `tabIndex={0}` makes the scroll container reachable by keyboard.
        Without it a keyboard-only user could not scroll the timeline at all
        when its content overflows — axe's `scrollable-region-focusable`, which
        fires on the narrow viewport where the timeline actually does overflow.
        The `role="region"` and its label live on the parent, so this element
        stays a plain scroll surface.

        Days scroll sideways; rows do not. A `max-h-[70vh]` here put a second,
        nested scrollbar on a timeline of three rows — the rows are what the
        reader is counting, so the frame grows to fit them all and the page
        takes the scrolling.
      */}
      <div
        ref={scrollRef}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Deliberate, and the comment above says why: axe's `scrollable-region-focusable` requires an overflowing scroll container to be reachable by keyboard, which is the one case where a non-interactive element must be tabbable.
        tabIndex={0}
        className={cn('w-full min-w-0', 'overflow-x-auto')}
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
                  // `days` are local midnights and `dayKeys` their local keys
                  // (see `lib/utils/trip-days`), so the label date-fns prints
                  // and the key the "today" highlight matches on are the same
                  // calendar day in every timezone.
                  const key = dayKeys[index] ?? toLocalISODateString(day);
                  const monthLabel = format(day, 'MMM', { locale: dateLocale });
                  const dayLabel = format(day, 'dd', { locale: dateLocale });
                  const isToday = todayColumnIndex === index;
                  return (
                    <div
                      key={`timeline-day-${index}-${key}`}
                      className={cn(
                        'min-w-0 border-r border-muted px-1 py-2 text-xs text-muted-foreground',
                        isToday && 'bg-primary/12 text-foreground',
                      )}
                      title={format(day, 'PPPP', { locale: dateLocale })}
                      {...(isToday ? { 'aria-current': 'date' as const } : {})}
                    >
                      <div className="flex flex-col items-center leading-none">
                        {/*
                          Full-strength `muted-foreground`, not `/80`, at the
                          12px floor rather than 10px.

                          This is normal-size text for WCAG, so AA wants 4.5:1.
                          The 80% tint measured 4.24:1 on the white header and
                          3.59:1 over today's `bg-primary/12` column; at full
                          strength it is 6.9:1 and 5.4:1. Dropping the opacity
                          is what let `color-contrast` be turned back on in
                          `e2e/accessibility.spec.ts`, and `text-xs` is the
                          legibility floor the rest of the timeline now uses.
                        */}
                        <div className="text-xs text-muted-foreground truncate">
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
