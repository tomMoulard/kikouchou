/**
 * @fileoverview A `localStorage` double for the suite, which has none.
 *
 * jsdom as configured here exposes no `localStorage` at all, so a test that
 * merely calls `localStorage.clear()` fails with "Cannot read properties of
 * undefined". Three test files already carry their own hand-rolled double for
 * that; this is the same object with one definition, so a new test does not
 * become the fourth copy.
 *
 * @module test/local-storage
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Handle on the installed double.
 */
export interface LocalStorageDouble {
  /** The backing entries, for assertions on what was written. */
  readonly entries: Map<string, string>;
  /** Makes every write throw, as a full quota or a locked store does. */
  readonly setThrowing: (throws: boolean) => void;
  /** Empties the store, for a `beforeEach`. */
  readonly clear: () => void;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Installs a working `localStorage` on `globalThis` for this test file.
 *
 * Call it at module scope: the app code under test reads storage during render,
 * so the property has to exist before the first one.
 *
 * @returns The handle on the store
 *
 * @example
 * ```ts
 * const storage = installLocalStorageDouble();
 * beforeEach(() => { storage.clear(); });
 * ```
 */
export function installLocalStorageDouble(): LocalStorageDouble {
  const entries = new Map<string, string>();
  let storageThrows = false;

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      get length(): number {
        return entries.size;
      },
      clear: (): void => entries.clear(),
      getItem: (key: string): string | null => entries.get(key) ?? null,
      key: (index: number): string | null => [...entries.keys()][index] ?? null,
      removeItem: (key: string): void => {
        if (storageThrows) {
          throw new DOMException('QuotaExceededError');
        }
        entries.delete(key);
      },
      setItem: (key: string, value: string): void => {
        if (storageThrows) {
          throw new DOMException('QuotaExceededError');
        }
        entries.set(key, value);
      },
    } satisfies Storage,
  });

  return {
    entries,
    setThrowing: (throws: boolean): void => {
      storageThrows = throws;
    },
    clear: (): void => entries.clear(),
  };
}
