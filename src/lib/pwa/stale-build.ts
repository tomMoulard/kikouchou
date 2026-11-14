/**
 * @fileoverview Tells a route the running build does not know from one that
 * does not exist.
 *
 * The service worker precaches `index.html` and answers every navigation from
 * it, so a device keeps executing the build it installed until a new worker has
 * activated. A link to a route that shipped after that build therefore arrives
 * at a router which has never heard of it, and the catch-all renders "page not
 * found" over a path the origin serves correctly. That is what a template link
 * did: `/template/<token>` matched nothing, and the visitor got the error page
 * inside the app chrome, with whatever trip they had open still named in the
 * header.
 *
 * Reloading does not fix it. The reload is a navigation, and the same worker
 * answers it from the same precached `index.html`. The only thing that helps is
 * a newer worker, so that is what this asks for.
 *
 * The check is cheap and self-limiting. A path that is genuinely wrong finds no
 * update and falls through to the error page on the first try, and a path that
 * was merely too new reloads once onto a build that has it.
 *
 * @module lib/pwa/stale-build
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * How long a newly found worker is given to take over.
 *
 * Long enough for a worker to install its precache on a phone connection, short
 * enough that nobody reads it as a hung screen. A visitor who waits this out
 * gets the error page, and the update lands on their next navigation anyway.
 */
export const STALE_BUILD_TIMEOUT_MS = 8000;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The part of a `ServiceWorkerRegistration` this needs.
 *
 * `installing` and `waiting` are the whole answer to "is there a newer build":
 * either is non-null exactly when `update()` found one.
 */
export interface StaleBuildRegistration {
  readonly update: () => Promise<unknown>;
  readonly installing: unknown;
  readonly waiting: unknown;
}

/**
 * The part of a `ServiceWorkerContainer` this needs.
 *
 * Narrowed so the caller can be tested without a service worker, which jsdom
 * has no implementation of.
 */
export interface StaleBuildContainer {
  readonly controller: unknown;
  readonly getRegistration: () => Promise<StaleBuildRegistration | null | undefined>;
  readonly addEventListener: (type: 'controllerchange', listener: () => void) => void;
  readonly removeEventListener: (type: 'controllerchange', listener: () => void) => void;
}

/** Everything the browser supplies, so a test can supply it instead. */
export interface StaleBuildOptions {
  /** `navigator.serviceWorker`, or null where there is none. */
  readonly container?: StaleBuildContainer | null;
  /** What to do once a newer worker has taken over. */
  readonly reload?: () => void;
  /** How long to wait for that. */
  readonly timeoutMs?: number;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * `navigator.serviceWorker` when this browser has one.
 *
 * Read through a guard rather than a type assertion: the property is absent on
 * an insecure origin and in jsdom, and reading it blind is how a test suite
 * inherits a production-only crash.
 */
function browserContainer(): StaleBuildContainer | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  return navigator.serviceWorker as unknown as StaleBuildContainer;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * How {@link moveToNewerBuild} ended.
 *
 * - `no-worker`: no worker controls the page, so the network served this build.
 * - `failed`: the check itself failed, offline or refused by the browser.
 * - `current`: the server has no newer build.
 * - `timeout`: a newer worker was found but did not take over in time.
 * - `reloading`: a newer worker took over and the page is being replaced.
 */
export type NewerBuildOutcome = 'no-worker' | 'failed' | 'current' | 'timeout' | 'reloading';

/**
 * Asks the server for a newer service worker, and moves onto it when there is
 * one. The stale-route recovery below and the "Check for updates" button in
 * Settings both go through this one function.
 *
 * @param options - The browser pieces to use, for tests that have none
 * @returns How it ended; only `reloading` replaces the page
 */
export async function moveToNewerBuild(options: StaleBuildOptions = {}): Promise<NewerBuildOutcome> {
  const {
    container = browserContainer(),
    reload = () => {
      window.location.reload();
    },
    timeoutMs = STALE_BUILD_TIMEOUT_MS,
  } = options;

  // No worker answered this navigation, so the origin itself served the build
  // that is running.
  if (container === null || container.controller === null || container.controller === undefined) {
    return 'no-worker';
  }

  let registration: StaleBuildRegistration | null | undefined;
  try {
    registration = await container.getRegistration();
    if (registration === null || registration === undefined) {
      return 'no-worker';
    }
    await registration.update();
  } catch {
    // Offline, or a worker the browser refuses to re-fetch.
    return 'failed';
  }

  const hasNewer =
    (registration.installing !== null && registration.installing !== undefined) ||
    (registration.waiting !== null && registration.waiting !== undefined);
  if (!hasNewer) {
    return 'current';
  }

  // Only a worker that has actually taken over is worth reloading onto.
  //
  // The timeout gives up rather than reloading anyway, and that is the
  // difference between a recovery and a reload loop: the old worker would
  // answer the reload from the same precache, land on the same missing route,
  // find the same worker still installing, and do it all again.
  const tookOver = await new Promise<boolean>((resolve) => {
    const settle = (changed: boolean): void => {
      container.removeEventListener('controllerchange', onChange);
      clearTimeout(timer);
      resolve(changed);
    };
    const onChange = (): void => {
      settle(true);
    };
    const timer = setTimeout(() => {
      settle(false);
    }, timeoutMs);
    container.addEventListener('controllerchange', onChange);
  });

  if (!tookOver) {
    return 'timeout';
  }

  reload();
  return 'reloading';
}

/**
 * Asks whether the route that just missed belongs to a newer build, and moves
 * onto that build when it does.
 *
 * A path that is genuinely wrong finds no newer build, and the error page is
 * the honest answer.
 *
 * @param options - The browser pieces to use, for tests that have none
 * @returns Whether a reload was started, in which case the caller should render
 *   nothing final: the page is about to be replaced
 */
export async function recoverFromStaleBuild(options: StaleBuildOptions = {}): Promise<boolean> {
  return (await moveToNewerBuild(options)) === 'reloading';
}
