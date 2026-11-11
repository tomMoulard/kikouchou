/**
 * @fileoverview The ES2022 built-ins that the bundle calls and an old Android
 * WebView does not have.
 *
 * Vite compiles syntax for modern browsers and adds no polyfills, and the
 * Android app installs from `minSdkVersion = 24`, where the system WebView can
 * be Chrome 90. There `react-markdown` threw "Object.hasOwn is not a function"
 * on every render (Chrome 93), so the trip form, the trip description card,
 * the template page and the assistant all crashed. `Array.prototype.at`
 * (Chrome 92) is called by the room repository and the assistant's markdown.
 *
 * `main.tsx` imports this module first. Like everything at that level it must
 * never throw: a throw here blanks the app on every browser, old or new.
 *
 * @module lib/polyfills
 */

// ============================================================================
// Polyfills
// ============================================================================

function define(target: object, name: string, value: unknown): void {
  try {
    if (!(name in target)) {
      Object.defineProperty(target, name, {
        value,
        configurable: true,
        writable: true,
      });
    }
  } catch (error) {
    console.error(`Failed to polyfill ${name}:`, error);
  }
}

/**
 * Defines each missing built-in. Exported for the tests: a test that removed a
 * native and re-imported this module ran the test runner's own module loader
 * without it, and Vitest 5's loader calls both.
 */
export function installPolyfills(): void {
  define(Object, 'hasOwn', function hasOwn(object: object, key: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(object, key);
  });

  define(Array.prototype, 'at', function at<T>(this: readonly T[], index: number): T | undefined {
    const integer = Math.trunc(index) || 0;
    return this[integer < 0 ? this.length + integer : integer];
  });
}

installPolyfills();
