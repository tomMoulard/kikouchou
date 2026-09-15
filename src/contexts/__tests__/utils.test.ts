/**
 * @fileoverview Tests for shared context utility functions.
 *
 * @module contexts/__tests__/utils.test
 */

import { describe, it, expect, vi } from 'vitest';

import {
  wrapAndSetError,
  clearErrorIfNeeded,
  areArraysEqual,
  areCoordinatesEqual,
  isDefined,
} from '../utils';

// ============================================================================
// wrapAndSetError
// ============================================================================

describe('wrapAndSetError', () => {
  it('returns the original Error when err is an Error instance', () => {
    const setError = vi.fn();
    const original = new Error('original');
    const result = wrapAndSetError(original, 'fallback', setError);

    expect(result).toBe(original);
    expect(setError).toHaveBeenCalledWith(original);
  });

  it('wraps non-Error values with the fallback message', () => {
    const setError = vi.fn();
    const result = wrapAndSetError('string error', 'fallback message', setError);

    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('fallback message');
    expect(setError).toHaveBeenCalledWith(result);
  });

  it('wraps null with the fallback message', () => {
    const setError = vi.fn();
    const result = wrapAndSetError(null, 'null fallback', setError);

    expect(result.message).toBe('null fallback');
    expect(setError).toHaveBeenCalledWith(result);
  });

  it('wraps undefined with the fallback message', () => {
    const setError = vi.fn();
    const result = wrapAndSetError(undefined, 'undef fallback', setError);

    expect(result.message).toBe('undef fallback');
  });

  it('wraps a number with the fallback message', () => {
    const setError = vi.fn();
    const result = wrapAndSetError(42, 'num fallback', setError);

    expect(result.message).toBe('num fallback');
  });
});

// ============================================================================
// clearErrorIfNeeded
// ============================================================================

describe('clearErrorIfNeeded', () => {
  it('sets error to null when previous value is non-null', () => {
    const setError = vi.fn();
    clearErrorIfNeeded(setError);

    // setError is called with a functional updater
    expect(setError).toHaveBeenCalledTimes(1);
    const updater = setError.mock.calls[0]![0] as (prev: Error | null) => Error | null;
    expect(typeof updater).toBe('function');

    // When previous error exists, should return null
    expect(updater(new Error('existing'))).toBeNull();
  });

  it('returns prev (null) when previous value is already null', () => {
    const setError = vi.fn();
    clearErrorIfNeeded(setError);

    const updater = setError.mock.calls[0]![0] as (prev: Error | null) => Error | null;
    // When already null, should return same null reference (avoid re-render)
    const result = updater(null);
    expect(result).toBeNull();
  });
});

// ============================================================================
// areArraysEqual
// ============================================================================

describe('areArraysEqual', () => {
  const numCompare = (a: number, b: number) => a === b;

  it('returns true for same reference', () => {
    const arr = [1, 2, 3];
    expect(areArraysEqual(arr, arr, numCompare)).toBe(true);
  });

  it('returns false for different lengths', () => {
    expect(areArraysEqual([1, 2], [1, 2, 3], numCompare)).toBe(false);
  });

  it('returns true for equal content', () => {
    expect(areArraysEqual([1, 2, 3], [1, 2, 3], numCompare)).toBe(true);
  });

  it('returns false for different content', () => {
    expect(areArraysEqual([1, 2, 3], [1, 9, 3], numCompare)).toBe(false);
  });

  it('returns true for empty arrays', () => {
    expect(areArraysEqual([], [], numCompare)).toBe(true);
  });

  it('works with objects and custom compareFn', () => {
    const objCompare = (a: { id: number }, b: { id: number }) => a.id === b.id;
    expect(areArraysEqual([{ id: 1 }], [{ id: 1 }], objCompare)).toBe(true);
    expect(areArraysEqual([{ id: 1 }], [{ id: 2 }], objCompare)).toBe(false);
  });
});

// ============================================================================
// areCoordinatesEqual
// ============================================================================

describe('areCoordinatesEqual', () => {
  it('returns true for the same reference', () => {
    const coords = { lat: 48.8566, lon: 2.3522 };
    expect(areCoordinatesEqual(coords, coords)).toBe(true);
  });

  it('returns true when both are undefined', () => {
    expect(areCoordinatesEqual(undefined, undefined)).toBe(true);
  });

  it('returns true for equal values in different objects', () => {
    expect(
      areCoordinatesEqual(
        { lat: 48.8566, lon: 2.3522 },
        { lat: 48.8566, lon: 2.3522 },
      ),
    ).toBe(true);
  });

  // One case per axis. A single case that moves both passes for a comparator
  // reading only one of them, which is the half-written deep compare this
  // helper exists to prevent.
  it('returns false when only the latitude differs', () => {
    expect(
      areCoordinatesEqual(
        { lat: 48.8566, lon: 2.3522 },
        { lat: 43.2965, lon: 2.3522 },
      ),
    ).toBe(false);
  });

  it('returns false when only the longitude differs', () => {
    expect(
      areCoordinatesEqual(
        { lat: 48.8566, lon: 2.3522 },
        { lat: 48.8566, lon: 5.3698 },
      ),
    ).toBe(false);
  });

  it('returns false when one side is absent', () => {
    const coords = { lat: 48.8566, lon: 2.3522 };
    expect(areCoordinatesEqual(coords, undefined)).toBe(false);
    expect(areCoordinatesEqual(undefined, coords)).toBe(false);
  });
});

// ============================================================================
// isDefined
// ============================================================================

describe('isDefined', () => {
  it('returns true for defined values', () => {
    expect(isDefined(0)).toBe(true);
    expect(isDefined('')).toBe(true);
    expect(isDefined(false)).toBe(true);
    expect(isDefined([])).toBe(true);
  });

  it('returns false for null', () => {
    expect(isDefined(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isDefined(undefined)).toBe(false);
  });

  it('filters arrays correctly', () => {
    const items = [1, null, 2, undefined, 3].filter(isDefined);
    expect(items).toEqual([1, 2, 3]);
  });
});
