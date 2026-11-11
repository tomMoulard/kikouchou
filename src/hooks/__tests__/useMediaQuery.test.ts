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

  /*
   * Safari before 14 gives a MediaQueryList with only the deprecated
   * `addListener`/`removeListener`, and some in-app browsers (a Google Ads
   * click on Android) hand back a stub with no listener method at all. Calling
   * `addEventListener` on either threw `r.addEventListener is not a function`
   * inside Layout, which sent the whole app to the route error page.
   */
  it('follows a resize on a list that only has addListener', () => {
    const listeners = new Set<ChangeListener>();
    const removed: ChangeListener[] = [];
    const list = {
      matches: true,
      media: WIDE,
      addListener: (listener: ChangeListener) => {
        listeners.add(listener);
      },
      removeListener: (listener: ChangeListener) => {
        listeners.delete(listener);
        removed.push(listener);
      },
    };
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => list),
    });

    const { result, unmount } = renderHook(() => useMediaQuery(WIDE));
    expect(result.current).toBe(true);
    expect(listeners.size).toBe(1);

    act(() => {
      list.matches = false;
      listeners.forEach((listener) => {
        listener({ matches: false } as MediaQueryListEvent);
      });
    });
    expect(result.current).toBe(false);

    unmount();
    expect(listeners.size).toBe(0);
    expect(removed).toHaveLength(1);
  });

  it('answers from a stub list with no listener method, without throwing', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ matches: true })),
    });

    const { result, unmount } = renderHook(() => useMediaQuery(WIDE));

    expect(result.current).toBe(true);
    expect(() => {
      unmount();
    }).not.toThrow();
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
