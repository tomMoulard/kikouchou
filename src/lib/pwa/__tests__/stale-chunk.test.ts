/**
 * @fileoverview Tests for the stale-chunk recovery helper.
 *
 * The behaviour under test is the one seen in production on 2026-09-14: a
 * session booted on build `65a0474` asked for `assets/TripEditPage-CfPSMXkw.js`
 * three days and 47 deploys later, and the origin answered 404. Recovery is a
 * reload — the interesting part is that it must happen at most once, because a
 * chunk that is missing on the new build too would otherwise reload forever.
 *
 * @module lib/pwa/__tests__/stale-chunk.test
 */

import { describe, expect, it, vi } from 'vitest';

import {
  STALE_CHUNK_RELOAD_COOLDOWN_MS,
  STALE_CHUNK_RELOAD_KEY,
  isModuleLoadError,
  reloadForStaleChunk,
} from '@/lib/pwa/stale-chunk';

// ============================================================================
// Test Helpers
// ============================================================================

/** A `Storage` backed by a map, optionally broken the way a locked store is. */
function fakeStorage(
  entries = new Map<string, string>(),
  broken = false,
): Storage {
  return {
    get length(): number {
      return entries.size;
    },
    clear: (): void => entries.clear(),
    getItem: (key: string): string | null => {
      if (broken) throw new DOMException('SecurityError');
      return entries.get(key) ?? null;
    },
    key: (index: number): string | null => [...entries.keys()][index] ?? null,
    removeItem: (key: string): void => {
      entries.delete(key);
    },
    setItem: (key: string, value: string): void => {
      if (broken) throw new DOMException('SecurityError');
      entries.set(key, value);
    },
  } satisfies Storage;
}

// ============================================================================
// Tests
// ============================================================================

describe('isModuleLoadError', () => {
  it('recognises the message Chrome throws for a missing chunk', () => {
    const error = new TypeError(
      'Failed to fetch dynamically imported module: https://app.kikouchou.app/assets/TripEditPage-CfPSMXkw.js',
    );

    expect(isModuleLoadError(error)).toBe(true);
  });

  it('recognises the Safari and Firefox wordings', () => {
    expect(
      isModuleLoadError(new TypeError('Importing a module script failed.')),
    ).toBe(true);
    expect(
      isModuleLoadError(new Error('error loading dynamically imported module')),
    ).toBe(true);
  });

  /**
   * PostHog issue `01a0be39-9bb1-7792-ad03-63460ab2f2fe`, seen twice on build
   * `d7ae137`: a mobile session lost the network for a moment while the lazy
   * Leaflet chunk loaded, and Vite's preload helper rejected with this
   * message. The stylesheet was still served with a 200 minutes later, and in
   * one of the two sessions a dynamic `import()` of `vendor-supabase` failed
   * 129 ms later. That second message matched, so it reloaded; this one did
   * not, so the error boundary kept its fallback on screen for good.
   *
   * RED before the fix: `expected false to be true`.
   */
  it('recognises the message Vite throws for a stylesheet preload', () => {
    const error = new Error(
      'Unable to preload CSS for /assets/leaflet-CIGW-MKW.css',
    );

    expect(isModuleLoadError(error)).toBe(true);
  });

  it('leaves an ordinary application error alone', () => {
    expect(isModuleLoadError(new Error('Trip not found'))).toBe(false);
  });

  it('is false without an error', () => {
    expect(isModuleLoadError(null)).toBe(false);
    expect(isModuleLoadError(undefined)).toBe(false);
  });
});

describe('reloadForStaleChunk', () => {
  it('reloads and records when the tab has not reloaded yet', () => {
    const entries = new Map<string, string>(),
      reload = vi.fn();

    const reloaded = reloadForStaleChunk({
      storage: fakeStorage(entries),
      now: () => 1_000,
      reload,
    });

    expect(reloaded).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(entries.get(STALE_CHUNK_RELOAD_KEY)).toBe('1000');
  });

  it('does not reload twice inside the cooldown', () => {
    const entries = new Map([[STALE_CHUNK_RELOAD_KEY, '1000']]),
      reload = vi.fn();

    const reloaded = reloadForStaleChunk({
      storage: fakeStorage(entries),
      now: () => 1_000 + STALE_CHUNK_RELOAD_COOLDOWN_MS - 1,
      reload,
    });

    expect(reloaded).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads again once the cooldown has passed', () => {
    const entries = new Map([[STALE_CHUNK_RELOAD_KEY, '1000']]),
      reload = vi.fn();

    const reloaded = reloadForStaleChunk({
      storage: fakeStorage(entries),
      now: () => 1_000 + STALE_CHUNK_RELOAD_COOLDOWN_MS,
      reload,
    });

    expect(reloaded).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(entries.get(STALE_CHUNK_RELOAD_KEY)).toBe(
      String(1_000 + STALE_CHUNK_RELOAD_COOLDOWN_MS),
    );
  });

  it('holds a reload written by a clock that has since gone backwards', () => {
    const entries = new Map([[STALE_CHUNK_RELOAD_KEY, '10000']]),
      reload = vi.fn();

    const reloaded = reloadForStaleChunk({
      storage: fakeStorage(entries),
      now: () => 9_000,
      reload,
    });

    expect(reloaded).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload when the store is unusable', () => {
    const reload = vi.fn();

    const reloaded = reloadForStaleChunk({
      storage: fakeStorage(new Map(), true),
      now: () => 1_000,
      reload,
    });

    expect(reloaded).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload without a store at all', () => {
    const reload = vi.fn();

    const reloaded = reloadForStaleChunk({
      storage: undefined,
      now: () => 1_000,
      reload,
    });

    expect(reloaded).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('ignores a record it cannot read as a timestamp', () => {
    const entries = new Map([[STALE_CHUNK_RELOAD_KEY, 'yesterday']]),
      reload = vi.fn();

    expect(
      reloadForStaleChunk({
        storage: fakeStorage(entries),
        now: () => 1_000,
        reload,
      }),
    ).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
