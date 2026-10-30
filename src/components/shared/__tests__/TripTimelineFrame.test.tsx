/**
 * @fileoverview Tests for TripTimelineFrame shared component.
 * @module components/shared/__tests__/TripTimelineFrame.test
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { useEffect, useLayoutEffect } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { addDays, format } from 'date-fns';
import { TripTimelineFrame, type TripTimelineViewportContext } from '../TripTimelineFrame';
import {
  type TimelineScrollApi,
  type TimelineVisibleRange,
  useTimelineScroll,
} from '../timeline-scroll-context';
import { computeTimelineScrollLeftToCenterDay } from '@/lib/utils/timeline-viewport-layout';
import { toDayKeys } from '@/lib/utils/trip-days';
import type { ISODateString } from '@/types';
import { enUS } from 'date-fns/locale';

// Mock i18next (not used directly, but some children may need it)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

// ============================================================================
// Helpers
// ============================================================================

/**
 * Day columns exactly as production supplies them: LOCAL midnights, with keys
 * from the same converter (`lib/utils/trip-days`). Building them from a UTC
 * instant instead — `new Date('2026-01-05')`, `.toISOString().slice(0, 10)` —
 * makes the fixture mean a different calendar day depending on the machine's
 * offset, which is the very confusion this frame used to work around.
 */
