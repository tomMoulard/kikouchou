/**
 * @fileoverview Two arrows that say a row's pills are off to one side, and take
 * the reader to them.
 *
 * A row whose whole stay has been scrolled past looks like a row with nothing
 * booked, and the reader has no way to tell the two apart. These arrows are the
 * difference: one appears at the edge of the visible axis, pointing the way the
 * pill went.
 *
 * @module components/shared/TimelineOffscreenArrows
 */

import { type ReactElement, memo, useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useTimelineScroll } from './timeline-scroll-context';

// ============================================================================
// Constants
// ============================================================================

/** Width and height of an indicator arrow, in pixels. */
const OFFSCREEN_ARROW_SIZE_PX = 20;

/** Gap between an arrow and the edge of the visible axis. */
const OFFSCREEN_ARROW_INSET_PX = 2;

// ============================================================================
// Types
// ============================================================================

/** Where one pill sits on the canvas, in pixels from the first column's edge. */
export interface TimelinePillBounds {
  readonly left: number;
  readonly right: number;
  /** Where to scroll to bring the pill into the middle of the viewport. */
  readonly centre: number;
}

export interface TimelineOffscreenArrowsProps {
  /** Every pill drawn in this row. Memoize it: the effect below depends on it. */
  readonly bounds: readonly TimelinePillBounds[];
  /** Translated name for the left arrow, naming the row's subject. */
  readonly leftLabel: string;
  /** Translated name for the right arrow. */
  readonly rightLabel: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Renders the two off-screen indicators for one timeline row.
 *
 * Place it inside the row's canvas, which must be `position: relative` — the
 * arrows position themselves in canvas coordinates.
 *
 * Both are positioned by a DOM write rather than by React state, because the
 * answer changes on every scroll frame and re-rendering every row of the
 * timeline that often would cost the smoothness the frame is built around. The
 * frame publishes its visible range; each row writes its own two arrows.
 *
 * @param props - The row's pill bounds and the two translated labels
 * @returns The pair of arrows, hidden until a pill is actually off screen
 *
 * @example
 * ```tsx
 * <TimelineOffscreenArrows bounds={pillBounds} leftLabel={back} rightLabel={forward} />
 * ```
 */
const TimelineOffscreenArrows = memo(function TimelineOffscreenArrows({
  bounds,
  leftLabel,
  rightLabel,
}: TimelineOffscreenArrowsProps): ReactElement | null {
  const leftRef = useRef<HTMLButtonElement>(null);
  const rightRef = useRef<HTMLButtonElement>(null);
  /** Canvas x of the nearest hidden pill on each side, for the arrow's click. */
  const targetsRef = useRef<{ left?: number; right?: number }>({});
  const { subscribeVisibleRange, scrollCanvasPositionIntoView } = useTimelineScroll();

  useEffect(
    () =>
      subscribeVisibleRange((range) => {
        let leftTarget: number | undefined;
        let rightTarget: number | undefined;

        for (const bound of bounds) {
          if (bound.right <= range.start) {
            // Nearest hidden pill, so the arrow takes the reader one stay back
            // rather than all the way to the start of the trip.
            leftTarget =
              leftTarget === undefined ? bound.centre : Math.max(leftTarget, bound.centre);
          } else if (bound.left >= range.end) {
            rightTarget =
              rightTarget === undefined ? bound.centre : Math.min(rightTarget, bound.centre);
          }
        }

        targetsRef.current = { left: leftTarget, right: rightTarget };

        const leftArrow = leftRef.current;
        if (leftArrow) {
          leftArrow.hidden = leftTarget === undefined;
          leftArrow.style.left = `${range.start + OFFSCREEN_ARROW_INSET_PX}px`;
        }

        const rightArrow = rightRef.current;
        if (rightArrow) {
          rightArrow.hidden = rightTarget === undefined;
          rightArrow.style.left = `${range.end - OFFSCREEN_ARROW_SIZE_PX - OFFSCREEN_ARROW_INSET_PX}px`;
        }
      }),
    [bounds, subscribeVisibleRange],
  );

  const handleLeft = useCallback(() => {
    const target = targetsRef.current.left;
    if (target !== undefined) {
      scrollCanvasPositionIntoView(target);
    }
  }, [scrollCanvasPositionIntoView]);

  const handleRight = useCallback(() => {
    const target = targetsRef.current.right;
    if (target !== undefined) {
      scrollCanvasPositionIntoView(target);
    }
  }, [scrollCanvasPositionIntoView]);

  // A row with no pills can never have one off screen, and there are a great
  // many such rows: every room nobody is booked into, every guest with nothing
  // arranged yet. Two hidden buttons and a scroll subscription each is real
  // money on a house with twenty rooms — it measured 700ms of layout on the
  // room board alone — for an indicator that could never fire.
  if (bounds.length === 0) {
    return null;
  }

  const arrowClassName = cn(
    'absolute top-1/2 z-[3] -translate-y-1/2 rounded-full border bg-background/90 shadow-sm',
    'flex items-center justify-center text-muted-foreground hover:text-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  );
  const arrowStyle = { width: OFFSCREEN_ARROW_SIZE_PX, height: OFFSCREEN_ARROW_SIZE_PX };

  return (
    <>
      <button
        ref={leftRef}
        hidden
        type="button"
        onClick={handleLeft}
        data-testid="timeline-offscreen-left"
        className={arrowClassName}
        style={arrowStyle}
        title={leftLabel}
        aria-label={leftLabel}
      >
        <ChevronLeft className="size-3.5" aria-hidden="true" />
      </button>

      <button
        ref={rightRef}
        hidden
        type="button"
        onClick={handleRight}
        data-testid="timeline-offscreen-right"
        className={arrowClassName}
        style={arrowStyle}
        title={rightLabel}
        aria-label={rightLabel}
      >
        <ChevronRight className="size-3.5" aria-hidden="true" />
      </button>
    </>
  );
});

export { TimelineOffscreenArrows };
