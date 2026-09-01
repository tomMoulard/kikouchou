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
    <>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>

      {/*
        Global chrome, deliberately outside AppProviders.

        None of the three reads a trip context — they use `useTheme`,
        `useInstallPrompt` and `useOnlineStatus`, all app-global. Inside the
        provider tree they were remounted whenever `YjsTripSync` swapped the
        element at its position, which it does on the no-trip -> trip
        transition. A remounted `Toaster` resubscribes to sonner's store, and
        sonner only forwards toasts published *after* a subscription, so the
        "Trip created successfully" toast — published moments before the first
        trip is selected — was in the store but never rendered. Measured:
        `toast.getToasts()` returned 1 while the document held no
        `[data-sonner-toaster]` at all.
      */}
      <Toaster position="bottom-center" richColors closeButton />
      <InstallPrompt />
      <OfflineIndicator />
    </>
  );
}

export default App;
