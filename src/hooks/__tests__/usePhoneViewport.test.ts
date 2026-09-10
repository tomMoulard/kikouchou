/**
 * @fileoverview Phone-or-not, read from the viewport and kept current.
 *
 * @module hooks/__tests__/usePhoneViewport.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { PHONE_MEDIA_QUERY, usePhoneViewport } from '@/hooks/usePhoneViewport';

type ChangeListener = (event: MediaQueryListEvent) => void;

/**
 * A `matchMedia` that answers the phone query and lets a test flip it.
 */
function installMatchMedia(matches: boolean): { flip: (next: boolean) => void } {
  const listeners = new Set<ChangeListener>();
  const list = {
    matches,
    media: PHONE_MEDIA_QUERY,
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
    value: vi.fn((query: string) => {
      expect(query).toBe(PHONE_MEDIA_QUERY);
      return list;
    }),
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

describe('usePhoneViewport', () => {
  it('is true below the md breakpoint', () => {
    installMatchMedia(true);

    const { result } = renderHook(() => usePhoneViewport());

    expect(result.current).toBe(true);
  });

  it('is false on a wider screen', () => {
    installMatchMedia(false);

    const { result } = renderHook(() => usePhoneViewport());

    expect(result.current).toBe(false);
  });

  it('follows a rotation or a resize', () => {
    const media = installMatchMedia(true);
    const { result } = renderHook(() => usePhoneViewport());

    act(() => {
      media.flip(false);
    });

    expect(result.current).toBe(false);
  });

  it('answers false where matchMedia does not exist', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const { result } = renderHook(() => usePhoneViewport());

    // An old WebView, or a test tree: not a phone we can be sure of, and the
    // install nudge is the one consumer, so "no" is the safe answer.
    expect(result.current).toBe(false);
  });
});
