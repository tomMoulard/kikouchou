/**
 * Unit tests for the ES2022 polyfills an old Android WebView needs.
 *
 * Each test removes the native built-in, evaluates the module afresh, and
 * puts the native back afterwards.
 *
 * @module lib/__tests__/polyfills.test
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

async function importPolyfills(): Promise<void> {
  vi.resetModules();
  await import('@/lib/polyfills');
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

  it('defines Object.hasOwn where the browser lacks it', async () => {
    expect('hasOwn' in Object).toBe(false);

    await importPolyfills();

    const record: Record<string, unknown> = { own: undefined };
    expect(Object.hasOwn(record, 'own')).toBe(true);
    expect(Object.hasOwn(record, 'toString')).toBe(false);
    expect(Object.hasOwn(Object.create(record) as object, 'own')).toBe(false);
    expect(Object.hasOwn(['a'], 0)).toBe(true);
    expect(() => Object.hasOwn(null as unknown as object, 'own')).toThrow(TypeError);
  });

  it('keeps Object.hasOwn off the enumerable keys of Object', async () => {
    await importPolyfills();

    expect(Object.keys(Object)).not.toContain('hasOwn');
  });

  it('defines Array.prototype.at where the browser lacks it', async () => {
    expect('at' in []).toBe(false);

    await importPolyfills();

    const letters = ['a', 'b', 'c'];
    expect(letters.at(0)).toBe('a');
    expect(letters.at(-1)).toBe('c');
    expect(letters.at(1.7)).toBe('b');
    expect(letters.at(3)).toBeUndefined();
    expect(letters.at(-4)).toBeUndefined();
    expect([].at(-1)).toBeUndefined();
    expect(Object.keys(letters)).toEqual(['0', '1', '2']);
  });

  it('leaves a native built-in in place', async () => {
    restoreNatives();

    await importPolyfills();

    expect(Object.hasOwn).toBe(nativeHasOwn);
    expect(Array.prototype.at).toBe(nativeAt);
  });

  it('logs and does not throw when a definition is refused', async () => {
    const refusal = new TypeError('Cannot define property');
    // The module loader defines properties too, so only the two polyfills
    // are refused.
    vi.spyOn(Object, 'defineProperty').mockImplementation((target, key, attributes) => {
      if (key === 'hasOwn' || key === 'at') {
        throw refusal;
      }
      return nativeDefineProperty(target, key, attributes);
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(importPolyfills()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith('Failed to polyfill hasOwn:', refusal);
    expect(consoleError).toHaveBeenCalledWith('Failed to polyfill at:', refusal);
  });
});
