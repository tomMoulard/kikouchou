/**
 * @fileoverview The media query helpers, on every list shape a browser gives.
 *
 * @module lib/utils/__tests__/media-query.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  openMediaQuery,
  readMediaQueryMatches,
  subscribeToMediaQuery,
} from '@/lib/utils/media-query';

const originalMatchMedia = window.matchMedia;

/**
 * Replaces `window.matchMedia` for one test.
 *
 * @param value - The replacement
 */
function stubMatchMedia(value: unknown): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value,
  });
}

/**
 * Casts a hand-built list to the DOM type the helper takes.
 *
 * @param list - A partial list
 * @returns The same object, typed as a MediaQueryList
 */
function asList(list: object): MediaQueryList {
  return list as unknown as MediaQueryList;
}

afterEach(() => {
  stubMatchMedia(originalMatchMedia);
});

describe('openMediaQuery', () => {
  it('returns the list matchMedia gives', () => {
    const list = { matches: true };
    stubMatchMedia(vi.fn(() => list));

    expect(openMediaQuery('(min-width: 1px)')).toBe(list);
  });

  it('returns null where matchMedia does not exist', () => {
    stubMatchMedia(undefined);

    expect(openMediaQuery('(min-width: 1px)')).toBeNull();
  });

  it('returns null where matchMedia throws', () => {
    stubMatchMedia(
      vi.fn(() => {
        throw new SyntaxError('bad query');
      }),
    );

    expect(openMediaQuery('(min-width: nonsense)')).toBeNull();
  });

  it('returns null where matchMedia returns nothing', () => {
    stubMatchMedia(vi.fn(() => undefined));

    expect(openMediaQuery('(min-width: 1px)')).toBeNull();
  });
});

describe('readMediaQueryMatches', () => {
  it('reads matches from the list', () => {
    expect(readMediaQueryMatches(asList({ matches: true }))).toBe(true);
    expect(readMediaQueryMatches(asList({ matches: false }))).toBe(false);
  });

  it('answers false for no list', () => {
    expect(readMediaQueryMatches(null)).toBe(false);
  });

  it('answers false when reading matches throws', () => {
    const list = {
      get matches(): boolean {
        throw new TypeError('Illegal invocation');
      },
    };

    expect(readMediaQueryMatches(asList(list))).toBe(false);
  });
});

describe('subscribeToMediaQuery', () => {
  it('subscribes to nothing for no list', () => {
    const stop = subscribeToMediaQuery(null, vi.fn());

    expect(() => {
      stop();
    }).not.toThrow();
  });

  it('prefers addEventListener when the list has both', () => {
    const list = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    const listener = vi.fn();

    const stop = subscribeToMediaQuery(asList(list), listener);
    stop();

    expect(list.addEventListener).toHaveBeenCalledWith('change', listener);
    expect(list.removeEventListener).toHaveBeenCalledWith('change', listener);
    expect(list.addListener).not.toHaveBeenCalled();
    expect(list.removeListener).not.toHaveBeenCalled();
  });

  it('falls back to addListener on an old Safari list', () => {
    const list = { addListener: vi.fn(), removeListener: vi.fn() };
    const listener = vi.fn();

    const stop = subscribeToMediaQuery(asList(list), listener);
    expect(list.addListener).toHaveBeenCalledWith(listener);

    stop();
    expect(list.removeListener).toHaveBeenCalledWith(listener);
  });

  it('calls the methods on the list itself', () => {
    const list = {
      seen: [] as unknown[],
      addListener(this: { seen: unknown[] }) {
        this.seen.push(this);
      },
    };

    subscribeToMediaQuery(asList(list), vi.fn());

    expect(list.seen).toEqual([list]);
  });

  it('falls back to addListener when addEventListener throws', () => {
    const list = {
      addEventListener: vi.fn(() => {
        throw new TypeError('Illegal invocation');
      }),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    const listener = vi.fn();

    const stop = subscribeToMediaQuery(asList(list), listener);
    stop();

    expect(list.addListener).toHaveBeenCalledWith(listener);
    expect(list.removeListener).toHaveBeenCalledWith(listener);
  });

  it('subscribes to nothing, and does not throw, on a stub with no method', () => {
    const stop = subscribeToMediaQuery(asList({ matches: true }), vi.fn());

    expect(() => {
      stop();
    }).not.toThrow();
  });

  it('does not throw when the remover is missing', () => {
    const list = { addEventListener: vi.fn() };

    const stop = subscribeToMediaQuery(asList(list), vi.fn());

    expect(() => {
      stop();
    }).not.toThrow();
  });
});
