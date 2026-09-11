/**
 * @fileoverview Tests for TripTimelineFrame shared component.
 * @module components/shared/__tests__/TripTimelineFrame.test
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { addDays, format } from 'date-fns';
import { TripTimelineFrame } from '../TripTimelineFrame';
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

  it('renders toolbar content above the timeline', () => {
    render(
      <TripTimelineFrame {...defaultProps} toolbar={<button type="button">Now</button>}>
        {() => null}
      </TripTimelineFrame>,
    );

    expect(screen.getByRole('button', { name: 'Now' })).toBeInTheDocument();
  });
});
