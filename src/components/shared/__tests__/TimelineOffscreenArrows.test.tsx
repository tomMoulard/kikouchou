/**
 * @fileoverview The arrows that point at a row's pills when they are scrolled
 * off one side of the timeline.
 *
 * The frame is replaced by a fake scroll API: the test publishes a visible
 * range the way the frame would and reads where the arrows put themselves and
 * where a click asks the frame to scroll.
 *
 * @module components/shared/__tests__/TimelineOffscreenArrows.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, fireEvent, render, screen } from '@/test/utils';

import type { TimelinePillBounds } from '../TimelineOffscreenArrows';
import type { TimelineScrollApi, TimelineVisibleRange } from '../timeline-scroll-context';

/**
 * Loaded inside the first test rather than at the top of the file: the inert
 * scroll API a row gets outside a frame is a load-time constant, and Stryker
 * can only test a mutant in load-time code against the test that was running
 * when the module loaded.
 */
let TimelineOffscreenArrows: typeof import('../TimelineOffscreenArrows').TimelineOffscreenArrows;
let TimelineScrollContext: typeof import('../timeline-scroll-context').TimelineScrollContext;

beforeEach(async () => {
  ({ TimelineOffscreenArrows } = await import('../TimelineOffscreenArrows'));
  ({ TimelineScrollContext } = await import('../timeline-scroll-context'));
});

// ============================================================================
// Helpers
// ============================================================================

interface FakeFrame {
  readonly api: TimelineScrollApi;
  readonly publish: (range: TimelineVisibleRange) => void;
  readonly scrollTo: ReturnType<typeof vi.fn>;
  readonly unsubscribe: ReturnType<typeof vi.fn>;
  readonly subscriptions: () => number;
}

function fakeFrame(): FakeFrame {
  let listener: ((range: TimelineVisibleRange) => void) | null = null;
  let subscriptions = 0;
  const unsubscribe = vi.fn();
  const scrollTo = vi.fn();
  return {
    api: {
      subscribeVisibleRange: (next) => {
        subscriptions += 1;
        listener = next;
        return unsubscribe;
      },
      scrollCanvasPositionIntoView: scrollTo,
    },
    publish: (range) => {
      act(() => {
        listener?.(range);
      });
    },
    scrollTo,
    unsubscribe,
    subscriptions: () => subscriptions,
  };
}

/**
 * Out of order on purpose: the nearest hidden pill on each side is not the
 * last one listed, so "nearest" cannot pass for "last seen".
 */
const PILLS: readonly TimelinePillBounds[] = [
  { left: 100, right: 150, centre: 125 },
  { left: 0, right: 50, centre: 25 },
  { left: 150, right: 250, centre: 200 },
  { left: 300, right: 350, centre: 325 },
  { left: 400, right: 450, centre: 425 },
];

function renderArrows(frame: FakeFrame, bounds: readonly TimelinePillBounds[] = PILLS) {
  return render(
    <TimelineScrollContext.Provider value={frame.api}>
      <TimelineOffscreenArrows bounds={bounds} leftLabel="Earlier stays" rightLabel="Later stays" />
    </TimelineScrollContext.Provider>,
    { withProviders: false },
  );
}

const left = (): HTMLElement => screen.getByTestId('timeline-offscreen-left');
const right = (): HTMLElement => screen.getByTestId('timeline-offscreen-right');

// ============================================================================
// Tests
// ============================================================================

