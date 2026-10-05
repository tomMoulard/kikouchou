/**
 * @fileoverview Recovers a session whose lazy chunks the origin no longer has.
 *
 * A deploy replaces every hashed file under `assets/`, and `cleanupOutdatedCaches`
 * drops the precache of the build that is being replaced. A tab that booted on
 * the old build and has not reloaded therefore asks for a chunk name nothing
 * serves any more, and `import()` rejects — on 2026-09-14 a session on
 * `65a0474` asked for `assets/TripEditPage-CfPSMXkw.js` three days later and
 * got a 404. `update-check.ts` narrows the window; it cannot close it, because
 * the new worker still needs a moment to activate after a navigation.
 *
 * Only a reload recovers: React caches the rejected promise on the
 * module-level `lazy()` reference forever, so re-rendering re-throws the
 * identical error.
 *
 * The reload is therefore taken automatically, and at most once per
 * {@link STALE_CHUNK_RELOAD_COOLDOWN_MS}. The guard is what makes this safe: a
 * chunk that is missing from the *new* build too — a broken deploy, a proxy
 * serving a truncated `index.html` — would otherwise reload the tab forever,
 * which is a worse failure than the error screen it replaces. When the reload
 * is held back the boundary keeps its fallback on screen and the user still has
 * the retry button.
 *
 * @module lib/pwa/stale-chunk
 */

// ============================================================================
// Constants
// ============================================================================

/** Where the timestamp of the last automatic reload is kept. */
export const STALE_CHUNK_RELOAD_KEY = 'kikouchou:stale-chunk-reload',
  /**
   * How long one automatic reload suppresses the next.
   *
   * Long enough to cover boot and the first navigation of the reloaded tab, so
   * a chunk that is missing on both builds shows the fallback instead of
   * looping. Short enough that a session which is still open at the *next*
   * deploy heals itself again rather than being stuck for good.
   */
  STALE_CHUNK_RELOAD_COOLDOWN_MS = 30_000,
  /**
   * How a failed dynamic `import()` reads, per engine.
   *
   * Chrome says "Failed to fetch dynamically imported module", Safari
   * "Importing a module script failed", Firefox "error loading dynamically
   * imported module"; bundler-level wrappers add a chunk-load error of their
   * own. All are matched lower-cased.
   *
   * A chunk brings its stylesheet with it, and that half fails on its own
   * wording: Vite's preload helper rejects with "Unable to preload CSS for
   * <href>" when the `<link>` it inserted errors. It is the same failure with
   * the same cure, and it used to fall through — see the 2026-09-20 session in
   * PostHog issue `01a0be39-9bb1-7792-ad03-63460ab2f2fe`, where the Leaflet
   * stylesheet and a `vendor-supabase` import failed 129 ms apart and only the
   * second one reloaded.
   */
  MODULE_LOAD_NEEDLES = [
    'dynamically imported module',
    'importing a module script failed',
    'failed to fetch dynamically',
    'error loading chunk',
    'chunkloaderror',
    'unable to preload css',
  ] as const;

/**
 * What {@link tryReloadForStaleChunk} did, and why when it held back.
 *
 * Reported with a stale chunk the reload did not cure, because the reasons
 * mean different things. `cooldown` is a chunk still missing one reload later,
 * which is a broken deploy. `no_storage` and `storage_error` are a browser
 * that cannot hold the guard, such as a private window, where the reload was
 * never tried.
 */
export const STALE_CHUNK_RELOAD_OUTCOMES = {
  reloaded: 'reloaded',
  noStorage: 'no_storage',
  storageError: 'storage_error',
  cooldown: 'cooldown',
} as const;

// ============================================================================
// Type Definitions
// ============================================================================

/** One of {@link STALE_CHUNK_RELOAD_OUTCOMES}. */
export type StaleChunkReloadOutcome =
  (typeof STALE_CHUNK_RELOAD_OUTCOMES)[keyof typeof STALE_CHUNK_RELOAD_OUTCOMES];

/**
 * The environment {@link tryReloadForStaleChunk} touches, injectable for tests.
 */
