/**
 * Unit tests for the ES2022 polyfills an old Android WebView needs.
 *
 * Each test removes the native built-in, runs the install step, and puts the
 * native back before it returns, in a `finally`. Never in a hook: the runner
 * calls `Object.hasOwn` itself between a hook and the test, and a native
 * missing there crashed the run (see the test about the runner below).
 *
 * It calls `installPolyfills` rather than importing the module afresh: the test runner's module loader calls both built-ins, so
 * an import with them removed fails inside the loader, not in the code under
 * test.
 *
 * @module lib/__tests__/polyfills.test
 */
import { describe, expect, it, vi } from 'vitest';

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

/**
 * Puts both natives back. Through the native `defineProperty`, because one
 * test replaces `Object.defineProperty` with a stub that refuses both keys.
 */
function restoreNatives(): void {
  nativeDefineProperty(Object, 'hasOwn', {
    value: nativeHasOwn,
    configurable: true,
    writable: true,
  });
  nativeDefineProperty(Array.prototype, 'at', {
    value: nativeAt,
    configurable: true,
    writable: true,
  });
}

/**
 * Runs `run` on an engine without the two natives, and puts them back before
 * returning, whether `run` passes or throws.
 *
 * @param run - The test body; synchronous, so the runner cannot run between
 *   the removal and the restore
 */
function withoutNatives(run: () => void): void {
  removeNatives();
  try {
    run();
  } finally {
    restoreNatives();
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('lib/polyfills', () => {
  it('defines Object.hasOwn where the browser lacks it', () => {
    withoutNatives(() => {
      expect('hasOwn' in Object).toBe(false);

      installPolyfills();

      const record: Record<string, unknown> = { own: undefined };
      expect(Object.hasOwn(record, 'own')).toBe(true);
      expect(Object.hasOwn(record, 'toString')).toBe(false);
      expect(Object.hasOwn(Object.create(record) as object, 'own')).toBe(false);
      expect(Object.hasOwn(['a'], 0)).toBe(true);
      expect(() => Object.hasOwn(null as unknown as object, 'own')).toThrow(TypeError);
    });
  });

  it('keeps Object.hasOwn off the enumerable keys of Object', () => {
    withoutNatives(() => {
      installPolyfills();

      expect(Object.keys(Object)).not.toContain('hasOwn');
    });
  });

  it('defines Array.prototype.at where the browser lacks it', () => {
    withoutNatives(() => {
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
  });

  it('leaves a native built-in in place', () => {
    installPolyfills();

    expect(Object.hasOwn).toBe(nativeHasOwn);
    expect(Array.prototype.at).toBe(nativeAt);
  });

  // CI run 44784791634 (main, 545d525c): Vitest's own RPC proxy calls
  // `Object.hasOwn` when it reports a hook's state, from `callSuiteHook`. A
  // native removed in `beforeEach` stays removed while the runner runs between
  // the hook and the test, and the run ended with "TypeError: Object.hasOwn is
  // not a function" as an unhandled error, failing the job with every test
  // green. The runner must find both natives in place whenever it has control.
  it('leaves the natives to the runner between the hooks and the test', () => {
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

    withoutNatives(() => {
      expect(() => installPolyfills()).not.toThrow();
    });

    expect(consoleError).toHaveBeenCalledWith('Failed to polyfill hasOwn:', refusal);
    expect(consoleError).toHaveBeenCalledWith('Failed to polyfill at:', refusal);
  });
});
