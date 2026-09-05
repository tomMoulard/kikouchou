/**
 * @fileoverview Application entry point.
 * Initializes i18n, database, and renders the React application.
 *
 * @module main
 */

// FIRST. Reads the OAuth `?code=` synchronously at import time, before
// router.tsx is evaluated and before main() awaits i18n and the database — by
// which point the query string has had seconds and a router initialisation to
// disappear in. See lib/supabase/auth-callback for the bug this fixes.
import '@/lib/supabase/auth-callback';

// Initialize i18n before any React components load.
import { i18nReady } from '@/lib/i18n';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ensureSettings } from '@/lib/db';
import '@/lib/posthog';
import { registerServiceWorker } from '@/lib/pwa/register';
import App from './App.tsx';
import './index.css';

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
 * 2. Ensures database settings exist (required for liveQuery read-only operations)
 * 3. Renders the React application
 */
/**
 * How long to wait for the database before rendering anyway.
 *
 * Only reached when IndexedDB is genuinely blocked (another tab on an older
 * schema); the normal path resolves in milliseconds.
 */
const DB_READY_TIMEOUT_MS = 3000;

async function initializeApp(): Promise<void> {
  const rootElement = getRootElement();

  try {
    // Wait for i18n initialization to complete
    await i18nReady;
  } catch (error) {
    // Log error but continue - i18n has fallback language configured
    console.error('i18n initialization failed, using fallback:', error);
  }

  try {
    // Ensure settings exist in database before app renders.
    // This prevents write operations inside liveQuery contexts.
    //
    // Raced against a timeout on purpose: db.open() can block indefinitely
    // behind another tab holding an older schema version, and a promise that
    // never settles would leave the user on a blank page with no error, because
    // createRoot().render() below is never reached. Rendering slightly early is
    // safe — getSettings() falls back to defaults.
    await Promise.race([
      ensureSettings(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, DB_READY_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    // Log error but continue - getSettings() returns defaults if DB is unavailable
    console.error('Database initialization failed:', error);
  }

  // Render the application
  createRoot(rootElement).render(
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
