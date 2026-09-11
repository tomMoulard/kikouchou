/**
 * @fileoverview Shared shell for horizontal trip timelines (calendar guests + room occupancy).
 * Provides sticky header, responsive day columns, and viewport metrics for row content.
 *
 * @module components/shared/TripTimelineFrame
 */

import {
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  memo,
  useCallback,
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

/**
 * The scrollbar control reports the scroll offset as a whole percentage.
 *
 * Percent rather than pixels because the value is read out to assistive tech
 * and stepped by the arrow keys: "40" means something to both, a pixel offset
 * into a canvas means nothing to either.
 */
const TIMELINE_SCROLLBAR_STEPS = 100;

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
  /**
   * Translated label for the scrollbar control under the timeline
   * (`common.scrollTimeline`). Falls back to `ariaLabel`, which names the
   * timeline rather than the control, so pass it.
   */
  readonly scrollbarLabel?: string;
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
  tripRange,
  outsideTripLabel,
  scrollbarLabel,
  renderDayMeta,
  children,
}: TripTimelineFrameProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLInputElement>(null);
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
    };

    el.addEventListener('scroll', syncFoldFromScroll, { passive: true });
    syncFoldFromScroll();
    return () => {
      el.removeEventListener('scroll', syncFoldFromScroll);
    };
  }, [labelColumnWidth, syncScrollbarFromScroll]);

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
  }, [isScrollable, maxScrollLeft, syncScrollbarFromScroll]);

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
                  const isOutsideTrip =
                    tripRange !== undefined &&
                    (key < tripRange.startKey || key > tripRange.endKey);
                  return (
                    <div
                      key={`timeline-day-${index}-${key}`}
                      className={cn(
                        'min-w-0 border-r border-muted px-1 py-2 text-xs text-muted-foreground',
                        isOutsideTrip && 'bg-muted/60',
                        isToday && 'bg-primary/12 text-foreground',
                      )}
                      data-outside-trip={isOutsideTrip ? 'true' : undefined}
                      title={
                        isOutsideTrip && outsideTripLabel
                          ? `${format(day, 'PPPP', { locale: dateLocale })} — ${outsideTripLabel}`
                          : format(day, 'PPPP', { locale: dateLocale })
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
                        {isOutsideTrip && outsideTripLabel ? (
                          <span className="sr-only">{outsideTripLabel}</span>
                        ) : null}
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
        <div className="flex items-center border-t border-muted bg-background px-3 py-2">
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
              'h-6 w-full cursor-grab appearance-none bg-transparent',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-full',
              // The track and the thumb have to be styled per engine: each
              // vendor pseudo-element is dropped by any engine that does not
              // know it, so a shared selector list would style nothing.
              '[&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-muted',
              '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-12 [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-muted-foreground/70',
              '[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-muted',
              '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-12 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-muted-foreground/70',
            )}
          />
        </div>
      )}
    </div>
  );
});

export { TripTimelineFrame };
