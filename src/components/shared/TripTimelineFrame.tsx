/**
 * @fileoverview Shared shell for horizontal trip timelines (calendar guests + room occupancy).
 * Provides sticky header, responsive time columns, and viewport metrics for row content.
 *
 * @module components/shared/TripTimelineFrame
 */

import {
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Locale } from 'date-fns';

import { cn } from '@/lib/utils';
import {
  type TimelineScrollApi,
  type TimelineVisibleRange,
  TimelineScrollContext,
} from './timeline-scroll-context';
import {
  TIMELINE_LABEL_CELL_STYLE,
  TIMELINE_LABEL_EXPANDED_VAR,
  TIMELINE_LABEL_WIDTH_VAR,
} from './timeline-label-cell';
import { toLocalISODateString } from '@/lib/db/utils';
import { TIMELINE_LANE_HEIGHT_PX } from '@/lib/utils/timeline-bar-geometry';
import {
  type TimelineColumn,
  columnsFromDays,
  resolveNowPosition,
} from '@/lib/utils/timeline-scale';
import {
  computeDayGridTemplateColumns,
  computeTimelineViewportLayout,
  computeTimelineScrollLeftToCenterDay,
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

/**
 * The scrollbar control reports the scroll offset as a whole percentage.
 *
 * Percent rather than pixels because the value is read out to assistive tech
 * and stepped by the arrow keys: "40" means something to both, a pixel offset
 * into a canvas means nothing to either.
 */
const TIMELINE_SCROLLBAR_STEPS = 100;

/** How often the now-marker moves itself, in milliseconds. */
const TIMELINE_NOW_MARKER_TICK_MS = 30_000;

/** Shared empty axis, so "no columns" keeps one identity across renders. */
const TIMELINE_NO_COLUMNS: readonly TimelineColumn[] = [];

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
  /** The axis itself, so a row can read a column's time range or weekend flag. */
  readonly columns: readonly TimelineColumn[];
}

