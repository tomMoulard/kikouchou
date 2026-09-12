/**
 * @fileoverview Asks the server whether a newer build exists.
 *
 * A browser re-fetches `sw.js` when it navigates, and otherwise at most about
 * once a day. An installed PWA that is never closed therefore keeps executing
 * the bundle it booted with for as long as it stays open, however many times
 * `main` has been deployed in the meantime — `registerType: 'autoUpdate'` can
 * only act on an update it has been told about.
 *
 * That is not cosmetic staleness. It is how a code path deleted from `main`
 * kept throwing in production: the WebRTC transport was retired on 2026-08-31,
 * and `y-webrtc`'s `A Yjs Doc connected to room "…" already exists!` was still
 * arriving from real sessions a day later, out of an `assets/vendor-yjs-*.js`
 * the origin had long stopped serving. `cleanupOutdatedCaches` makes it worse
 * than stale: once the new worker activates, the previous precache is dropped,
 * and the old hashed chunks now 404 — so a session that has not reloaded can
 * no longer lazy-load a route it has not already visited.
 *
 * Checks are aimed at the moment a reload is free. Every edit is persisted
 * through the Yjs/Dexie bridge as it happens, so a reload costs only transient
 * UI state such as a half-filled dialog; running the check as the tab goes away
 * means the reload that follows happens off-screen. The interval is the
 * backstop for a session that is never hidden at all.
 *
 * @module lib/pwa/update-check
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * How often a permanently-visible session re-checks.
 *
 * Long on purpose: the visibility check is what catches almost everybody, and
 * this only has to be shorter than the time a tab can plausibly stay in the
 * foreground.
 */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The one thing wanted from a `ServiceWorkerRegistration`.
 *
 * Narrowed so the caller can be tested without a service worker, which jsdom
 * has no implementation of.
 */
export interface UpdatableRegistration {
  readonly update: () => Promise<unknown>;
}

// ============================================================================
// Watcher
// ============================================================================

/**
 * Starts checking for a new service worker.
 *
 * Finding one is all this does. Acting on it belongs to the registration:
 * under `registerType: 'autoUpdate'` the worker skips waiting, claims the
 * clients, and `virtual:pwa-register` reloads the page once it has activated.
 *
 * @param registration - The registration to poll.
 * @returns A function that stops the checks.
 */
export function watchForUpdates(registration: UpdatableRegistration): () => void {
  const check = (): void => {
    // `update()` rejects offline, and there is nothing to discover anyway.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }

    void Promise.resolve(registration.update()).catch(() => {
      // A failed check is not worth reporting anywhere: the app is entirely
      // usable on the build it already has, and the next check is coming.
    });
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      check();
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    clearInterval(timer);
  };
}
