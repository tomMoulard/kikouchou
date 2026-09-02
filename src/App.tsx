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
      {/*
        `mobileOffset` lifts toasts clear of the other two things anchored to
        the bottom of a phone screen.

        A toast is interactive — it has a close button — so wherever it lands it
        takes taps for the several seconds it is up. At `bottom-center` with no
        offset it covered the navigation bar (`h-16`, fixed below `md`), eating
        every tap on Calendar, Rooms, Guests and Transport; at 80px it covered
        the `bottom-20 size-14` FAB instead. Both were measured as an E2E click
        spending its whole timeout intercepted by a toast.

        144px clears the FAB's top edge (80 + 56), and so the bar underneath it
        too. Only reachable since toasts began rendering at all.
      */}
      <Toaster
        position="bottom-center"
        mobileOffset={{ bottom: '144px' }}
        richColors
        closeButton
      />
      <InstallPrompt />
      <OfflineIndicator />
    </>
  );
}

export default App;
