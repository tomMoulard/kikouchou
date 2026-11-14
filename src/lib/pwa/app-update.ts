/**
 * @fileoverview The "Check for updates" button in Settings: find a newer
 * build and move onto it now, on every target.
 *
 * The app already updates on its own. The service worker checks each hour and
 * whenever the tab is hidden (`update-check`), and a store app stages a newer
 * bundle for its next launch (`lib/native/live-update`). Neither reloads a
 * screen somebody is looking at, which is right for a check nobody asked for
 * and wrong for one somebody did. A person who taps the button wants the new
 * build in front of them, so this is the one path that reloads on purpose.
 *
 * Two actions, because one is gentle and the other always works:
 *
 * - {@link checkForAppUpdate} asks for a newer build and reloads onto it when
 *   there is one. On the web it goes through the same function as the
 *   stale-route recovery (`moveToNewerBuild`); in a store app it goes through
 *   the live update plugin.
 * - {@link reloadFromServer} is the web's fallback for a worker that is stuck,
 *   or a check that found nothing the person believes. It unregisters every
 *   service worker, empties Cache Storage, and reloads from the network. The
 *   trips are in IndexedDB and the preferences in localStorage, and neither is
 *   touched. It refuses to run offline: with the worker and its precache gone,
 *   a reload without a network shows the browser's own error page and no app.
 *
 * @module lib/pwa/app-update
 */

import { applyLiveUpdateNow, canLiveUpdate } from '@/lib/native/live-update';
import { isNativeApp } from '@/lib/platform';

import { moveToNewerBuild, type StaleBuildOptions } from './stale-build';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * How a tap on "Check for updates" ended.
 *
 * - `offline`: no network, so nothing was asked.
 * - `current`: no newer build exists.
 * - `installing`: a newer service worker was found and is still installing.
 *   `registerType: 'autoUpdate'` reloads the page once it activates.
 * - `failed`: the check itself failed.
 * - `reloading`: the page is being replaced by the newer build.
 */
export type AppUpdateOutcome = 'offline' | 'current' | 'installing' | 'failed' | 'reloading';

/** The part of `CacheStorage` the hard reload needs. */
export interface ClearableCaches {
  readonly keys: () => Promise<string[]>;
  readonly delete: (name: string) => Promise<boolean>;
}

/** The part of `ServiceWorkerContainer` the hard reload needs. */
export interface UnregistrableContainer {
  readonly getRegistrations: () => Promise<readonly { readonly unregister: () => Promise<boolean> }[]>;
}

/** Everything {@link reloadFromServer} reads from the browser. */
export interface ReloadFromServerOptions {
  readonly online?: boolean;
  readonly container?: UnregistrableContainer | null;
  readonly caches?: ClearableCaches | null;
  readonly reload?: () => void;
}

/** Everything {@link checkForAppUpdate} reads from outside. */
export interface CheckForAppUpdateOptions extends StaleBuildOptions {
  readonly online?: boolean;
  /** Whether to go through the store app's live update instead of the worker. */
  readonly native?: boolean;
  readonly applyLiveUpdate?: typeof applyLiveUpdateNow;
}

// ============================================================================
// Helpers
// ============================================================================

/** `navigator.onLine`, read as "online" where the browser does not say. */
function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** `navigator.serviceWorker`, or null on an insecure origin and in jsdom. */
function browserContainer(): UnregistrableContainer | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  return navigator.serviceWorker;
}

/** `window.caches`, or null where Cache Storage does not exist. */
function browserCaches(): ClearableCaches | null {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return null;
  }
  return window.caches;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Whether the hard reload makes sense here. A store app has no service worker
 * and loads its files from inside the app, so only the web offers it.
 */
export function canReloadFromServer(): boolean {
  return !isNativeApp();
}

/**
 * Whether this target can check for an update at all. The website always can.
 * A store app can when it has the live update plugin, which the F-Droid build
 * leaves out.
 */
export function canCheckForAppUpdate(): boolean {
  return !isNativeApp() || canLiveUpdate();
}

/**
 * Looks for a newer build and moves onto it now.
 *
 * @param options - The browser pieces to use, for tests that have none
 * @returns How it ended; only `reloading` replaces the page
 */
export async function checkForAppUpdate(
  options: CheckForAppUpdateOptions = {},
): Promise<AppUpdateOutcome> {
  const {
    online = isOnline(),
    native = isNativeApp(),
    applyLiveUpdate = applyLiveUpdateNow,
    ...workerOptions
  } = options;

  if (!online) {
    return 'offline';
  }

  if (native) {
    const outcome = await applyLiveUpdate();
    if (outcome === 'reloading' || outcome === 'current') {
      return outcome;
    }
    return 'failed';
  }

  const outcome = await moveToNewerBuild(workerOptions);
  switch (outcome) {
    case 'reloading':
      return 'reloading';
    case 'timeout':
      return 'installing';
    case 'failed':
      return 'failed';
    // No worker controls the page, so the network served the build that runs.
    // There is nothing newer to move onto without a reload, which the hard
    // reload offers next to this answer.
    case 'no-worker':
    case 'current':
      return 'current';
  }
}

/**
 * Drops the service worker and its caches, then reloads from the network.
 *
 * Each step is best effort: a registration that refuses to unregister, or a
 * cache that refuses to go, does not stop the others or the reload. The reload
 * still reaches the network for anything the precache no longer holds.
 *
 * @param options - The browser pieces to use, for tests that have none
 * @returns `false` when it refused to run because there is no network
 */
export async function reloadFromServer(options: ReloadFromServerOptions = {}): Promise<boolean> {
  const {
    online = isOnline(),
    container = browserContainer(),
    caches = browserCaches(),
    reload = () => {
      window.location.reload();
    },
  } = options;

  if (!online) {
    return false;
  }

  if (container) {
    try {
      const registrations = await container.getRegistrations();
      await Promise.allSettled(registrations.map((registration) => registration.unregister()));
    } catch (error) {
      console.warn('[pwa] could not unregister the service worker:', error);
    }
  }

  if (caches) {
    try {
      const names = await caches.keys();
      await Promise.allSettled(names.map((name) => caches.delete(name)));
    } catch (error) {
      console.warn('[pwa] could not clear the caches:', error);
    }
  }

  reload();
  return true;
}
