/**
 * @fileoverview Application entry point.
 * Initializes i18n, database, and renders the React application.
 *
 * @module main
 */

// Initialize i18n before any React components load.
import { i18nReady } from '@/lib/i18n';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ensureSettings } from '@/lib/db';
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
    await ensureSettings();
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

// Bootstrap the application
initializeApp().catch((error) => {
  console.error('Application failed to initialize:', error);
});