export interface StaleChunkReloadDeps {
  /** Where the guard is recorded. Defaults to `sessionStorage`. */
  readonly storage?: Storage | undefined;
  /** Current time in milliseconds. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** How the tab is reloaded. Defaults to `window.location.reload`. */
  readonly reload?: () => void;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Whether an error is a failed dynamic `import()` of an app chunk.
 *
 * @param error - The caught error, if any
 * @returns True when a reload is the only way to recover
 */
export function isModuleLoadError(error: Error | null | undefined): boolean {
  if (!error) return false;
  const message = `${error.name} ${error.message}`.toLowerCase();
  return MODULE_LOAD_NEEDLES.some((needle) => message.includes(needle));
}

/**
 * Reloads the tab onto the current build, at most once per cooldown.
 *
 * Declining is the safe answer, so every reason to doubt the guard — no
 * session storage, a store that throws, a reload recorded a moment ago —
 * holds the reload back and leaves the caller's fallback UI on screen. The
 * outcome says which of them it was.
 *
 * @param deps - Overrides for the environment, for tests
 * @returns `reloaded` when a reload was started, otherwise why it was not
 */
export function tryReloadForStaleChunk(
  deps: StaleChunkReloadDeps = {},
): StaleChunkReloadOutcome {
  const storage = 'storage' in deps ? deps.storage : sessionStorageOrUndefined();
  if (!storage) return STALE_CHUNK_RELOAD_OUTCOMES.noStorage;

  const now = deps.now ? deps.now() : Date.now();

  let previous: string | null;
  try {
    previous = storage.getItem(STALE_CHUNK_RELOAD_KEY);
  } catch {
    return STALE_CHUNK_RELOAD_OUTCOMES.storageError;
  }

  if (previous !== null) {
    const at = Number.parseInt(previous, 10);
    // `Math.abs` rather than `now - at`: a clock that has gone backwards since
    // the record was written must still hold the reload, not free it.
    if (Number.isFinite(at) && Math.abs(now - at) < STALE_CHUNK_RELOAD_COOLDOWN_MS) {
      return STALE_CHUNK_RELOAD_OUTCOMES.cooldown;
    }
  }

  try {
    storage.setItem(STALE_CHUNK_RELOAD_KEY, String(now));
  } catch {
    // Without a record there is no guard, and without a guard a reload can
    // loop. An error screen is the better failure.
    return STALE_CHUNK_RELOAD_OUTCOMES.storageError;
  }

  if (deps.reload) {
    deps.reload();
  } else {
    window.location.reload();
  }
  return STALE_CHUNK_RELOAD_OUTCOMES.reloaded;
}

/**
 * {@link tryReloadForStaleChunk}, for a caller that only needs to know whether
 * the tab is going away.
 *
 * @param deps - Overrides for the environment, for tests
 * @returns True when a reload was started
 */
export function reloadForStaleChunk(deps: StaleChunkReloadDeps = {}): boolean {
  return tryReloadForStaleChunk(deps) === STALE_CHUNK_RELOAD_OUTCOMES.reloaded;
}

/**
 * `createRoot`'s `onCaughtError`: React's own logging, minus stale chunks.
 *
 * React 19 logs every error a boundary catches with `console.error`, and
 * `capture_console_errors` turns that line into a second, "unhandled" copy of
 * what the boundary reports or recovers from. For a stale chunk the boundary
 * reloads the tab and the log line is the only report left, so it is dropped
 * here. Every other error keeps its log.
 *
 * @param error - What the boundary caught
 * @param errorInfo - Where in the tree it was thrown
 */
export function logCaughtError(
  error: unknown,
  errorInfo: { readonly componentStack?: string | null | undefined },
): void {
  if (error instanceof Error && isModuleLoadError(error)) return;
  console.error(error, errorInfo.componentStack ?? '');
}

// ============================================================================
// Internals
// ============================================================================

/**
 * `sessionStorage`, or undefined where reading it is not allowed.
 *
 * The property getter itself throws when site data is blocked, which is why
 * this is not a plain optional chain.
 *
 * @returns The store, or undefined
 */
function sessionStorageOrUndefined(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}
