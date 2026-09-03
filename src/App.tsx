/**
 * @fileoverview Main application component.
 * Sets up the application with providers, router, and global UI components.
 *
 * @module App
 */

import { type ReactElement } from 'react';
import { ThemeProvider } from 'next-themes';
import { RouterProvider } from 'react-router-dom';

import { AppProviders } from '@/contexts/AppProviders';
import { Toaster } from '@/components/ui/sonner';
import { InstallPrompt, OfflineIndicator } from '@/components/pwa';
import { applyStoredTheme, THEME_STORAGE_KEY } from '@/lib/theme';
import { router } from '@/router';

// ============================================================================
// Pre-paint theme
// ============================================================================

/*
  Runs at module evaluation, which is the earliest point this app can reach
  without touching `index.html`.

  `ThemeProvider` below applies the same class, but only once React commits —
  and `main.tsx` deliberately delays that commit behind `await i18nReady` and a
  database open that is raced against a 3s timeout. A dark-mode user would
  stare at a white page for all of it. Calling this here cuts the window down
  to the entry chunk's own download and parse.

  It does NOT eliminate the window: `index.html` loads `main.tsx` as a deferred
  module, so the browser may paint the light `:root` background before any of
  our code runs. Closing that last gap needs a small blocking `<script>` in
  `<head>` — which is exactly what next-themes emits during SSR and cannot here.
  That file belongs to another unit; see the PR body.

  The provider and this call cannot disagree: both read `THEME_STORAGE_KEY`,
  and `applyStoredTheme` normalises the stored value so next-themes only ever
  sees one it understands.
*/
applyStoredTheme();

// ============================================================================
// Component
// ============================================================================

/**
 * Main application component.
 *
 * Provides:
 * - ThemeProvider: light / dark / system theme, written as a class on `<html>`
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
    /*
      `attribute="class"` is not optional: `index.css` declares the dark
      variant as `@custom-variant dark (&:is(.dark *))`, so every `dark:`
      utility and the whole `.dark` token block need that class on an ancestor.
      A media-query theme would leave them all inert, which is what the app
      shipped with until this provider was mounted.

      Outside `AppProviders` for the same reason the three elements below are:
      it must not be remounted when `YjsTripSync` swaps the element at its
      position on the no-trip -> trip transition. It has to be outside and
      above, though, rather than a sibling — `Toaster` reads `useTheme`.
    */
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      storageKey={THEME_STORAGE_KEY}
      enableSystem
      disableTransitionOnChange
    >
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

        `calc(9rem + …)` is 144px, which clears the FAB's top edge (80 + 56) and
        so the bar underneath it too, plus the home-indicator inset that
        `viewport-fit=cover` now exposes — the same sum `bottom-fab-safe` in
        `src/index.css` applies to the second FAB on `/trips`. Sonner takes this
        as a raw offset string rather than a class, so it is the one place the
        arithmetic is repeated; keep the two in step.
      */}
      <Toaster
        position="bottom-center"
        mobileOffset={{ bottom: 'calc(9rem + env(safe-area-inset-bottom, 0px))' }}
        richColors
        closeButton
      />
      <InstallPrompt />
      <OfflineIndicator />
    </ThemeProvider>
  );
}

export default App;