describe('TimelineOffscreenArrows', () => {
  it('stays hidden, and does nothing, outside a timeline frame', () => {
    render(
      <TimelineOffscreenArrows bounds={PILLS} leftLabel="Earlier stays" rightLabel="Later stays" />,
      { withProviders: false },
    );

    expect(left()).not.toBeVisible();
    fireEvent.click(left());
    expect(right()).not.toBeVisible();
  });

  it('draws nothing for a row with no pills', () => {
    const frame = fakeFrame();

    const { container } = renderArrows(frame, []);
    frame.publish({ start: 0, end: 100 });

    expect(container).toBeEmptyDOMElement();
  });

  it('starts hidden until the frame says where the axis is', () => {
    renderArrows(fakeFrame());

    expect(left()).not.toBeVisible();
    expect(right()).not.toBeVisible();
  });

  it('points at the nearest hidden pill on each side, at the edges of the visible axis', () => {
    const frame = fakeFrame();
    renderArrows(frame);

    frame.publish({ start: 150, end: 300 });

    expect(left()).toBeVisible();
    expect(right()).toBeVisible();
    expect(left().style.left).toBe('152px');
    expect(right().style.left).toBe('278px');

    fireEvent.click(left());
    expect(frame.scrollTo).toHaveBeenLastCalledWith(125);
    fireEvent.click(right());
    expect(frame.scrollTo).toHaveBeenLastCalledWith(325);
  });

  it('counts a pill that ends exactly at the left edge, or starts exactly at the right edge, as hidden', () => {
    const frame = fakeFrame();
    renderArrows(frame, [
      { left: 0, right: 100, centre: 50 },
      { left: 200, right: 300, centre: 250 },
    ]);

    frame.publish({ start: 100, end: 200 });

    expect(left()).toBeVisible();
    expect(right()).toBeVisible();
  });

  it('hides both arrows, and scrolls nowhere, when every pill is in view', () => {
    const frame = fakeFrame();
    renderArrows(frame);
    frame.publish({ start: 150, end: 300 });

    frame.publish({ start: 0, end: 1000 });

    expect(left()).not.toBeVisible();
    expect(right()).not.toBeVisible();
    fireEvent.click(left());
    fireEvent.click(right());
    expect(frame.scrollTo).not.toHaveBeenCalled();
  });

  it('names and draws each arrow', () => {
    renderArrows(fakeFrame());

    for (const [arrow, label] of [
      [left(), 'Earlier stays'],
      [right(), 'Later stays'],
    ] as const) {
      expect(arrow).toHaveAttribute('type', 'button');
      expect(arrow).toHaveAttribute('title', label);
      expect(arrow).toHaveAttribute('aria-label', label);
      expect(arrow).toHaveClass(
        'absolute', 'top-1/2', 'z-[3]', '-translate-y-1/2', 'rounded-full', 'border', 'bg-background/90', 'shadow-sm',
        'flex', 'items-center', 'justify-center', 'text-muted-foreground', 'hover:text-foreground',
        'focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-ring',
      );
      expect(arrow.style.width).toBe('20px');
      expect(arrow.style.height).toBe('20px');
      expect(arrow.querySelector('svg')).toHaveClass('size-3.5');
    }
  });

  it('stops watching once gone, and watches again for new pills', () => {
    const frame = fakeFrame();
    const { rerender, unmount } = renderArrows(frame);
    expect(frame.subscriptions()).toBe(1);

    rerender(
      <TimelineScrollContext.Provider value={frame.api}>
        <TimelineOffscreenArrows
          bounds={[{ left: 500, right: 600, centre: 550 }]}
          leftLabel="Earlier stays"
          rightLabel="Later stays"
        />
      </TimelineScrollContext.Provider>,
    );
    expect(frame.subscriptions()).toBe(2);
    expect(frame.unsubscribe).toHaveBeenCalledTimes(1);

    frame.publish({ start: 0, end: 100 });
    fireEvent.click(right());
    expect(frame.scrollTo).toHaveBeenLastCalledWith(550);

    unmount();
    expect(frame.unsubscribe).toHaveBeenCalledTimes(2);
  });


  it('scrolls through the frame it sits in now', () => {
    const first = fakeFrame();
    const second = fakeFrame();
    const { rerender } = render(
      <TimelineScrollContext.Provider value={first.api}>
        <TimelineOffscreenArrows bounds={PILLS} leftLabel="Earlier stays" rightLabel="Later stays" />
      </TimelineScrollContext.Provider>,
      { withProviders: false },
    );
    rerender(
      <TimelineScrollContext.Provider value={second.api}>
        <TimelineOffscreenArrows bounds={PILLS} leftLabel="Earlier stays" rightLabel="Later stays" />
      </TimelineScrollContext.Provider>,
    );
    second.publish({ start: 150, end: 300 });

    fireEvent.click(left());
    fireEvent.click(right());

    expect(second.scrollTo).toHaveBeenCalledWith(125);
    expect(second.scrollTo).toHaveBeenCalledWith(325);
    expect(first.scrollTo).not.toHaveBeenCalled();
  });
});
