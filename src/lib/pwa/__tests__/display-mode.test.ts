/**
 * @fileoverview `lib/pwa/display-mode` — the one place that says "installed".
 *
 * @module lib/pwa/__tests__/display-mode.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isRunningStandalone, readDisplayMode } from '@/lib/pwa/display-mode';

// ============================================================================
// Helpers
// ============================================================================

/** Makes `matchMedia` answer the standalone query the given way. */
function withStandaloneQuery(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(display-mode: standalone)' ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  // `navigator.standalone` is set per test and must not leak into the next one.
  Reflect.deleteProperty(navigator, 'standalone');
});

// ============================================================================
// Tests
// ============================================================================

describe('readDisplayMode', () => {
  it('reports a browser tab when nothing says otherwise', () => {
    withStandaloneQuery(false);

    expect(readDisplayMode()).toBe('browser');
    expect(isRunningStandalone()).toBe(false);
  });

  it('reports standalone when the display-mode query matches', () => {
    withStandaloneQuery(true);

    expect(readDisplayMode()).toBe('standalone');
    expect(isRunningStandalone()).toBe(true);
  });

  it("reports standalone from iOS Safari's own flag when the query does not match", () => {
    withStandaloneQuery(false);
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });

    expect(readDisplayMode()).toBe('standalone');
  });

  it('treats a matchMedia that throws as a browser tab rather than crashing', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => {
        throw new TypeError('not implemented');
      }),
    );

    // Read at import time by `lib/posthog`, so a throw here would blank the app.
    expect(readDisplayMode()).toBe('browser');
  });

  it('treats a missing matchMedia as a browser tab', () => {
    vi.stubGlobal('matchMedia', undefined);

    expect(readDisplayMode()).toBe('browser');
  });
});
