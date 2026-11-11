/**
 * Unit tests for the ES2022 polyfills an old Android WebView needs.
 *
 * Each test removes the native built-in, runs the install step, and puts the
 * native back afterwards. It calls `installPolyfills` rather than importing
 * the module afresh: the test runner's module loader calls both built-ins, so
 * an import with them removed fails inside the loader, not in the code under
 * test.
 *
 * @module lib/__tests__/polyfills.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installPolyfills } from '@/lib/polyfills';

// ============================================================================
// Helpers
// ============================================================================

const nativeHasOwn = Object.hasOwn;
const nativeAt = Array.prototype.at;
const nativeDefineProperty = Object.defineProperty;

function removeNatives(): void {
  Reflect.deleteProperty(Object, 'hasOwn');
  Reflect.deleteProperty(Array.prototype, 'at');
}

function restoreNatives(): void {
  Object.defineProperty(Object, 'hasOwn', {
    value: nativeHasOwn,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(Array.prototype, 'at', {
    value: nativeAt,
    configurable: true,
    writable: true,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('lib/polyfills', () => {
  beforeEach(() => {
    removeNatives();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreNatives();
  });

  it('defines Object.hasOwn where the browser lacks it', () => {
    expect('hasOwn' in Object).toBe(false);

    installPolyfills();

    const record: Record<string, unknown> = { own: undefined };
    expect(Object.hasOwn(record, 'own')).toBe(true);
    expect(Object.hasOwn(record, 'toString')).toBe(false);
    expect(Object.hasOwn(Object.create(record) as object, 'own')).toBe(false);
    expect(Object.hasOwn(['a'], 0)).toBe(true);
    expect(() => Object.hasOwn(null as unknown as object, 'own')).toThrow(TypeError);
  });

  it('keeps Object.hasOwn off the enumerable keys of Object', () => {
    installPolyfills();

    expect(Object.keys(Object)).not.toContain('hasOwn');
  });

  it('defines Array.prototype.at where the browser lacks it', () => {
    expect('at' in []).toBe(false);

    installPolyfills();

    const letters = ['a', 'b', 'c'];
    expect(letters.at(0)).toBe('a');
    expect(letters.at(-1)).toBe('c');
    expect(letters.at(1.7)).toBe('b');
    expect(letters.at(3)).toBeUndefined();
    expect(letters.at(-4)).toBeUndefined();
    expect([].at(-1)).toBeUndefined();
    expect(Object.keys(letters)).toEqual(['0', '1', '2']);
  });

  it('leaves a native built-in in place', () => {
    restoreNatives();

    installPolyfills();

    expect(Object.hasOwn).toBe(nativeHasOwn);
    expect(Array.prototype.at).toBe(nativeAt);
  });

  it('logs and does not throw when a definition is refused', () => {
    const refusal = new TypeError('Cannot define property');
    // Only the two polyfills are refused: nothing else may break mid-test.
    vi.spyOn(Object, 'defineProperty').mockImplementation((target, key, attributes) => {
      if (key === 'hasOwn' || key === 'at') {
        throw refusal;
      }
      return nativeDefineProperty(target, key, attributes);
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => installPolyfills()).not.toThrow();

    expect(consoleError).toHaveBeenCalledWith('Failed to polyfill hasOwn:', refusal);
    expect(consoleError).toHaveBeenCalledWith('Failed to polyfill at:', refusal);
  });
});
