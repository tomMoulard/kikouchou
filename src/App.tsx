/**
 * @fileoverview Main application component.
 * Sets up the application with providers, router, and global UI components.
 *
 * @module App
 */

import { type ReactElement } from 'react';
import { RouterProvider } from 'react-router-dom';

import { AppProviders } from '@/contexts/AppProviders';
import { Toaster } from '@/components/ui/sonner';
import { InstallPrompt, OfflineIndicator } from '@/components/pwa';
import { router } from '@/router';

// ============================================================================
// Component
// ============================================================================

/**
 * Main application component.
 *
 * Provides:
 * - AppProviders: Trip, Room, Person, Assignment, Transport contexts
 * - RouterProvider: React Router with configured routes
 * - Toaster: Toast notifications via Sonner
 * - InstallPrompt: PWA install prompt
 * - OfflineIndicator: Network status indicator
 *
 * @returns The root application element with all providers and global UI
 *
 * @example
 * ```tsx
 * // In main.tsx
 * import App from './App';
 *
 * ReactDOM.createRoot(document.getElementById('root')!).render(
 *   <React.StrictMode>
 *     <App />
 *   </React.StrictMode>,
 * );
 * ```
 */
function App(): ReactElement {
  return (
    <AppProviders>
      <RouterProvider router={router} />

      {/* Global UI components */}
      <Toaster position="bottom-center" richColors closeButton />
      <InstallPrompt />
      <OfflineIndicator />
    </AppProviders>
  );
}

export default App;
