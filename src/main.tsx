/**
 * @fileoverview Application entry point.
 * Initializes i18n, database, and renders the React application.
 *
 * @module main
 */

// Before anything else runs: react-markdown calls `Object.hasOwn`, which an
// old Android WebView lacks. See lib/polyfills.
import '@/lib/polyfills';

// FIRST OF ALL, after the polyfills. Reads the OAuth `?code=` synchronously at
// import time, before router.tsx is evaluated and before main() awaits i18n and
// the database — by which point the query string has had seconds and a router
// initialisation to disappear in. See lib/supabase/auth-callback for the bug this fixes.
import '@/lib/supabase/auth-callback';

// Initialize i18n before any React components load.
import { getCurrentLanguage, i18nReady } from '@/lib/i18n';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SplashScreen } from '@capacitor/splash-screen';

import { StorageFullScreen } from '@/components/shared/StorageFullScreen';

import { storePetEnabled } from '@/features/pet/lib/pet-preferences';
import {
  attachSamplePhotos,
  seedSampleTripOnce,
  shouldOfferSampleTrip,
} from '@/features/trips/utils/seed-sample-trip';

import { ensureSettings } from '@/lib/db';
import { prepareDatabase } from '@/lib/db/boot';
import { startLiveUpdate } from '@/lib/native/live-update';
import { fitAndroidViewport } from '@/lib/native/viewport';
import { isNativeApp } from '@/lib/platform';
import '@/lib/posthog';
// Beside lib/posthog, and for the same reason it is imported here rather than
// pasted into index.html: the module decides whether to load at all, so a dev
// server never reports to the ad account. See lib/meta-pixel.
import '@/lib/meta-pixel';
// And the Google pair — the GTM container and the Google Ads tag — which the
// landing page carries in its <head> and this app loads the same guarded way.
import '@/lib/google-tag';
// After lib/posthog, which must have initialised before anything captures, and
// before App.tsx pulls in the router — this reads a query parameter the router
// is free to normalise away. See lib/notifications/opened.
import '@/lib/notifications/opened';
import { registerServiceWorker } from '@/lib/pwa/register';
import { logCaughtError } from '@/lib/pwa/stale-chunk';
import App from './App.tsx';
import './index.css';

// In the Android app, before the load event: SystemBars reads the viewport tag
// then, and without `viewport-fit=cover` the page starts below the status bar.
// See lib/native/viewport.
fitAndroidViewport();

/**
 * Get and validate the application root element.
 *
 * @returns The root DOM element
 * @throws {Error} If the root element is not found
 */
function getRootElement(): HTMLElement {
  const rootElement = document.getElementById('root');

  if (!rootElement) {
    throw new Error(
      'Root element not found. Ensure index.html contains <div id="root"></div>',
    );
  }

  return rootElement;
}

/**
 * Initialize and render the application.
 *
 * Performs the following initialization steps:
 * 1. Waits for i18n to be fully initialized (prevents flash of untranslated content)
 * 2. Seeds the sample trip on this device's first open, in the user's language
 * 3. Ensures database settings exist (required for liveQuery read-only operations)
 * 4. Renders the React application
 */
/**
 * How long to wait for the database before rendering anyway.
 *
 * Only reached when IndexedDB is genuinely blocked (another tab on an older
 * schema); the normal path resolves in milliseconds.
 */
const DB_READY_TIMEOUT_MS = 3000;

/** Runs the boot again, once the user has freed some space. */
function reloadPage(): void {
  window.location.reload();
}

/**
 * Renders the storage-full screen in place of the app.
 *
 * In a store app, `NativeShell` is what takes the splash screen down and tells
 * the live update plugin the bundle painted, and it lives inside `App`. Done
 * here instead, after the first frame: without it the screen stays behind the
 * splash, and the plugin rolls back a bundle that started fine.
 *
 * @param rootElement - The element to render into
 */
function renderStorageFullScreen(rootElement: HTMLElement): void {
  createRoot(rootElement, { onCaughtError: logCaughtError }).render(
    <StrictMode>
      <StorageFullScreen onRetry={reloadPage} />
    </StrictMode>,
  );
  if (isNativeApp()) {
    requestAnimationFrame(() => {
      void SplashScreen.hide().catch(() => undefined);
      startLiveUpdate();
    });
  }
}

async function initializeApp(): Promise<void> {
  const rootElement = getRootElement();

  try {
    // Wait for i18n initialization to complete
    await i18nReady;
  } catch (error) {
    // Log error but continue - i18n has fallback language configured
    console.error('i18n initialization failed, using fallback:', error);
  }

  // Ensures the settings row exists before the app renders (liveQuery reads
  // must not write), after seeding the sample trip on a first open. Never
  // rejects, and gives up waiting after DB_READY_TIMEOUT_MS. See lib/db/boot.
  // The first open also turns the pet on, so the new visitor meets it beside
  // the sample; a returning device keeps whatever it chose.
  const outcome = await prepareDatabase({
    seed: shouldOfferSampleTrip()
      ? async () => {
          if ((await seedSampleTripOnce(getCurrentLanguage())) === 'seeded') {
            storePetEnabled(true);
            // Not awaited: the pictures are a download, and the first
            // paint does not wait for one.
            void attachSamplePhotos().catch((error: unknown) => {
              console.warn('Failed to attach the sample trip photos:', error);
            });
          }
        }
      : undefined,
    ensureSettings,
    timeoutMs: DB_READY_TIMEOUT_MS,
  });

  // A full disk: IndexedDB cannot open, so no page of the app can work. Say
  // so, rather than render pages that each report "Failed to load". The retry
  // reloads, which runs this whole boot again.
  if (outcome === 'storage-full') {
    renderStorageFullScreen(rootElement);
    return;
  }

  // Render the application
  createRoot(rootElement, { onCaughtError: logCaughtError }).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Installs the service worker and keeps a long-lived session on the build that
// is actually deployed. Deliberately outside initializeApp(): it must not wait
// on i18n or on a database open that can block behind another tab.
registerServiceWorker();

// Bootstrap the application
initializeApp().catch((error) => {
  console.error('Application failed to initialize:', error);
});