function makeDays(count: number, startDate = '2026-01-05'): Date[] {
  const [year, month, day] = startDate.split('-').map(Number) as [number, number, number];
  const start = new Date(year, month - 1, day);
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

function makeDayKeys(count: number, startDate = '2026-01-05'): ISODateString[] {
  return [...toDayKeys(makeDays(count, startDate))];
}

/**
 * jsdom lays nothing out, so every element measures zero. The frame decides
 * whether its day axis overflows from the width it was given, which is
 * `clientWidth` on the scroll surface — stub it to put the component in the
 * narrow-viewport case a phone is actually in.
 */
function stubMeasurements(measurements: {
  readonly clientWidth: number;
  readonly scrollWidth?: number;
}): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(
    measurements.clientWidth,
  );
  if (measurements.scrollWidth !== undefined) {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(
      measurements.scrollWidth,
    );
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('TripTimelineFrame', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultProps = {
    ariaLabel: 'Test timeline',
    labelColumnWidth: 150,
    leftHeader: <span>Guests</span>,
    days: makeDays(5),
    dayKeys: makeDayKeys(5),
    dateLocale: enUS,
  };

  it('renders with correct aria-label region', () => {
    render(
      <TripTimelineFrame {...defaultProps}>
        {() => <div>content</div>}
      </TripTimelineFrame>
    );
    expect(screen.getByRole('region', { name: 'Test timeline' })).toBeInTheDocument();
  });

  it('scrolls days sideways without capping the row height', () => {
    // A vertical cap here nests a second scrollbar inside the page's, and the
    // rows — the thing being counted — are what gets cut off.
    const { container } = render(
      <TripTimelineFrame {...defaultProps}>
        {() => <div>content</div>}
      </TripTimelineFrame>
    );

    const scrollSurface = container.querySelector('[tabindex="0"]');
    expect(scrollSurface).toHaveClass('overflow-x-auto');
    expect(scrollSurface?.className).not.toMatch(/overflow-y-auto|max-h-/);
  });

  it('renders left header content', () => {
    render(
      <TripTimelineFrame {...defaultProps}>
        {() => <div>content</div>}
      </TripTimelineFrame>
    );
    expect(screen.getByText('Guests')).toBeInTheDocument();
  });

  it('renders day columns with date labels', () => {
    render(
      <TripTimelineFrame {...defaultProps}>
        {() => <div>content</div>}
      </TripTimelineFrame>
    );
    // Should render day numbers (05, 06, 07, 08, 09)
    expect(screen.getByText('05')).toBeInTheDocument();
    expect(screen.getByText('06')).toBeInTheDocument();
    expect(screen.getByText('07')).toBeInTheDocument();
  });

  it('labels every column with the day its key names', () => {
    // The header prints the column Date with date-fns (local components) but
    // highlights and looks up by `dayKeys`. If the two disagree — as they did
    // while columns were stepped in UTC — a guest reads a stay off the wrong day.
    const days = makeDays(5);
    const dayKeys = makeDayKeys(5);

    render(
      <TripTimelineFrame {...defaultProps} days={days} dayKeys={dayKeys}>
        {() => <div>content</div>}
      </TripTimelineFrame>
    );

    for (const [index, key] of dayKeys.entries()) {
      // The column the frame drew for this Date, found by the full date it
      // printed, has to show the day number the matching key names.
      const column = screen.getByTitle(format(days[index]!, 'PPPP', { locale: enUS }));
      expect(column).toHaveTextContent(key.slice(8, 10));
    }
  });

  it('renders month abbreviations', () => {
    render(
      <TripTimelineFrame {...defaultProps}>
        {() => <div>content</div>}
      </TripTimelineFrame>
    );
    // January days should show "Jan"
    const janLabels = screen.getAllByText('Jan');
    expect(janLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('calls children render prop with viewport context', () => {
    const childrenFn = vi.fn(() => <div>rendered</div>);

    render(
      <TripTimelineFrame {...defaultProps}>
        {childrenFn}
      </TripTimelineFrame>
    );

    expect(childrenFn).toHaveBeenCalledTimes(1);
    const viewport = (childrenFn.mock.calls[0] as unknown[])[0];
    expect(viewport).toHaveProperty('labelColumnWidth', 150);
    expect(viewport).toHaveProperty('dayCount', 5);
    expect(viewport).toHaveProperty('laneHeightPx');
    expect(viewport).toHaveProperty('canvasWidth');
    expect(viewport).toHaveProperty('cellWidthPx');
  });

  it('highlights today column when todayKey is provided', () => {
    const todayKey = makeDayKeys(5)[2]!; // 3rd day

    render(
      <TripTimelineFrame {...defaultProps} todayKey={todayKey}>
        {() => <div>content</div>}
      </TripTimelineFrame>
    );

    // Should have aria-current="date" on today column
    const todayEl = screen.getByText('07').closest('[aria-current="date"]');
    expect(todayEl).toBeInTheDocument();
  });

  it('does not highlight any column when todayKey is not in range', () => {
    render(
      <TripTimelineFrame {...defaultProps} todayKey={'2099-12-31' as ISODateString}>
        {() => <div>content</div>}
      </TripTimelineFrame>
    );

    // No element should have aria-current
    const allDayHeaders = screen.getAllByText(/\d{2}/);
    const todayElements = allDayHeaders.filter(
      (el) => el.closest('[aria-current]') !== null
    );
    expect(todayElements).toHaveLength(0);
  });

  it('renders children output', () => {
    render(
      <TripTimelineFrame {...defaultProps}>
        {() => <div data-testid="child-content">Hello from children</div>}
      </TripTimelineFrame>
    );
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByText('Hello from children')).toBeInTheDocument();
  });

  it('provides todayColumnIndex in viewport when todayKey matches', () => {
    const todayKey = makeDayKeys(5)[1]!; // second day = index 1
    const childrenFn = vi.fn(() => <div>test</div>);

    render(
      <TripTimelineFrame {...defaultProps} todayKey={todayKey}>
        {childrenFn}
      </TripTimelineFrame>
    );

    const viewport = (childrenFn.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(viewport.todayColumnIndex).toBe(1);
  });

  it('provides undefined todayColumnIndex when todayKey is not on the axis', () => {
    const childrenFn = vi.fn(() => <div>test</div>);

    render(
      <TripTimelineFrame {...defaultProps} todayKey={'2099-12-31' as ISODateString}>
        {childrenFn}
      </TripTimelineFrame>
    );

    const viewport = (childrenFn.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(viewport.todayColumnIndex).toBeUndefined();
  });

  it('provides undefined todayColumnIndex when no todayKey', () => {
    const childrenFn = vi.fn(() => <div>test</div>);

    render(
      <TripTimelineFrame {...defaultProps}>
        {childrenFn}
      </TripTimelineFrame>
    );

    const viewport = (childrenFn.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(viewport.todayColumnIndex).toBeUndefined();
  });

  it('marks the columns outside the trip when the axis runs past it', () => {
    // The axis now covers every event the timeline draws, so it can start
    // before the trip does. A reader has to be able to see which columns are
    // the trip itself.
    const dayKeys = makeDayKeys(5);

    render(
      <TripTimelineFrame
        {...defaultProps}
        tripRange={{ startKey: dayKeys[1]!, endKey: dayKeys[3]! }}
        outsideTripLabel="Outside the trip dates"
      >
        {() => <div>content</div>}
      </TripTimelineFrame>
    );

    const outside = screen.getAllByText('Outside the trip dates');
    expect(outside).toHaveLength(2);
    expect(screen.getByText('05').closest('[data-outside-trip="true"]')).toBeInTheDocument();
    expect(screen.getByText('09').closest('[data-outside-trip="true"]')).toBeInTheDocument();
    expect(screen.getByText('07').closest('[data-outside-trip="true"]')).toBeNull();
  });

  it('marks no column when no trip range is given', () => {
    const { container } = render(
      <TripTimelineFrame {...defaultProps}>
        {() => <div>content</div>}
      </TripTimelineFrame>
    );

    expect(container.querySelectorAll('[data-outside-trip]')).toHaveLength(0);
  });

  it('offers no scrollbar while the whole trip fits on screen', () => {
    // Nothing to scroll, so the control would be furniture — and a disabled or
    // full-width thumb reads as "there is more here" when there is not.
    stubMeasurements({ clientWidth: 2000 });

    render(
      <TripTimelineFrame {...defaultProps}>
        {() => <div>content</div>}
      </TripTimelineFrame>
    );

    expect(screen.queryByTestId('timeline-scrollbar')).toBeNull();
  });

  it('offers no scrollbar for a single pixel of overhang', () => {
    // A scale that asks for 20px columns is never compressed below 20px, so a
    // viewport one pixel short of one column overflows by exactly that pixel.
    // The 150px label column plus 19px leaves 19px for the 20px column.
    stubMeasurements({ clientWidth: 169 });

    const frame = (
      <TripTimelineFrame {...defaultProps} days={makeDays(1)} dayKeys={makeDayKeys(1)} preferredColumnWidthPx={20}>
        {() => <div>content</div>}
      </TripTimelineFrame>
    );
    const { unmount } = render(frame);
    expect(screen.queryByTestId('timeline-scrollbar')).toBeNull();
    unmount();

    // Two pixels short is a real overflow, and gets the control.
    stubMeasurements({ clientWidth: 168 });
    render(frame);
    expect(screen.getByTestId('timeline-scrollbar')).toBeInTheDocument();
  });

  it('offers a labelled scrollbar once the day axis overflows', () => {
    // A month-long trip on a phone: the pills are drag targets, so a swipe
    // across them is a drag and the reader needs something else to pan with.
    stubMeasurements({ clientWidth: 320 });

    render(
      <TripTimelineFrame {...defaultProps} days={makeDays(40)} dayKeys={makeDayKeys(40)} scrollbarLabel="Scroll the timeline">
        {() => <div>content</div>}
      </TripTimelineFrame>
    );

    const scrollbar = screen.getByTestId('timeline-scrollbar');
    expect(scrollbar).toHaveAttribute('type', 'range');
    expect(screen.getByRole('slider', { name: 'Scroll the timeline' })).toBe(scrollbar);
  });

  it('follows the day axis when the reader scrolls it', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });

    const { container } = render(
      <TripTimelineFrame {...defaultProps} days={makeDays(40)} dayKeys={makeDayKeys(40)}>
        {() => <div>content</div>}
      </TripTimelineFrame>
    );

    const scrollSurface = container.querySelector('[tabindex="0"]') as HTMLElement;
    const scrollbar = screen.getByTestId('timeline-scrollbar') as HTMLInputElement;

    expect(scrollbar.value).toBe('0');

    scrollSurface.scrollLeft = (1920 - 320) / 2;
    fireEvent.scroll(scrollSurface);

    expect(scrollbar.value).toBe('50');
  });

  it('scrolls the day axis when the reader moves it', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });

    const { container } = render(
      <TripTimelineFrame {...defaultProps} days={makeDays(40)} dayKeys={makeDayKeys(40)}>
        {() => <div>content</div>}
      </TripTimelineFrame>
    );

    const scrollSurface = container.querySelector('[tabindex="0"]') as HTMLElement;
    const scrollbar = screen.getByTestId('timeline-scrollbar') as HTMLInputElement;

    fireEvent.change(scrollbar, { target: { value: '100' } });

    expect(scrollSurface.scrollLeft).toBe(1920 - 320);
  });

  it('handles zero days gracefully', () => {
    const childrenFn = vi.fn(() => <div>empty timeline</div>);

    render(
      <TripTimelineFrame
        {...defaultProps}
        days={[]}
        dayKeys={[]}
      >
        {childrenFn}
      </TripTimelineFrame>
    );

    expect(screen.getByText('empty timeline')).toBeInTheDocument();
    const viewport = (childrenFn.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(viewport.dayCount).toBe(0);
  });

  // One line through the stack of rows at the present moment: the only mark on
  // the timeline that answers "where are we right now" at a glance.
  describe('the now-marker', () => {
    it('draws no marker without a current instant', () => {
      render(<TripTimelineFrame {...defaultProps}>{() => null}</TripTimelineFrame>);

      expect(screen.getByTestId('timeline-now-marker').hidden).toBe(true);
    });

    it('draws the marker when now falls on the axis', () => {
      stubMeasurements({ clientWidth: 640 });

      render(
        <TripTimelineFrame {...defaultProps} now={new Date(2026, 0, 7, 12, 0)}>
          {() => null}
        </TripTimelineFrame>,
      );

      const marker = screen.getByTestId('timeline-now-marker');
      expect(marker.hidden).toBe(false);
      expect(marker.style.left).not.toBe('');
    });

    it('hides the marker when now is nowhere near the trip', () => {
      stubMeasurements({ clientWidth: 640 });

      render(
        <TripTimelineFrame {...defaultProps} now={new Date(2030, 0, 7, 12, 0)}>
          {() => null}
        </TripTimelineFrame>,
      );

      expect(screen.getByTestId('timeline-now-marker').hidden).toBe(true);
    });
  });

  // Weekends read as a darker band, so a reader finds "the Saturday" without
  // counting columns.
  it('marks the weekend columns in the header', () => {
    // Monday 5 January 2026 to the following Sunday: one Saturday, one Sunday.
    const { container } = render(
      <TripTimelineFrame {...defaultProps} days={makeDays(7)} dayKeys={makeDayKeys(7)}>
        {() => null}
      </TripTimelineFrame>,
    );

    expect(container.querySelectorAll('[data-weekend="true"]')).toHaveLength(2);
  });
});

// ============================================================================
// Clock, centring, scrolling and the visible range
// ============================================================================

describe('TripTimelineFrame behaviour over time and scroll', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const baseProps = {
    ariaLabel: 'Test timeline',
    labelColumnWidth: 150,
    leftHeader: <span>Guests</span>,
    dateLocale: enUS,
  };

  /** Renders a frame and hands back the viewport its rows were given. */
  function renderFrame(
    props: Partial<React.ComponentProps<typeof TripTimelineFrame>> & { readonly dayCount?: number } = {},
  ) {
    const { dayCount = 40, ...rest } = props;
    let viewport: TripTimelineViewportContext | undefined;
    const utils = render(
      <TripTimelineFrame {...baseProps} days={makeDays(dayCount)} dayKeys={makeDayKeys(dayCount)} {...rest}>
        {(next) => {
          viewport = next;
          return null;
        }}
      </TripTimelineFrame>,
    );
    const surface = utils.container.querySelector('[tabindex="0"]') as HTMLElement;
    return { ...utils, surface, viewport: () => viewport as TripTimelineViewportContext };
  }

  it('moves the now-marker on with the clock, and never back behind the given instant', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    stubMeasurements({ clientWidth: 640 });
    const now = new Date(2026, 0, 7, 12, 0);
    vi.setSystemTime(new Date(2026, 0, 7, 18, 0));

    const { viewport } = renderFrame({ dayCount: 5, now });
    const marker = screen.getByTestId('timeline-now-marker');
    const cell = viewport().cellWidthPx;
    expect(parseFloat(marker.style.left)).toBeCloseTo(150 + 2.5 * cell, 3);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    // Six hours and thirty seconds past noon, in the third column.
    expect(parseFloat(marker.style.left)).toBeCloseTo(150 + (2 + (18 * 60 + 0.5) / (24 * 60)) * cell, 3);
  });

  it('keeps the marker on the given instant when the clock is behind it', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    stubMeasurements({ clientWidth: 640 });
    vi.setSystemTime(new Date(2026, 0, 6, 8, 0));

    const { viewport } = renderFrame({ dayCount: 5, now: new Date(2026, 0, 7, 12, 0) });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(parseFloat(screen.getByTestId('timeline-now-marker').style.left)).toBeCloseTo(
      150 + 2.5 * viewport().cellWidthPx,
      3,
    );
  });

  it('starts the marker clock when a current instant arrives after mount', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    stubMeasurements({ clientWidth: 640 });
    vi.setSystemTime(new Date(2026, 0, 7, 18, 0));

    const { rerender, viewport } = renderFrame({ dayCount: 5 });
    const now = new Date(2026, 0, 7, 12, 0);
    rerender(
      <TripTimelineFrame {...baseProps} days={makeDays(5)} dayKeys={makeDayKeys(5)} now={now}>
        {() => null}
      </TripTimelineFrame>,
    );
    const marker = screen.getByTestId('timeline-now-marker');
    expect(parseFloat(marker.style.left)).toBeCloseTo(150 + 2.5 * viewport().cellWidthPx, 3);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(parseFloat(marker.style.left)).toBeCloseTo(
      150 + (2 + (18 * 60 + 0.5) / (24 * 60)) * viewport().cellWidthPx,
      3,
    );
  });

  it('runs the marker clock only with a marker, and stops it when gone', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const first = renderFrame({ dayCount: 5 });
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 30_000);
    first.unmount();

    const { unmount } = renderFrame({ dayCount: 5, now: new Date(2026, 0, 7, 12, 0) });
    const index = setIntervalSpy.mock.calls.findIndex(([, delay]) => delay === 30_000);
    expect(index).toBeGreaterThanOrEqual(0);
    const id: unknown = setIntervalSpy.mock.results[index]?.value;
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(id);
  });

  it('names the marker and keeps it out of the way of the pointer', () => {
    renderFrame({ dayCount: 5, nowLabel: 'Now' });

    const marker = screen.getByTestId('timeline-now-marker');
    expect(marker).toHaveAttribute('title', 'Now');
    expect(marker).toHaveAttribute('aria-hidden', 'true');
    expect(marker).toHaveClass('pointer-events-none', 'absolute', 'inset-y-0', 'z-10', 'w-px', 'bg-primary');
  });

  it('centres the axis on the present moment when there is one', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });

    const { surface, viewport } = renderFrame({
      now: new Date(2026, 0, 25, 12, 0),
      todayKey: makeDayKeys(40)[3],
    });

    expect(surface.scrollLeft).toBe(
      computeTimelineScrollLeftToCenterDay({
        scrollContainerClientWidth: 320,
        scrollContainerScrollWidth: 1920,
        labelColumnWidth: 150,
        columnIndex: 20,
        cellWidthPx: viewport().cellWidthPx,
      }),
    );
    expect(surface.scrollLeft).toBeGreaterThan(0);
  });

  it('centres the axis on today when there is no present moment, and only once', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });

    const { surface, viewport, rerender } = renderFrame({ todayKey: makeDayKeys(40)[20] });
    const centred = computeTimelineScrollLeftToCenterDay({
      scrollContainerClientWidth: 320,
      scrollContainerScrollWidth: 1920,
      labelColumnWidth: 150,
      columnIndex: 20,
      cellWidthPx: viewport().cellWidthPx,
    });
    expect(surface.scrollLeft).toBe(centred);

    // The reader scrolls away; a re-render for an unrelated reason leaves them there.
    surface.scrollLeft = 7;
    rerender(
      <TripTimelineFrame
        {...baseProps}
        labelColumnWidth={160}
        days={makeDays(40)}
        dayKeys={makeDayKeys(40)}
        todayKey={makeDayKeys(40)[20]}
      >
        {() => null}
      </TripTimelineFrame>,
    );
    expect(surface.scrollLeft).toBe(7);
  });

  it('leaves the axis at the start when there is nothing to centre on', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });

    const { surface } = renderFrame();

    expect(surface.scrollLeft).toBe(0);
  });

  it('sits the scrollbar thumb at the start when the surface has no slack to measure', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 320 });

    const { surface } = renderFrame();
    fireEvent.scroll(surface);

    expect((screen.getByTestId('timeline-scrollbar') as HTMLInputElement).value).toBe('0');
  });

  it('draws the scrollbar as a slim range with a wide grab area', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });

    renderFrame({ ariaLabel: 'Trip' });
    const bar = screen.getByTestId('timeline-scrollbar');

    expect(bar).toHaveAttribute('aria-label', 'Trip');
    expect(bar).toHaveAttribute('min', '0');
    expect(bar).toHaveAttribute('max', '100');
    expect(bar).toHaveAttribute('step', '1');
    expect(bar).toHaveClass(
      'h-6', 'w-full', 'cursor-grab', 'appearance-none', 'bg-transparent',
      'focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-ring', 'focus-visible:rounded-full',
      '[&::-webkit-slider-runnable-track]:h-1', '[&::-webkit-slider-thumb]:w-8',
      '[&::-moz-range-track]:bg-muted', '[&::-moz-range-thumb]:border-0',
    );
    expect(bar.parentElement).toHaveClass('flex', 'items-center', 'border-t', 'border-muted', 'bg-background', 'px-3', 'py-1');
  });

  it('folds the label column as the axis scrolls, and hides the header label once folded', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });

    const { surface } = renderFrame();
    expect(surface).toHaveAttribute('data-labels-collapsed', 'false');
    expect(surface.style.getPropertyValue('--timeline-label-expanded')).toBe('150px');
    expect(surface.style.getPropertyValue('--timeline-label-width')).toBe('150px');
    expect(screen.getByText('Guests').parentElement).not.toHaveClass('sr-only');

    surface.scrollLeft = 500;
    fireEvent.scroll(surface);

    expect(surface.style.getPropertyValue('--timeline-label-width')).toBe('40px');
    expect(surface).toHaveAttribute('data-labels-collapsed', 'true');
    expect(screen.getByText('Guests').parentElement).toHaveClass('sr-only');
  });

  it('tells a row which part of the axis is on screen, and scrolls a canvas position into the middle', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });
    const ranges: TimelineVisibleRange[] = [];
    const probe: { api?: TimelineScrollApi } = {};
    let unsubscribe: (() => void) | undefined;

    function Probe(): null {
      const scroll = useTimelineScroll();
      useEffect(() => {
        probe.api = scroll;
      });
      return null;
    }
    const api = (): TimelineScrollApi | undefined => probe.api;

    const { container } = render(
      <TripTimelineFrame {...baseProps} days={makeDays(40)} dayKeys={makeDayKeys(40)}>
        {() => <Probe />}
      </TripTimelineFrame>,
    );
    const surface = container.querySelector('[tabindex="0"]') as HTMLElement;

    act(() => {
      unsubscribe = api()?.subscribeVisibleRange((range) => ranges.push(range));
    });
    // The current range at once, on subscribe.
    expect(ranges.at(-1)).toEqual({ start: 0, end: 170 });

    surface.scrollLeft = 500;
    fireEvent.scroll(surface);
    // The folded column covers 40px of the canvas rather than 150.
    expect(ranges.at(-1)).toEqual({ start: 390, end: 670 });

    act(() => {
      api()?.scrollCanvasPositionIntoView(800);
    });
    expect(surface.scrollLeft).toBe(150 + 800 - 160);
    act(() => {
      api()?.scrollCanvasPositionIntoView(0);
    });
    expect(surface.scrollLeft).toBe(0);
    act(() => {
      api()?.scrollCanvasPositionIntoView(5000);
    });
    expect(surface.scrollLeft).toBe(1600);

    const seen = ranges.length;
    unsubscribe?.();
    surface.scrollLeft = 100;
    fireEvent.scroll(surface);
    expect(ranges).toHaveLength(seen);
  });

  it('hands a subscriber that mounts before the first measurement an empty range, not a blank one', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });
    const ranges: TimelineVisibleRange[] = [];

    // A row's layout effect runs before the frame's own, so it subscribes
    // before anything has been published.
    function EarlySubscriber(): null {
      const { subscribeVisibleRange } = useTimelineScroll();
      useLayoutEffect(() => subscribeVisibleRange((range) => ranges.push(range)), [subscribeVisibleRange]);
      return null;
    }

    render(
      <TripTimelineFrame {...baseProps} days={makeDays(40)} dayKeys={makeDayKeys(40)}>
        {() => <EarlySubscriber />}
      </TripTimelineFrame>,
    );

    expect(ranges[0]).toEqual({ start: 0, end: 0 });
    expect(ranges.at(-1)).toEqual({ start: 0, end: 170 });
  });

  it('keeps the reader where they were when the timeline is hidden and shown again', () => {
    const callbacks: Array<() => void> = [];
    const original = window.ResizeObserver;
    window.ResizeObserver = class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe(): void {
        // The callbacks are fired by hand below.
      }
      unobserve(): void {
        // Not used by the frame.
      }
      disconnect(): void {
        // Nothing to release.
      }
    } as unknown as typeof ResizeObserver;
    try {
      const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1920);
      const { surface } = renderFrame({ todayKey: makeDayKeys(40)[20] });
      expect(surface.scrollLeft).toBeGreaterThan(0);

      surface.scrollLeft = 7;
      // A tab panel hides the timeline: the surface measures zero wide.
      width.mockReturnValue(0);
      act(() => {
        for (const callback of callbacks) callback();
      });
      width.mockReturnValue(320);
      act(() => {
        for (const callback of callbacks) callback();
      });

      expect(surface.scrollLeft).toBe(7);
    } finally {
      window.ResizeObserver = original;
    }
  });

  it('centres a one-day trip that overflows a very narrow surface', () => {
    // 160px of surface and a 150px label column leave 10px, under the 28px
    // floor, so the single 44px column overflows.
    stubMeasurements({ clientWidth: 160, scrollWidth: 194 });

    const { surface, viewport } = renderFrame({ dayCount: 1, todayKey: makeDayKeys(1)[0] });

    expect(viewport().useFractionalColumns).toBe(false);
    expect(surface.scrollLeft).toBe(
      computeTimelineScrollLeftToCenterDay({
        scrollContainerClientWidth: 160,
        scrollContainerScrollWidth: 194,
        labelColumnWidth: 150,
        columnIndex: 0,
        cellWidthPx: viewport().cellWidthPx,
      }),
    );
    expect(surface.scrollLeft).toBeGreaterThan(0);
  });

  it('follows a new label column width in the fold, the visible range and the scroll target', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });
    const ranges: TimelineVisibleRange[] = [];
    const probe: { api?: TimelineScrollApi } = {};

    function Probe(): null {
      const scroll = useTimelineScroll();
      useEffect(() => {
        probe.api = scroll;
      });
      return null;
    }
    const ui = (labelColumnWidth: number) => (
      <TripTimelineFrame {...baseProps} labelColumnWidth={labelColumnWidth} days={makeDays(40)} dayKeys={makeDayKeys(40)}>
        {() => <Probe />}
      </TripTimelineFrame>
    );

    const { container, rerender } = render(ui(150));
    const surface = container.querySelector('[tabindex="0"]') as HTMLElement;
    act(() => {
      probe.api?.subscribeVisibleRange((range) => ranges.push(range));
    });
    expect(ranges.at(-1)).toEqual({ start: 0, end: 170 });

    rerender(ui(200));

    expect(surface.style.getPropertyValue('--timeline-label-expanded')).toBe('200px');
    // 320px of surface, 200 of it under the names.
    expect(ranges.at(-1)).toEqual({ start: 0, end: 120 });
    act(() => {
      probe.api?.scrollCanvasPositionIntoView(800);
    });
    expect(surface.scrollLeft).toBe(200 + 800 - 160);
  });
});

