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
import {
  TIMELINE_LABEL_CELL_STYLE,
  TIMELINE_LABEL_EXPANDED_VAR,
  TIMELINE_LABEL_WIDTH_VAR,
} from './timeline-label-cell';
import { toLocalISODateString } from '@/lib/db/utils';
import { TIMELINE_LANE_HEIGHT_PX } from '@/lib/utils/timeline-bar-geometry';
import {
  computeDayGridTemplateColumns,
  computeTimelineScrollLeftToCenterDay,
  computeTimelineViewportLayout,
  resolveLabelColumnWidth,
} from '@/lib/utils/timeline-viewport-layout';
import type { ISODateString } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Sticky label width once the user has scrolled the day axis — wide enough for
 * a colour dot (or room/category glyph), not a name. Shrinking here is what
 * frees horizontal space for the trip days.
 */
export const TIMELINE_COLLAPSED_LABEL_COLUMN_WIDTH_PX = 40;

// ============================================================================
// Types
// ============================================================================

export interface TripTimelineViewportContext {
  readonly labelColumnWidth: number;
  /**
   * True after the day axis has been scrolled: row labels should keep only the
   * colour/glyph and hide the name, matching the narrower sticky column.
   */
  readonly labelsCollapsed: boolean;
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
  // True once the column has folded all the way down to the colours. Only the
  // padding and the header's own label read it — the width itself is not React
  // state, see the scroll effect below.
  const [labelsCollapsed, setLabelsCollapsed] = useState(false);

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

  // The fold is driven straight into a CSS variable rather than through React.
  //
  // It has to update on every scroll frame, and re-rendering a timeline of rows
  // that often would drop frames on exactly the gesture it is meant to smooth.
  // Writing one custom property lets the browser resize every sticky cell in
  // the same style recalculation, with no reconciliation at all. The boolean
  // below is separate because it flips at most twice across a whole fold.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    el.style.setProperty(TIMELINE_LABEL_EXPANDED_VAR, `${labelColumnWidth}px`);

    const syncFoldFromScroll = (): void => {
      const width = resolveLabelColumnWidth({
        scrollLeft: el.scrollLeft,
        expandedWidth: labelColumnWidth,
        collapsedWidth: TIMELINE_COLLAPSED_LABEL_COLUMN_WIDTH_PX,
      });

      el.style.setProperty(TIMELINE_LABEL_WIDTH_VAR, `${width}px`);
      setLabelsCollapsed(width <= TIMELINE_COLLAPSED_LABEL_COLUMN_WIDTH_PX);
    };

    el.addEventListener('scroll', syncFoldFromScroll, { passive: true });
    syncFoldFromScroll();
    return () => {
      el.removeEventListener('scroll', syncFoldFromScroll);
    };
  }, [labelColumnWidth]);

  const dayCount = days.length;

  // Measured against the column's *open* width, never the folded one. The day
  // grid must not resize while the column folds, and the column's slot in the
  // layout stays this wide throughout — it is only the visible part that
  // narrows, so the days keep their positions and the total scrollable width
  // never changes underfoot.
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
      labelsCollapsed,
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
      labelsCollapsed,
      canvasWidth,
      dayCount,
      dayWidthPx,
      useFractionalColumns,
      dayGridTemplateColumns,
      cellWidthPx,
      todayColumnIndex,
    ],
  );

  // What the last auto-centre was for. Collapsing the label column changes
  // `effectiveLabelColumnWidth`, and through it `canvasWidth` and `cellWidthPx`
  // — so without this the centre-on-today below re-ran on every collapse and
  // every expand, and that closed a loop: scrolling back to the start expanded
  // the column, the expand re-centred on today, the jump past the collapse
  // point collapsed it again, and the collapse re-centred once more. Centring
  // belongs to the trip and the viewport, not to a column the reader just
  // toggled by scrolling.
  const centredForRef = useRef<string | null>(null);

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

    const centreFor = `${todayColumnIndex}|${dayCount}|${viewportWidth}`;
    if (centredForRef.current === centreFor) {
      return;
    }
    centredForRef.current = centreFor;

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
        data-labels-collapsed={labelsCollapsed ? 'true' : 'false'}
      >
        <div style={{ width: labelColumnWidth + canvasWidth }}>
          <div className="sticky top-0 z-20 flex border-b border-muted bg-background">
            <div
              className={cn(
                'sticky left-0 z-30 border-r border-muted bg-background py-2',
                labelsCollapsed ? 'px-1' : 'px-3',
              )}
              style={TIMELINE_LABEL_CELL_STYLE}
            >
              {/*
                The title is decorative once collapsed — each row still names
                the guest for assistive tech. Hiding it is what lets the colour
                dots claim the narrow column without competing text.
              */}
              <div className={cn(labelsCollapsed && 'sr-only')}>{leftHeader}</div>
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
