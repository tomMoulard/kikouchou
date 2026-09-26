/**
 * @fileoverview The store apps' side of the operating system: links, the back
 * button, the status bar, the splash screen, and notification taps.
 *
 * Renders nothing. Mounted once, in `App`, beside the other global chrome, and
 * does nothing at all on the website: every effect returns before it touches a
 * plugin when {@link isNativeApp} is false.
 *
 * - A link the app was opened with, cold or warm, goes through
 *   `lib/native/deep-links`. A sign-in answer goes to `AuthProvider`
 *   (`deliverAuthCallbackUrl`); a Kikouchou page becomes a route.
 * - The Android back button walks the history, and leaves the app from the
 *   trip list, the way every Android app does.
 * - The status and navigation bars follow the theme, so light text never sits
 *   on the light background.
 * - The splash screen stays up until React has painted
 *   (`capacitor.config.ts` turns its timer off).
 * - A tap on a reminder opens the page it names and is reported as
 *   `notification_opened`, the same event a web click sends.
 *
 * @module components/native/NativeShell
 */

import { memo, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { App as CapacitorApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';

import { onNativeNotificationOpened } from '@/lib/notifications/native-push';
import { reportNotificationOpened } from '@/lib/notifications/opened';
import { isNativeApp } from '@/lib/platform';
import { router } from '@/router';

import { openDeepLink } from './open-deep-link';

// ============================================================================
// Constants
// ============================================================================

/** The pages the back button leaves the app from, rather than going back. */
const ROOT_PATHS: readonly string[] = ['/', '/trips'];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Where a reminder tap goes. The server sends a path on the website, or
 * nothing, which means the trip list.
 */
function openNotification(url: string): void {
  if (url === '') {
    void router.navigate('/trips');
    return;
  }
  if (url.startsWith('/')) {
    void router.navigate(url);
    return;
  }
  openDeepLink(url);
}

// ============================================================================
// Component
// ============================================================================

/**
 * Wires the store app's native events into the page.
 */
export const NativeShell = memo(function NativeShell(): null {
  const { resolvedTheme } = useTheme();

  // Links, cold and warm. `getLaunchUrl` answers the cold start; `appUrlOpen`
  // everything after. `deliverAuthCallbackUrl` drops a code it has already
  // handed out, so the two overlapping on a cold start is harmless.
  useEffect(() => {
    if (!isNativeApp()) {
      return undefined;
    }
    let cancelled = false;
    let remove: (() => void) | undefined;

    void CapacitorApp.getLaunchUrl()
      .then((launch) => {
        if (!cancelled && launch?.url) {
          openDeepLink(launch.url);
        }
      })
      .catch(() => undefined);

    void CapacitorApp.addListener('appUrlOpen', (event) => {
      openDeepLink(event.url);
    })
      .then((handle) => {
        remove = () => void handle.remove();
        if (cancelled) {
          remove();
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  // The Android back button. iOS has none; its swipe is the web view's own.
  useEffect(() => {
    if (!isNativeApp()) {
      return undefined;
    }
    let cancelled = false;
    let remove: (() => void) | undefined;

    void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      const path = router.state.location.pathname;
      if (canGoBack && !ROOT_PATHS.includes(path)) {
        void router.navigate(-1);
        return;
      }
      void CapacitorApp.minimizeApp();
    })
      .then((handle) => {
        remove = () => void handle.remove();
        if (cancelled) {
          remove();
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  // Reminder taps.
  useEffect(() => {
    if (!isNativeApp()) {
      return undefined;
    }
    return onNativeNotificationOpened(({ kind, url }) => {
      reportNotificationOpened(kind);
      openNotification(url);
    });
  }, []);

  // The system bars follow the theme the page resolved, not the device's:
  // a user who picked dark in Settings on a light phone still gets light text.
  useEffect(() => {
    if (!isNativeApp() || resolvedTheme === undefined) {
      return;
    }
    void SystemBars.setStyle({
      style: resolvedTheme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    }).catch(() => undefined);
  }, [resolvedTheme]);

  // First paint done: take the splash screen down, and ask the operating
  // system to keep this app's storage. IndexedDB holds the only copy of a trip
  // that was never synced, and a store app gets no warning before eviction.
  useEffect(() => {
    if (!isNativeApp()) {
      return;
    }
    void SplashScreen.hide().catch(() => undefined);
    void navigator.storage?.persist?.().catch(() => false);
  }, []);

  return null;
});
