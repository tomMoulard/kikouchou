/**
 * @fileoverview One media query, read once and then followed.
 *
 * `usePhoneViewport` and `useWideViewport` are both this hook with a string,
 * so the cases that belong to the reading itself are pinned here: the query
 * that cannot be asked, the query that throws, and the query that changes
 * while the page is open.
 *
 * @module hooks/__tests__/useMediaQuery.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useMediaQuery } from '@/hooks/useMediaQuery';

type ChangeListener = (event: MediaQueryListEvent) => void;

/** The query under test, and the one the fake answers. */
const WIDE = '(min-width: 1280px)';

/**
 * A `matchMedia` that answers one query and lets a test flip it.
 *
 * @param matches - What it answers to start with
 * @returns A handle that fires a change at every listener
 */
function installMatchMedia(matches: boolean): { flip: (next: boolean) => void } {
  const listeners = new Set<ChangeListener>();
  const list = {
    matches,
    media: WIDE,
    addEventListener: (_type: string, listener: ChangeListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: ChangeListener) => {
      listeners.delete(listener);
    },
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => list),
  });
  return {
    flip: (next: boolean) => {
      list.matches = next;
      listeners.forEach((listener) => {
        listener({ matches: next } as MediaQueryListEvent);
      });
    },
  };
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
});

describe('useMediaQuery', () => {
  it('answers from the query on the very first render', () => {
    installMatchMedia(true);

    const { result } = renderHook(() => useMediaQuery(WIDE));

    // Not `false` and then `true`: a layout seeded with the wrong answer
    // renders its other arm for a frame, which is a visible jump.
    expect(result.current).toBe(true);
  });

  it('follows a resize', () => {
    const media = installMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery(WIDE));

    act(() => {
      media.flip(false);
    });

    expect(result.current).toBe(false);
  });

  it('stops listening when the component goes', () => {
    const listeners: ChangeListener[] = [];
    const removed: ChangeListener[] = [];
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        matches: true,
        media: WIDE,
        addEventListener: (_type: string, listener: ChangeListener) => {
          listeners.push(listener);
        },
        removeEventListener: (_type: string, listener: ChangeListener) => {
          removed.push(listener);
        },
      })),
    });

    const { unmount } = renderHook(() => useMediaQuery(WIDE));
    unmount();

    expect(removed).toEqual(listeners);
  });

  it('answers false where matchMedia does not exist', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useMediaQuery(WIDE));

    expect(result.current).toBe(false);
  });

  it('answers false rather than throwing on a query no browser accepts', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        throw new SyntaxError('bad query');
      }),
    });

    const { result } = renderHook(() => useMediaQuery('(min-width: nonsense)'));

    expect(result.current).toBe(false);
  });
});