export interface TripTimelineFrameProps {
  readonly ariaLabel: string;
  readonly labelColumnWidth: number;
  readonly leftHeader: ReactNode;
  /**
   * One local-midnight Date per column, from `buildDayColumns`.
   *
   * The day-per-column axis, and the only axis a caller that does not pass
   * `columns` can have. Ignored when `columns` is given.
   */
  readonly days: readonly Date[];
  /** Local day keys matching `days` one-for-one, from `toDayKeys`. */
  readonly dayKeys: readonly ISODateString[];
  /**
   * The axis, at whatever scale the caller is showing.
   *
   * Overrides `days`/`dayKeys` when set. A caller with a plain day axis can
   * leave it out and the frame builds the day columns itself, which is what
   * every timeline did before scales existed.
   */
  readonly columns?: readonly TimelineColumn[];
  readonly dateLocale: Locale;
  /**
   * Column width the layout aims for before compressing. Leave unset for the
   * day-axis width. See `computeTimelineViewportLayout`.
   */
  readonly preferredColumnWidthPx?: number;
  /** When set, that day column is highlighted in the header (local “today”). */
  readonly todayKey?: ISODateString;
  /**
   * The current instant, for the vertical now-marker.
   *
   * Set it and the frame draws a line through every row at the present moment
   * and centres the axis on it; leave it out and the frame keeps the older
   * behaviour of centring on `todayKey` with no marker.
   */
  readonly now?: Date;
  /**
   * Bumped by the caller to send the axis back to now.
   *
   * The frame centres itself once per trip and viewport and then leaves the
   * reader's scroll position alone — so a "now" button needs a way to ask for
   * another centring without changing anything else. Any new value does it.
   */
  readonly recenterToken?: number;
  /**
   * The trip's own dates, when the axis is allowed to run past them.
   *
   * The axis covers every event the timeline draws, which can be a flight the
   * day before the trip starts, so the columns outside this range are marked as
   * not part of the trip. Leave it unset when the axis *is* the trip.
   */
  readonly tripRange?: { readonly startKey: ISODateString; readonly endKey: ISODateString };
  /**
   * Translated name for a column outside `tripRange`, read to assistive tech
   * and added to the column's tooltip. Required for `tripRange` to say anything
   * to a screen reader — the greying alone is visual.
   */
  readonly outsideTripLabel?: string;
  /** Translated name for the now-marker (`common.currentTime`). */
  readonly nowLabel?: string;
  /**
   * Translated label for the scrollbar control under the timeline
   * (`common.scrollTimeline`). Falls back to `ariaLabel`, which names the
   * timeline rather than the control, so pass it.
   */
  readonly scrollbarLabel?: string;
  /** Controls rendered above the timeline, such as the scale dropdown. */
  readonly toolbar?: ReactNode;
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
  columns: columnsProp,
  dateLocale,
  preferredColumnWidthPx,
  todayKey,
  now,
  recenterToken,
  tripRange,
  outsideTripLabel,
  nowLabel,
  scrollbarLabel,
  toolbar,
  renderDayMeta,
  children,
}: TripTimelineFrameProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLInputElement>(null);
  const nowMarkerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  // True once the column has folded all the way down to the colours. Only the
  // padding and the header's own label read it — the width itself is not React
  // state, see the scroll effect below.
  const [labelsCollapsed, setLabelsCollapsed] = useState(false);

  // A day axis when the caller has not built one of its own. Memoized against
  // the inputs rather than rebuilt per render: it is a `map` over every column
  // of the trip and it feeds the layout memos below.
  const derivedDayColumns = useMemo(
    () => (columnsProp === undefined ? columnsFromDays(days, dayKeys, dateLocale) : undefined),
    [columnsProp, days, dayKeys, dateLocale],
  );
  const columns = columnsProp ?? derivedDayColumns ?? TIMELINE_NO_COLUMNS;

  /**
   * The now-marker's own clock.
   *
   * `now` is a prop so the caller decides what "now" means (and tests can pin
   * it), but a marker that only moved when its page re-rendered would sit still
   * for as long as the reader leaves the tab open. This ticks it along.
   */
  const [tickedNow, setTickedNow] = useState<Date | undefined>(undefined);
  useEffect(() => {
    if (now === undefined) {
      return;
    }
    const id = setInterval(() => {
      setTickedNow(new Date());
    }, TIMELINE_NOW_MARKER_TICK_MS);
    return () => {
      clearInterval(id);
    };
  }, [now]);

  // Whichever is later wins, which needs no reset when the prop changes: a
  // caller handing down a fresher `now` overtakes the last tick by definition,
  // and a tick left over from an older prop can never win.
  const markerNow =
    now === undefined ? undefined : tickedNow !== undefined && tickedNow > now ? tickedNow : now;

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

  /**
   * Moves the scrollbar's thumb to wherever the day axis now is.
   *
   * Deliberately a DOM write and not React state, for the same reason the label
   * fold below is: this runs on every scroll frame, and re-rendering every row
   * of the timeline that often would drop frames on the gesture the control
   * exists to smooth. The input is uncontrolled, and this is the one place its
   * value comes from.
   */
  const syncScrollbarFromScroll = useCallback((): void => {
    const el = scrollRef.current;
    const bar = scrollbarRef.current;
    if (!el || !bar) {
      return;
    }

    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    const ratio = maxScrollLeft > 0 ? el.scrollLeft / maxScrollLeft : 0;
    bar.value = String(Math.round(Math.min(1, Math.max(0, ratio)) * TIMELINE_SCROLLBAR_STEPS));
  }, []);

  /** The other direction: the reader drags, types or taps the control. */
  const handleScrollbarChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const steps = Number(event.target.value);
    if (!Number.isFinite(steps)) {
      return;
    }

    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    el.scrollLeft = (steps / TIMELINE_SCROLLBAR_STEPS) * maxScrollLeft;
  }, []);

  // ==========================================================================
  // Which part of the axis is on screen
  // ==========================================================================

  const visibleRangeListenersRef = useRef(new Set<(range: TimelineVisibleRange) => void>());
  const lastVisibleRangeRef = useRef<TimelineVisibleRange>({ start: 0, end: 0 });

  /**
   * Reads the visible slice of the canvas straight off the element.
   *
   * In canvas coordinates, where 0 is the first column's left edge. The sticky
   * label column covers the leftmost pixels of the canvas rather than sitting
   * beside them, so whatever width it has folded to is subtracted from the
   * visible width — otherwise a pill under the guest names would count as seen.
   */
  const readVisibleRange = useCallback((): TimelineVisibleRange => {
    const el = scrollRef.current;
    if (!el) {
      return { start: 0, end: 0 };
    }

    const labelWidth = resolveLabelColumnWidth({
      scrollLeft: el.scrollLeft,
      expandedWidth: labelColumnWidth,
      collapsedWidth: TIMELINE_COLLAPSED_LABEL_COLUMN_WIDTH_PX,
    });

    const start = el.scrollLeft + labelWidth - labelColumnWidth;
    const end = el.scrollLeft + el.clientWidth - labelColumnWidth;
    return { start: Math.max(0, start), end: Math.max(0, end) };
  }, [labelColumnWidth]);

  const publishVisibleRange = useCallback((): void => {
    const range = readVisibleRange();
    lastVisibleRangeRef.current = range;
    for (const listener of visibleRangeListenersRef.current) {
      listener(range);
    }
  }, [readVisibleRange]);

  const subscribeVisibleRange = useCallback(
    (listener: (range: TimelineVisibleRange) => void): (() => void) => {
      visibleRangeListenersRef.current.add(listener);
      listener(lastVisibleRangeRef.current);
      return () => {
        visibleRangeListenersRef.current.delete(listener);
      };
    },
    [],
  );

  const scrollCanvasPositionIntoView = useCallback(
    (canvasX: number): void => {
      const el = scrollRef.current;
      if (!el) {
        return;
      }
      const target = labelColumnWidth + canvasX - el.clientWidth / 2;
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      el.scrollLeft = Math.max(0, Math.min(max, target));
    },
    [labelColumnWidth],
  );

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
      syncScrollbarFromScroll();
      publishVisibleRange();
    };

    el.addEventListener('scroll', syncFoldFromScroll, { passive: true });
    syncFoldFromScroll();
    return () => {
      el.removeEventListener('scroll', syncFoldFromScroll);
    };
  }, [labelColumnWidth, publishVisibleRange, syncScrollbarFromScroll]);

  const dayCount = columns.length;

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
        preferredColumnWidthPx,
      }),
    [viewportWidth, labelColumnWidth, dayCount, preferredColumnWidthPx],
  );

  const dayGridTemplateColumns = useMemo(
    () => computeDayGridTemplateColumns(dayCount, dayWidthPx, useFractionalColumns),
    [dayCount, dayWidthPx, useFractionalColumns],
  );

  const todayColumnIndex = useMemo(() => {
    if (!todayKey) {
      return undefined;
    }
    const idx = columns.findIndex((column) => column.dayKey === todayKey);
    return idx >= 0 ? idx : undefined;
  }, [columns, todayKey]);

  const cellWidthPx = useMemo(() => {
    if (dayCount < 1) {
      return dayWidthPx;
    }
    return canvasWidth / dayCount;
  }, [canvasWidth, dayCount, dayWidthPx]);

  /** Where the now-marker sits, in canvas pixels — undefined when now is off the axis. */
  const nowCanvasX = useMemo(() => {
    if (markerNow === undefined || dayCount < 1) {
      return undefined;
    }
    const position = resolveNowPosition(columns, markerNow);
    if (position === undefined) {
      return undefined;
    }
    return (position.columnIndex + position.fraction) * cellWidthPx;
  }, [columns, markerNow, cellWidthPx, dayCount]);

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
      columns,
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
      columns,
    ],
  );

  const scrollApi = useMemo(
    (): TimelineScrollApi => ({ subscribeVisibleRange, scrollCanvasPositionIntoView }),
    [subscribeVisibleRange, scrollCanvasPositionIntoView],
  );

  /**
   * Whether the day axis is wider than the viewport, and so whether the
   * scrollbar control below it has anything to scroll.
   *
   * Answered from the layout the frame just decided, not read back off the
   * element: `computeTimelineViewportLayout` either fits the days into the
   * width it was given, or falls back to a fixed day width that overflows it.
   * A measurement would also be a second source of truth for the same fact,
   * one frame behind this one.
   */
  const maxScrollLeft = Math.max(0, labelColumnWidth + canvasWidth - viewportWidth);
  const isScrollable = viewportWidth > 0 && maxScrollLeft > 1;

  // The thumb's position is a share of a scrollable width that just changed —
  // a resize, a different trip, the day count moving — so it is re-read once
  // the new layout is in place. Scroll-time updates go through the listener.
  useLayoutEffect(() => {
    syncScrollbarFromScroll();
    publishVisibleRange();
  }, [isScrollable, maxScrollLeft, publishVisibleRange, syncScrollbarFromScroll]);

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
    if (!el || dayCount < 1 || viewportWidth <= 0) {
      return;
    }

    // Centring follows the now-marker when there is one: at fifteen minutes a
    // column, landing on the right *day* still leaves the reader a screen away
    // from the present moment.
    const centreColumnIndex =
      nowCanvasX !== undefined ? Math.floor(nowCanvasX / Math.max(1, cellWidthPx)) : todayColumnIndex;
    if (centreColumnIndex === undefined) {
      return;
    }

    const centreFor = `${centreColumnIndex}|${dayCount}|${viewportWidth}|${recenterToken ?? 0}`;
    if (centredForRef.current === centreFor) {
      return;
    }
    centredForRef.current = centreFor;

    el.scrollLeft = computeTimelineScrollLeftToCenterDay({
      scrollContainerClientWidth: el.clientWidth,
      scrollContainerScrollWidth: el.scrollWidth,
      labelColumnWidth,
      columnIndex: centreColumnIndex,
      cellWidthPx,
    });
    publishVisibleRange();
  }, [
    todayColumnIndex,
    nowCanvasX,
    labelColumnWidth,
    cellWidthPx,
    dayCount,
    viewportWidth,
    canvasWidth,
    recenterToken,
    publishVisibleRange,
  ]);

  // The marker is positioned by a DOM write for the same reason the fold is:
  // it moves every half minute and on every layout change, and none of the rows
  // below it need to re-render when it does.
  useLayoutEffect(() => {
    const marker = nowMarkerRef.current;
    if (!marker) {
      return;
    }
    if (nowCanvasX === undefined) {
      marker.hidden = true;
      return;
    }
    marker.hidden = false;
    marker.style.left = `${labelColumnWidth + nowCanvasX}px`;
  }, [labelColumnWidth, nowCanvasX]);

  return (
    <div role="region" aria-label={ariaLabel} className="w-full min-w-0 border rounded-lg overflow-hidden">
      {toolbar !== undefined && (
        <div className="flex flex-wrap items-center gap-2 border-b border-muted bg-background px-3 py-2">
          {toolbar}
        </div>
      )}
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
        className={cn(
          'w-full min-w-0',
          'overflow-x-auto',
          // No native scrollbar: this surface already has one of its own under
          // it, and on a desktop browser that draws a permanent gutter the two
          // sat one above the other, both scrolling the same axis. The element
          // still scrolls by wheel, trackpad, touch and keyboard — only the
          // drawn bar is gone.
          '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
        )}
        data-labels-collapsed={labelsCollapsed ? 'true' : 'false'}
      >
        <div className="relative" style={{ width: labelColumnWidth + canvasWidth }}>
          {/*
            One line through the whole stack of rows at the present moment.

            It is the only mark on the timeline that answers "where are we right
            now" at a glance, and it has to cross the rows rather than sit in
            the header, so it lives here — above the rows in z-order, below the
            sticky header, and never a click target.
          */}
          <div
            ref={nowMarkerRef}
            hidden
            aria-hidden="true"
            data-testid="timeline-now-marker"
            title={nowLabel}
            className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary"
          >
            <span className="absolute -left-[3px] top-0 size-[7px] rounded-full bg-primary" />
          </div>

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
                {columns.map((column, index) => {
                  // Column starts are local instants (see `lib/utils/trip-days`
                  // and `lib/utils/timeline-scale`), so the label a column
                  // prints and the key the "today" highlight matches on are the
                  // same calendar day in every timezone.
                  const key = column.dayKey ?? (toLocalISODateString(column.start) as ISODateString);
                  const isToday = todayColumnIndex === index;
                  const isOutsideTrip =
                    tripRange !== undefined &&
                    column.dayKey !== undefined &&
                    (column.dayKey < tripRange.startKey || column.dayKey > tripRange.endKey);
                  return (
                    <div
                      key={column.key}
                      className={cn(
                        'min-w-0 border-r border-muted px-1 py-2 text-xs text-muted-foreground',
                        // Weekends read as a darker band than the weekdays
                        // either side of them, which is what lets a reader find
                        // "the Saturday" without counting columns. Outside-trip
                        // shading is stronger and wins where they overlap.
                        column.isWeekend && 'bg-muted/35',
                        isOutsideTrip && 'bg-muted/60',
                        isToday && 'bg-primary/12 text-foreground',
                      )}
                      data-outside-trip={isOutsideTrip ? 'true' : undefined}
                      data-weekend={column.isWeekend ? 'true' : undefined}
                      title={
                        isOutsideTrip && outsideTripLabel
                          ? `${column.title} — ${outsideTripLabel}`
                          : column.title
                      }
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
                          {column.topLabel || ' '}
                        </div>
                        <div
                          className={cn(
                            'font-medium tabular-nums truncate',
                            isToday ? 'text-foreground font-semibold' : 'text-foreground',
                          )}
                        >
                          {column.bottomLabel}
                        </div>
                        {isOutsideTrip && outsideTripLabel ? (
                          <span className="sr-only">{outsideTripLabel}</span>
                        ) : null}
                        {column.dayKey !== undefined ? renderDayMeta?.(key, index) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <TimelineScrollContext.Provider value={scrollApi}>
            {children(viewport)}
          </TimelineScrollContext.Provider>
        </div>
      </div>

      {/*
        A scrollbar of our own, under the timeline.

        The pills inside the rows are drag targets (dnd-kit), so on a phone a
        horizontal swipe that starts on one is a drag and not a pan: the
        timeline barely scrolls. A native scrollbar is no answer either — iOS
        and Android draw none, and a mouse user gets a 15px overlay strip at
        the bottom edge of a surface that is as tall as the trip has rows.

        It is a range input on purpose. That is a slider the browser already
        drives with touch, mouse, arrow keys, Home and End, and already reports
        to assistive tech as one, with a value the reader can make sense of
        because it is a percentage rather than a pixel offset. It renders only
        while the axis actually overflows, so a short trip that fits on screen
        gains no furniture.
      */}
      {isScrollable && (
        <div className="flex items-center border-t border-muted bg-background px-3 py-1">
          <input
            ref={scrollbarRef}
            type="range"
            min={0}
            max={TIMELINE_SCROLLBAR_STEPS}
            step={1}
            defaultValue={0}
            aria-label={scrollbarLabel ?? ariaLabel}
            data-testid="timeline-scrollbar"
            onChange={handleScrollbarChange}
            className={cn(
              // Slimmer than a native scrollbar rather than taller than one:
              // this strip runs the whole width of a timeline that is already
              // dense, and the thumb only has to be grabbable, not prominent.
              // The control keeps a 24px-tall transparent hit area so the
              // touch target stays a finger wide while the ink stays thin.
              'h-6 w-full cursor-grab appearance-none bg-transparent',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-full',
              // The track and the thumb have to be styled per engine: each
              // vendor pseudo-element is dropped by any engine that does not
              // know it, so a shared selector list would style nothing.
              '[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted',
              '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-8 [&::-webkit-slider-thumb]:-mt-[3px] [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-muted-foreground/70',
              '[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted',
              '[&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-8 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-muted-foreground/70',
            )}
          />
        </div>
      )}
    </div>
  );
});

export { TripTimelineFrame };