// ============================================================================
// The header, the layout and the measurements
// ============================================================================

describe('TripTimelineFrame header and layout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseProps = {
    ariaLabel: 'Test timeline',
    labelColumnWidth: 150,
    leftHeader: <span>Guests</span>,
    dateLocale: enUS,
  };

  function frame(props: Partial<React.ComponentProps<typeof TripTimelineFrame>> = {}, dayCount = 7) {
    const seen: TripTimelineViewportContext[] = [];
    const ui = (extra: Partial<React.ComponentProps<typeof TripTimelineFrame>> = {}) => (
      <TripTimelineFrame
        {...baseProps}
        days={makeDays(dayCount)}
        dayKeys={makeDayKeys(dayCount)}
        {...props}
        {...extra}
      >
        {(viewport) => {
          seen.push(viewport);
          return null;
        }}
      </TripTimelineFrame>
    );
    const utils = render(ui());
    return { ...utils, ui, last: () => seen.at(-1) as TripTimelineViewportContext };
  }

  it('lays the frame out as a bordered region over a scroll surface with no native bar', () => {
    stubMeasurements({ clientWidth: 640 });
    const { container, last } = frame();

    expect(screen.getByRole('region', { name: 'Test timeline' })).toHaveClass(
      'w-full', 'min-w-0', 'border', 'rounded-lg', 'overflow-hidden',
    );
    const surface = container.querySelector('[tabindex="0"]') as HTMLElement;
    expect(surface).toHaveClass(
      'w-full', 'min-w-0', 'overflow-x-auto',
      '[scrollbar-width:none]', '[-ms-overflow-style:none]', '[&::-webkit-scrollbar]:hidden',
    );
    const canvas = surface.firstElementChild as HTMLElement;
    expect(canvas).toHaveClass('relative');
    expect(canvas.style.width).toBe(`${150 + last().canvasWidth}px`);

    const header = screen.getByText('Guests').closest('.sticky.top-0') as HTMLElement;
    expect(header).toHaveClass('sticky', 'top-0', 'z-20', 'flex', 'border-b', 'border-muted', 'bg-background');
    const labelCell = screen.getByText('Guests').parentElement?.parentElement as HTMLElement;
    expect(labelCell).toHaveClass('sticky', 'left-0', 'z-30', 'border-r', 'border-muted', 'bg-background', 'py-2', 'px-3');
    const dayStrip = labelCell.nextElementSibling as HTMLElement;
    expect(dayStrip).toHaveClass('relative', 'min-w-0', 'overflow-hidden');
    expect(dayStrip.style.width).toBe(`${last().canvasWidth}px`);
  });

  it('narrows the label cell padding once folded', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });
    const { container } = frame({}, 40);
    const surface = container.querySelector('[tabindex="0"]') as HTMLElement;

    surface.scrollLeft = 500;
    fireEvent.scroll(surface);

    const labelCell = screen.getByText('Guests').parentElement?.parentElement as HTMLElement;
    expect(labelCell).toHaveClass('px-1');
    expect(labelCell).not.toHaveClass('px-3');
  });

  it('folds all the way exactly where the column reaches its narrow width', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });
    const { container } = frame({}, 40);
    const surface = container.querySelector('[tabindex="0"]') as HTMLElement;

    surface.scrollLeft = 110;
    fireEvent.scroll(surface);

    expect(surface).toHaveAttribute('data-labels-collapsed', 'true');
  });

  it('listens to scrolling passively, and stops when gone', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });
    const add = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    const remove = vi.spyOn(HTMLElement.prototype, 'removeEventListener');
    const { unmount } = frame({}, 40);

    expect(add).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
    unmount();
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('measures the surface on mount, on resize, and stops watching when gone', () => {
    const callbacks: Array<() => void> = [];
    const observed: Element[] = [];
    const disconnect = vi.fn();
    const original = window.ResizeObserver;
    window.ResizeObserver = class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe(target: Element): void {
        observed.push(target);
      }
      unobserve(): void {
        // Not used by the frame.
      }
      disconnect(): void {
        disconnect();
      }
    } as unknown as typeof ResizeObserver;
    try {
      const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
      const { container, last, unmount } = frame();
      const surface = container.querySelector('[tabindex="0"]') as HTMLElement;
      expect(observed).toContain(surface);
      const before = last().canvasWidth;

      width.mockReturnValue(1280);
      act(() => {
        for (const callback of callbacks) callback();
      });
      expect(last().canvasWidth).toBeGreaterThan(before);

      unmount();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      window.ResizeObserver = original;
    }
  });

  it('gives each row a day width that tiles the canvas, and follows a new day count', () => {
    stubMeasurements({ clientWidth: 640 });
    const { last, rerender, ui } = frame();
    expect(last().cellWidthPx * last().dayCount).toBeCloseTo(last().canvasWidth, 6);
    expect(last().dayGridTemplateColumns).toBeDefined();

    rerender(ui({ days: makeDays(3), dayKeys: makeDayKeys(3) }));

    expect(last().dayCount).toBe(3);
    expect(last().cellWidthPx * 3).toBeCloseTo(last().canvasWidth, 6);
  });

  it('lays the day header out on a new template when the day count changes', () => {
    stubMeasurements({ clientWidth: 640 });
    const { container, last, rerender, ui } = frame();
    const before = last().dayGridTemplateColumns;

    rerender(ui({ days: makeDays(3), dayKeys: makeDayKeys(3) }));

    const grid = container.querySelector('.grid') as HTMLElement;
    expect(last().dayGridTemplateColumns).not.toBe(before);
    expect(last().dayGridTemplateColumns).toMatch(/^repeat\(3, /);
    expect(grid.style.gridTemplateColumns).toBe(last().dayGridTemplateColumns);
  });

  it('lays the day header out on the template it hands the rows', () => {
    stubMeasurements({ clientWidth: 640 });
    const { container, last } = frame();

    const grid = container.querySelector('.grid') as HTMLElement;
    expect(grid).toHaveClass('grid', 'h-full', 'min-w-0', 'w-full');
    expect(grid.style.gridTemplateColumns).toBe(last().dayGridTemplateColumns);
  });

  it('offers no scrollbar before the surface has been measured', () => {
    frame({}, 40);

    expect(screen.queryByTestId('timeline-scrollbar')).not.toBeInTheDocument();
  });

  it('highlights the first day as today, and moves the highlight with the key', () => {
    const keys = makeDayKeys(7);
    const { container, rerender, ui } = frame({ todayKey: keys[0] });

    const cells = () => [...container.querySelectorAll<HTMLElement>('.grid > div')];
    expect(cells()[0]).toHaveAttribute('aria-current', 'date');
    expect(cells()[0]).toHaveClass('bg-primary/12', 'text-foreground');
    expect(cells()[0]?.querySelector('.font-semibold')).not.toBeNull();
    expect(cells()[1]).not.toHaveAttribute('aria-current');
    expect(cells()[1]).not.toHaveClass('bg-primary/12');

    rerender(ui({ todayKey: keys[4] }));
    expect(cells()[4]).toHaveAttribute('aria-current', 'date');
    expect(cells()[0]).not.toHaveAttribute('aria-current');
  });

  it('draws each header cell with its labels, and shades the weekend and the days outside the trip', () => {
    const keys = makeDayKeys(7);
    const { container } = frame({
      tripRange: { startKey: keys[1] as ISODateString, endKey: keys[6] as ISODateString },
      outsideTripLabel: 'Outside the trip',
    });
    const cells = [...container.querySelectorAll<HTMLElement>('.grid > div')];

    for (const cell of cells) {
      expect(cell).toHaveClass('min-w-0', 'border-r', 'border-muted', 'px-1', 'py-2', 'text-xs', 'text-muted-foreground');
      expect(cell.firstElementChild).toHaveClass('flex', 'flex-col', 'items-center', 'leading-none');
      const [top, bottom] = [...(cell.firstElementChild?.children ?? [])] as HTMLElement[];
      expect(top).toHaveClass('text-xs', 'text-muted-foreground', 'truncate');
      expect(bottom).toHaveClass('font-medium', 'tabular-nums', 'truncate', 'text-foreground');
    }

    // Monday 5 January: day 0 is before the range; days 5 and 6 are the weekend.
    expect(cells[0]).toHaveClass('bg-muted/60');
    expect(cells[0]).toHaveAttribute('data-outside-trip', 'true');
    expect(cells[0]?.getAttribute('title')).toBe(`${format(makeDays(7)[0]!, 'PPPP', { locale: enUS })} · Outside the trip`);
    expect(within(cells[0] as HTMLElement).getByText('Outside the trip')).toHaveClass('sr-only');
    expect(cells[2]).not.toHaveClass('bg-muted/60');
    expect(cells[2]).not.toHaveAttribute('data-outside-trip');
    expect(cells[2]?.getAttribute('title')).toBe(format(makeDays(7)[2]!, 'PPPP', { locale: enUS }));
    expect(cells[2]).not.toHaveClass('bg-muted/35');
    expect(cells[5]).toHaveClass('bg-muted/35');
    expect(cells[5]).toHaveAttribute('data-weekend', 'true');
    expect(cells[2]).not.toHaveAttribute('data-weekend');
  });

  it('marks the days outside the trip without a label when none is given', () => {
    const keys = makeDayKeys(7);
    const { container } = frame({
      tripRange: { startKey: keys[1] as ISODateString, endKey: keys[4] as ISODateString },
    });
    const cells = [...container.querySelectorAll<HTMLElement>('.grid > div')];

    expect(cells[0]?.getAttribute('title')).toBe(format(makeDays(7)[0]!, 'PPPP', { locale: enUS }));
    expect(cells[0]?.querySelector('.sr-only')).toBeNull();
  });

  it('draws the axis it is handed, and asks for day details only for whole-day columns', () => {
    const start = new Date(2026, 0, 5, 9, 0);
    const columns = [
      {
        key: 'slot-1',
        start,
        end: new Date(2026, 0, 5, 9, 15),
        topLabel: '',
        bottomLabel: '09:00',
        title: 'Nine o clock',
        isWeekend: false,
      },
      {
        key: 'day-2',
        start: new Date(2026, 0, 6),
        end: new Date(2026, 0, 7),
        topLabel: 'Tue',
        bottomLabel: '06',
        title: 'Tuesday',
        isWeekend: false,
        dayKey: '2026-01-06' as ISODateString,
      },
    ];
    const renderDayMeta = vi.fn((key: ISODateString) => <span>meta {key}</span>);

    const { container } = frame({ columns, renderDayMeta }, 7);

    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.queryByText('05')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.grid > div')).toHaveLength(2);
    // An empty top label still takes its line, so the two rows stay aligned.
    expect(container.querySelector('.grid > div')?.firstElementChild?.firstElementChild?.textContent).toBe('\u00a0');
    expect(renderDayMeta).toHaveBeenCalledTimes(1);
    expect(renderDayMeta).toHaveBeenCalledWith('2026-01-06', 1);
    expect(screen.getByText('meta 2026-01-06')).toBeInTheDocument();
  });

  it('draws the marker on a one-day axis', () => {
    stubMeasurements({ clientWidth: 640 });

    frame({ now: new Date(2026, 0, 5, 12, 0) }, 1);

    expect(screen.getByTestId('timeline-now-marker').hidden).toBe(false);
  });

  it('centres again for another day, and tells a row the range it centred on', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });
    const keys = makeDayKeys(40);
    const ranges: TimelineVisibleRange[] = [];

    function Probe(): null {
      const { subscribeVisibleRange } = useTimelineScroll();
      useEffect(() => subscribeVisibleRange((range) => ranges.push(range)), [subscribeVisibleRange]);
      return null;
    }

    const ui = (todayKey: ISODateString | undefined) => (
      <TripTimelineFrame {...baseProps} days={makeDays(40)} dayKeys={keys} todayKey={todayKey}>
        {() => <Probe />}
      </TripTimelineFrame>
    );
    const { container, rerender } = render(ui(keys[20]));
    const surface = container.querySelector('[tabindex="0"]') as HTMLElement;
    const first = surface.scrollLeft;
    expect(first).toBeGreaterThan(0);
    expect(ranges.at(-1)?.end).toBe(first + 320 - 150);

    rerender(ui(keys[30]));
    expect(surface.scrollLeft).toBeGreaterThan(first);
  });

  it('draws the scrollbar with every engine style', () => {
    stubMeasurements({ clientWidth: 320, scrollWidth: 1920 });
    frame({}, 40);

    expect(screen.getByTestId('timeline-scrollbar')).toHaveClass(
      '[&::-webkit-slider-runnable-track]:h-1',
      '[&::-webkit-slider-runnable-track]:rounded-full',
      '[&::-webkit-slider-runnable-track]:bg-muted',
      '[&::-webkit-slider-thumb]:appearance-none',
      '[&::-webkit-slider-thumb]:h-2.5',
      '[&::-webkit-slider-thumb]:w-8',
      '[&::-webkit-slider-thumb]:-mt-[3px]',
      '[&::-webkit-slider-thumb]:rounded-full',
      '[&::-webkit-slider-thumb]:bg-muted-foreground/70',
      '[&::-moz-range-track]:h-1',
      '[&::-moz-range-track]:rounded-full',
      '[&::-moz-range-track]:bg-muted',
      '[&::-moz-range-thumb]:h-2.5',
      '[&::-moz-range-thumb]:w-8',
      '[&::-moz-range-thumb]:border-0',
      '[&::-moz-range-thumb]:rounded-full',
      '[&::-moz-range-thumb]:bg-muted-foreground/70',
    );
  });

  it('highlights no column of a custom axis when there is no today', () => {
    const columns = [
      {
        key: 'slot-1',
        start: new Date(2026, 0, 5, 9, 0),
        end: new Date(2026, 0, 5, 9, 15),
        topLabel: '',
        bottomLabel: '09:00',
        title: 'Nine o clock',
        isWeekend: false,
      },
    ];
    const { container, last } = frame({ columns });

    expect(container.querySelector('[aria-current="date"]')).toBeNull();
    expect(last().todayColumnIndex).toBeUndefined();
  });

  it('gives an empty axis a usable day width', () => {
    stubMeasurements({ clientWidth: 640 });
    const { last } = frame({}, 0);

    expect(Number.isFinite(last().cellWidthPx)).toBe(true);
    expect(last().cellWidthPx).toBe(last().dayWidthPx);
  });

  it('re-reads the visible range and the thumb when the surface is resized', () => {
    const callbacks: Array<() => void> = [];
    const original = window.ResizeObserver;
    window.ResizeObserver = class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe(): void {
        // Nothing to watch in jsdom.
      }
      unobserve(): void {
        // Not used by the frame.
      }
      disconnect(): void {
        // Nothing to let go of.
      }
    } as unknown as typeof ResizeObserver;
    try {
      const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(1920);
      const ranges: TimelineVisibleRange[] = [];
      function Probe(): null {
        const { subscribeVisibleRange } = useTimelineScroll();
        useEffect(() => subscribeVisibleRange((range) => ranges.push(range)), [subscribeVisibleRange]);
        return null;
      }
      const { container } = render(
        <TripTimelineFrame {...baseProps} days={makeDays(60)} dayKeys={makeDayKeys(60)}>
          {() => <Probe />}
        </TripTimelineFrame>,
      );
      const surface = container.querySelector('[tabindex="0"]') as HTMLElement;
      surface.scrollLeft = 800;
      fireEvent.scroll(surface);
      expect((screen.getByTestId('timeline-scrollbar') as HTMLInputElement).value).toBe('50');

      width.mockReturnValue(960);
      act(() => {
        for (const callback of callbacks) callback();
      });

      expect(ranges.at(-1)?.end).toBe(800 + 960 - 150);
      expect((screen.getByTestId('timeline-scrollbar') as HTMLInputElement).value).toBe('83');
    } finally {
      window.ResizeObserver = original;
    }
  });
});

