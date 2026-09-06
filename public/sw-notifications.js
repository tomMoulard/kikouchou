/*
 * Kikouchou — what happens when somebody taps a ride notification.
 *
 * This file is *imported into* the generated Workbox service worker, by the
 * `workbox.importScripts` entry in `vite.config.ts`. It is deliberately not a
 * service worker of its own, and switching the build to `injectManifest` to get
 * a hand-written one was deliberately not done: the Playwright `production`
 * project (offline-first, pwa, maps-offline) runs against exactly the worker
 * `generateSW` produces, and rewriting that worker wholesale to add one
 * listener trades a real, tested gate for a nicety.
 *
 * The notification itself is posted from the page — `registration.showNotification()`
 * in `src/lib/notifications/notify.ts` — so nothing here creates one. A click
 * is the only half that has to live in the worker, because the page that posted
 * the notification may well be gone by the time the click arrives.
 *
 * Plain JS on purpose: `public/` is copied verbatim into `dist`, so nothing
 * compiles or bundles it. Keep it dependency-free and readable.
 */

/**
 * Where a click should land when the notification carries no path of its own.
 *
 * Empty rather than `/`: it is resolved against the registration scope below,
 * and an empty relative URL resolves to the scope itself — which is the app's
 * base, wherever that happens to be.
 */
const DEFAULT_TARGET_PATH = '';

/**
 * Brings the app forward at `target`, opening a window only if none exists.
 *
 * Reusing an open window matters beyond tidiness: every window shares one
 * IndexedDB, and a second one onto the same trip is a second Yjs session doing
 * the same work.
 *
 * @param {string} target Absolute URL to land on.
 * @returns {Promise<void>}
 */
async function focusOrOpen(target) {
  // `includeUncontrolled` catches a tab that loaded before this worker took
  // control — on a first visit that is every tab there is.
  const windows = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  // Already looking at the right page: just bring it forward.
  const alreadyThere = windows.find((client) => client.url === target);

  if (alreadyThere) {
    await alreadyThere.focus();
    return;
  }

  // Prefer the window the user was actually looking at. `matchAll()` is not
  // ordered "most recently focused", so `windows[0]` can be a background tab —
  // and `navigate()` is a full page load that bypasses the app's own
  // unsaved-changes guard. Reloading a background tab that happened to be
  // holding a half-filled transport form throws the input away, and the user
  // never sees why.
  const existing = windows.find((client) => client.focused) || windows[0];

  if (existing) {
    // Focus first, then route. If `navigate()` is refused the user is at least
    // looking at the app rather than at nothing.
    await existing.focus();

    try {
      await existing.navigate(target);
    } catch {
      // `navigate()` is only allowed on a client this worker controls, and it
      // rejects rather than resolving for the others. Not worth reporting: the
      // window is focused, and the in-app alert says the same thing.
    }

    return;
  }

  await self.clients.openWindow(target);
}

/**
 * Resolves a stored path to a URL inside this app, or to the app's own base.
 *
 * The page already reduces the path to plain relative segments, but this is the
 * side that has to *trust* it: `data.url` arrives from a notification, and a
 * notification can outlive the build that wrote it. Anything that resolves
 * outside the registration scope is discarded for the scope itself rather than
 * followed — opening the host root, or somebody else's page, is never a better
 * answer than opening Kikouchou.
 *
 * @param {unknown} path Stored path, relative to the app's base.
 * @returns {string} An absolute URL known to be inside the app.
 */
function resolveInsideApp(path) {
  const scope = self.registration.scope;

  if (typeof path !== 'string' || path === '') {
    return scope;
  }

  try {
    const resolved = new URL(path, scope).href;

    return resolved.startsWith(scope) ? resolved : scope;
  } catch {
    // `new URL` throws only on input this should never see, and the app's own
    // base is always a safe landing.
    return scope;
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // `data.url` is stored app-relative and without a leading slash on purpose.
  // Resolved against the registration scope it lands under the app's `base`;
  // a hard-coded '/' — or a leading slash here — would open the host root
  // instead, which is the wrong page on a sub-path deploy.
  const data = event.notification.data;
  const path = data && typeof data.url === 'string' ? data.url : DEFAULT_TARGET_PATH;
  const target = resolveInsideApp(path);

  // Without `waitUntil` the worker may be killed before the client is focused.
  // The rejection is swallowed rather than left to `waitUntil`: a browser can
  // refuse `focus()` or `openWindow()` outside a gesture it recognises, and a
  // rejected lifetime extension is logged as a worker error for something
  // nothing here can recover from. The in-app alert still says the same thing.
  event.waitUntil(
    focusOrOpen(target).catch((error) => {
      console.warn('[notifications] could not bring the app forward:', error);
    }),
  );
});
