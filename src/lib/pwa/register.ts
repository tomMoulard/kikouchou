/**
 * @fileoverview Registers the service worker, the way `autoUpdate` needs.
 *
 * `injectRegister` is `null` in `vite.config.ts` so that this is the only
 * registration. The script vite-plugin-pwa injects into `index.html` otherwise
 * is a bare `navigator.serviceWorker.register(...)`: it installs the worker and
 * then never speaks again, which leaves half of `registerType: 'autoUpdate'`
 * unimplemented. `skipWaiting` and `clientsClaim` mean the *next* navigation
 * gets the new build; nothing reloads a session that never navigates.
 *
 * `virtual:pwa-register` supplies that half — in `autoUpdate` mode it reloads
 * the page once a new worker has activated. {@link watchForUpdates} supplies
 * the other: finding out that there is one.
 *
 * Kept apart from the watcher because importing the virtual module drags in the
 * whole plugin, which only exists inside a Vite build.
 *
 * @module lib/pwa/register
 */

import { registerSW } from 'virtual:pwa-register';

import { watchForUpdates } from './update-check';

/**
 * Installs the service worker and keeps the session on the current build.
 *
 * Registration itself waits for the window `load` event — `immediate` is left
 * off — so it never competes with the app's own chunks for the first paint.
 */
export function registerServiceWorker(): void {
  registerSW({
    onRegisteredSW: (_swUrl, registration) => {
      if (registration) {
        watchForUpdates(registration);
      }
    },
    onRegisterError: (error: unknown) => {
      // Non-fatal by construction: without a worker the app simply loses
      // offline support and always loads the current build from the network.
      console.error('[pwa] service worker registration failed:', error);
    },
  });
}
