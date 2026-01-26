/**
 * @fileoverview Application entry point.
 * Initializes i18n and renders the React application.
 *
 * @module main
 */

// Initialize i18n before any React components load.
import { i18nReady } from '@/lib/i18n';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

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
 * Waits for i18n to be fully initialized before rendering to ensure
 * translations are available from the first render. This prevents
 * flash of untranslated content (FOUC).
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
