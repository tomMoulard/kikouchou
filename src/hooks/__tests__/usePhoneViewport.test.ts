/**
 * @fileoverview Phone-or-not, read from the viewport and kept current.
 *
 * @module hooks/__tests__/usePhoneViewport.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import {
  PHONE_MEDIA_QUERY,
  SHORT_LANDSCAPE_MEDIA_QUERY,
  usePhoneViewport,
  useShortLandscapeViewport,
} from '@/hooks/usePhoneViewport';

type ChangeListener = (event: MediaQueryListEvent) => void;

/**
 * A `matchMedia` that answers one query and lets a test flip it.
 *
 * The query is asserted rather than ignored: a hook asking for the wrong one
 * would otherwise read the answer meant for its neighbour and pass.
 */
function installMatchMedia(
  matches: boolean,
  query: string = PHONE_MEDIA_QUERY,
): { flip: (next: boolean) => void } {
  const listeners = new Set<ChangeListener>();
  const list = {
    matches,
    media: query,
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
    value: vi.fn((asked: string) => {
      expect(asked).toBe(query);
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

describe('useShortLandscapeViewport', () => {
  it('is true on a phone held sideways', () => {
    installMatchMedia(true, SHORT_LANDSCAPE_MEDIA_QUERY);

    const { result } = renderHook(() => useShortLandscapeViewport());

    expect(result.current).toBe(true);
  });

  it('is false on a screen with height to spare', () => {
    installMatchMedia(false, SHORT_LANDSCAPE_MEDIA_QUERY);

    const { result } = renderHook(() => useShortLandscapeViewport());

    expect(result.current).toBe(false);
  });

  it('follows the phone being turned upright', () => {
    const media = installMatchMedia(true, SHORT_LANDSCAPE_MEDIA_QUERY);
    const { result } = renderHook(() => useShortLandscapeViewport());

    act(() => {
      media.flip(false);
    });

    expect(result.current).toBe(false);
  });

  it('asks about the height and the orientation together', () => {
    // A max-height alone would also match a short desktop window, where the
    // shell costs nothing and its absence is merely confusing.
    expect(SHORT_LANDSCAPE_MEDIA_QUERY).toContain('max-height: 500px');
    expect(SHORT_LANDSCAPE_MEDIA_QUERY).toContain('orientation: landscape');
  });
});
