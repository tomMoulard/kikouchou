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

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STALE_CHUNK_RELOAD_COOLDOWN_MS,
  STALE_CHUNK_RELOAD_KEY,
  isModuleLoadError,
  logCaughtError,
  reloadForStaleChunk,
  resetStaleChunkReloadForTests,
  staleChunkReportContext,
  tryReloadForStaleChunk,
} from '@/lib/pwa/stale-chunk';

// ============================================================================
// Test doubles
// ============================================================================

/** Whether the code under test runs as a store app. */
const platform = vi.hoisted(() => ({ native: false }));
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  isNativeApp: () => platform.native,
}));

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

// The reload this document started is held in module state, so no test may
// inherit one from the test before it.
beforeEach(() => {
  resetStaleChunkReloadForTests();
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

// PostHog issue 01a0edf6: a declined reload was reported with no reason, so a
// broken deploy and a browser that cannot hold the guard read the same.
describe('tryReloadForStaleChunk', () => {
  it('says reloaded when the reload went ahead', () => {
    expect(
      tryReloadForStaleChunk({ storage: fakeStorage(), now: () => 1_000, reload: vi.fn() }),
    ).toBe('reloaded');
  });

  it('says cooldown when a reload already ran a moment ago', () => {
    const entries = new Map([[STALE_CHUNK_RELOAD_KEY, '1000']]);

    expect(
      tryReloadForStaleChunk({ storage: fakeStorage(entries), now: () => 2_000, reload: vi.fn() }),
    ).toBe('cooldown');
  });

  it('says no_storage without a store', () => {
    expect(tryReloadForStaleChunk({ storage: undefined, reload: vi.fn() })).toBe('no_storage');
  });

  it('says storage_error when the store throws on read', () => {
    expect(
      tryReloadForStaleChunk({ storage: fakeStorage(new Map(), true), reload: vi.fn() }),
    ).toBe('storage_error');
  });

  it('says storage_error when the store reads but cannot record', () => {
    const storage = fakeStorage();
    storage.setItem = (): void => {
      throw new DOMException('QuotaExceededError');
    };
    const reload = vi.fn();

    expect(tryReloadForStaleChunk({ storage, now: () => 1_000, reload })).toBe('storage_error');
    expect(reload).not.toHaveBeenCalled();
  });

  /**
   * The 2026-10-03 report: a trip list where every card wraps its lazy map
   * preview in its own boundary. The first card started the reload, and the
   * next one found that reload's record and filed the stale chunk as if a
   * reload had failed to cure it.
   */
  it('says reloaded to a second catch while its own reload is under way', () => {
    const reload = vi.fn(),
      deps = { storage: fakeStorage(), now: () => 1_000, reload };

    expect(tryReloadForStaleChunk(deps)).toBe('reloaded');
    expect(tryReloadForStaleChunk(deps)).toBe('reloaded');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still holds back the reload in the next document', () => {
    const entries = new Map<string, string>(),
      reload = vi.fn();

    tryReloadForStaleChunk({ storage: fakeStorage(entries), now: () => 1_000, reload });
    resetStaleChunkReloadForTests();

    expect(
      tryReloadForStaleChunk({ storage: fakeStorage(entries), now: () => 2_000, reload }),
    ).toBe('cooldown');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // A `beforeunload` prompt can cancel the reload, and the document lives on.
  it('reloads again once a reload that never happened is a cooldown old', () => {
    const entries = new Map<string, string>(),
      reload = vi.fn();

    tryReloadForStaleChunk({ storage: fakeStorage(entries), now: () => 1_000, reload });

    expect(
      tryReloadForStaleChunk({
        storage: fakeStorage(entries),
        now: () => 1_000 + STALE_CHUNK_RELOAD_COOLDOWN_MS,
        reload,
      }),
    ).toBe('reloaded');
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

/**
 * A reload with no network and no service worker to answer it does not land
 * on a newer build: it lands on the browser's own offline page, and costs the
 * user the app they had on screen. It is also not a fault anybody can fix, so
 * nothing about it is reported either.
 */
describe('tryReloadForStaleChunk while offline', () => {
  it('says offline, and neither reloads nor records, with no worker to answer', () => {
    const entries = new Map<string, string>(),
      reload = vi.fn();

    expect(
      tryReloadForStaleChunk({
        storage: fakeStorage(entries),
        now: () => 1_000,
        reload,
        isOnline: () => false,
        isControlled: () => false,
      }),
    ).toBe('offline');
    expect(reload).not.toHaveBeenCalled();
    expect(entries.has(STALE_CHUNK_RELOAD_KEY)).toBe(false);
  });

  // The worker answers the reload from its precache, which holds the build
  // it installed: that is the cure, network or not.
  it('still reloads offline when a service worker controls the page', () => {
    const reload = vi.fn();

    expect(
      tryReloadForStaleChunk({
        storage: fakeStorage(),
        now: () => 1_000,
        reload,
        isOnline: () => false,
        isControlled: () => true,
      }),
    ).toBe('reloaded');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // The store apps register no worker: their files are on the device, so a
  // reload there needs no network either, and can roll a bad bundle back.
  it('still reloads offline in a store app', () => {
    platform.native = true;
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false),
      reload = vi.fn();
    try {
      expect(tryReloadForStaleChunk({ storage: fakeStorage(), now: () => 1_000, reload })).toBe(
        'reloaded',
      );
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      platform.native = false;
      onLine.mockRestore();
    }
  });
});

/**
 * The 2026-11-09 session (iOS Chrome, build 63f465aa): one reload had already
 * run, the chunk still would not load, and the same failure was filed three
 * times in two seconds: by `AuthContext`, by a route's boundary, and as an
 * unhandled error from the pet's lazy chunk. One failure is one report.
 */
describe('staleChunkReportContext', () => {
  const SAFARI = 'Importing a module script failed.';

  it('reports nothing for a reload that went ahead', () => {
    expect(staleChunkReportContext(new TypeError(SAFARI), 'reloaded')).toBeNull();
  });

  it('reports nothing for a failure that is only the network being down', () => {
    expect(staleChunkReportContext(new TypeError(SAFARI), 'offline')).toBeNull();
  });

  it('reports a reload that did not cure the tab, with the reason', () => {
    expect(staleChunkReportContext(new TypeError(SAFARI), 'cooldown')).toEqual({
      stale_chunk: true,
      reload_declined: 'cooldown',
    });
  });

  it('reports the same failure once per document', () => {
    expect(staleChunkReportContext(new TypeError(SAFARI), 'cooldown')).not.toBeNull();
    expect(staleChunkReportContext(new TypeError(SAFARI), 'cooldown')).toBeNull();
  });

  // Safari names no chunk, so the reason is what tells a broken deploy from a
  // browser that cannot hold the guard: neither may hide the other.
  it('still reports the same wording held back for another reason', () => {
    expect(staleChunkReportContext(new TypeError(SAFARI), 'no_storage')).not.toBeNull();
    expect(staleChunkReportContext(new TypeError(SAFARI), 'cooldown')).not.toBeNull();
  });

  // A controlled page reloads offline; a chunk its precache lacks then fails
  // again as `cooldown`, which is the network, not a broken deploy.
  it('reports nothing while the browser says it is offline', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      expect(staleChunkReportContext(new TypeError(SAFARI), 'cooldown')).toBeNull();
    } finally {
      onLine.mockRestore();
    }
  });

  // Chrome names the chunk, so two chunks are two failures worth knowing.
  it('still reports a different chunk', () => {
    const chunk = (name: string): TypeError =>
      new TypeError(
        `Failed to fetch dynamically imported module: https://app.kikouchou.app/assets/${name}.js`,
      );

    expect(staleChunkReportContext(chunk('SignInPage-F004ZNhA'), 'cooldown')).not.toBeNull();
    expect(staleChunkReportContext(chunk('vendor-supabase-uUMQlnk1'), 'cooldown')).not.toBeNull();
  });
});

describe('logCaughtError', () => {
  // React 19 logs what a boundary caught with console.error, and PostHog's
  // console capture turned that line into an "unhandled" twin of every stale
  // chunk the boundary had already reloaded away (issue 01a0a104).
  it('says nothing about a stale chunk the boundary reloads away', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      logCaughtError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://app.kikouchou.app/assets/TripEditPage-CfPSMXkw.js',
        ),
        { componentStack: '\n    at TripEditPage' },
      );

      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps logging every other error with its component stack', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const error = new Error('Trip not found');
      logCaughtError(error, { componentStack: '\n    at TripPage' });
      logCaughtError('a thrown string', {});

      expect(consoleError).toHaveBeenNthCalledWith(1, error, '\n    at TripPage');
      expect(consoleError).toHaveBeenNthCalledWith(2, 'a thrown string', '');
    } finally {
      consoleError.mockRestore();
    }
  });
});
