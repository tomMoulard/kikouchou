/**
 * @fileoverview Tests for useVisibleViewportHeight.
 */

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  KEYBOARD_OVERLAP_VAR,
  VISIBLE_VIEWPORT_HEIGHT_VAR,
  useVisibleViewportHeight,
} from '../useVisibleViewportHeight';

/** A window whose visual viewport the test moves, as a keyboard would. */
function fakeWindow(innerHeight: number) {
  const viewport = new EventTarget() as EventTarget & { height: number; offsetTop: number };
  viewport.height = innerHeight;
  viewport.offsetTop = 0;
  const win = new EventTarget() as EventTarget & {
    innerHeight: number;
    visualViewport: typeof viewport | null;
    document: Document;
  };
  win.innerHeight = innerHeight;
  win.visualViewport = viewport;
  win.document = document;
  return { win: win as unknown as Window, viewport, raw: win };
}

const read = (name: string) => document.documentElement.style.getPropertyValue(name);

describe('useVisibleViewportHeight', () => {
  it('publishes the visible height, with nothing covered', () => {
    const { win } = fakeWindow(770);
    const { unmount } = renderHook(() => useVisibleViewportHeight(win));

    expect(read(VISIBLE_VIEWPORT_HEIGHT_VAR)).toBe('770px');
    expect(read(KEYBOARD_OVERLAP_VAR)).toBe('0px');
    unmount();
  });

  // Chrome's default: the page keeps its height and the keyboard covers it.
  it('follows a keyboard drawn over the page', () => {
    const { win, viewport } = fakeWindow(770);
    const { unmount } = renderHook(() => useVisibleViewportHeight(win));

    viewport.height = 470;
    viewport.dispatchEvent(new Event('resize'));

    expect(read(VISIBLE_VIEWPORT_HEIGHT_VAR)).toBe('470px');
    expect(read(KEYBOARD_OVERLAP_VAR)).toBe('300px');
    unmount();
  });

  // A browser that shrinks the page around the keyboard: nothing is covered,
  // and its bottom bar is drawn above the keyboard.
  it('reports no overlap when the page was resized around the keyboard', () => {
    const { win, viewport, raw } = fakeWindow(770);
    const { unmount } = renderHook(() => useVisibleViewportHeight(win));

    raw.innerHeight = 470;
    viewport.height = 470;
    raw.dispatchEvent(new Event('resize'));

    expect(read(VISIBLE_VIEWPORT_HEIGHT_VAR)).toBe('470px');
    expect(read(KEYBOARD_OVERLAP_VAR)).toBe('0px');
    unmount();
  });

  it('counts a visual viewport scrolled down the page as visible, not covered', () => {
    const { win, viewport } = fakeWindow(770);
    const { unmount } = renderHook(() => useVisibleViewportHeight(win));

    viewport.height = 470;
    viewport.offsetTop = 300;
    viewport.dispatchEvent(new Event('scroll'));

    expect(read(KEYBOARD_OVERLAP_VAR)).toBe('0px');
    unmount();
  });

  it('removes both variables when the page goes, so others keep 100dvh', () => {
    const { win } = fakeWindow(770);
    const { unmount } = renderHook(() => useVisibleViewportHeight(win));
    unmount();

    expect(read(VISIBLE_VIEWPORT_HEIGHT_VAR)).toBe('');
    expect(read(KEYBOARD_OVERLAP_VAR)).toBe('');
  });

  it('does nothing in a browser without a visual viewport', () => {
    const { win, raw } = fakeWindow(770);
    raw.visualViewport = null;
    const { unmount } = renderHook(() => useVisibleViewportHeight(win));

    expect(read(VISIBLE_VIEWPORT_HEIGHT_VAR)).toBe('');
    unmount();
  });
});
