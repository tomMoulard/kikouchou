/**
 * @fileoverview Capacitor configuration for the iOS and Android store apps.
 *
 * The native shells load the same Vite build as the website, from files inside
 * the app bundle (`webDir`), and never from `https://app.kikouchou.app`. That
 * is what makes the first launch work with no network, and what keeps the
 * App Store review from reading the app as a website in a frame. The price is
 * the page origin: `capacitor://localhost` on iOS, `https://localhost` on
 * Android. `src/lib/platform` is where the app learns that and answers with the
 * public origin instead. See `plans/2026-09-26-native-apps-v1.md`.
 *
 * `KIKOUCHOU_ANDROID_FLAVOR=fdroid` builds the F-Droid variant. F-Droid ships
 * free software only, and `@capacitor/push-notifications` brings Firebase
 * Cloud Messaging, which is not. That variant leaves the plugin out, and the
 * app then reports push as unsupported, which hides the reminder card.
 *
 * @module capacitor.config
 */

import type { CapacitorConfig } from '@capacitor/cli';

// ============================================================================
// Constants
// ============================================================================

/** One id on both stores, so a support request names the same app. */
const APP_ID = 'app.kikouchou';

/** Every plugin the app calls. The F-Droid build drops the non-free one. */
const PLUGINS = [
  '@capacitor/app',
  '@capacitor/app-launcher',
  '@capacitor/browser',
  '@capacitor/filesystem',
  '@capacitor/haptics',
  '@capacitor/keyboard',
  '@capacitor/push-notifications',
  '@capacitor/share',
  '@capacitor/splash-screen',
] as const;

const NON_FREE_PLUGINS: readonly string[] = ['@capacitor/push-notifications'];

const isFdroid = process.env.KIKOUCHOU_ANDROID_FLAVOR === 'fdroid';

// ============================================================================
// Configuration
// ============================================================================

const config: CapacitorConfig = {
  appId: APP_ID,
  appName: 'Kikouchou',
  webDir: 'dist',
  // The user agent names the shell, so a server log can tell a store app from
  // a browser without trusting anything the page says about itself.
  appendUserAgent: 'Kikouchou-Native',
  android: {
    includePlugins: isFdroid
      ? PLUGINS.filter((plugin) => !NON_FREE_PLUGINS.includes(plugin))
      : [...PLUGINS],
    flavor: isFdroid ? 'fdroid' : 'play',
  },
  ios: {
    // The layout already pads itself with `env(safe-area-inset-*)`
    // (`src/index.css`), so the scroll view must not add its own inset on top.
    contentInset: 'never',
    includePlugins: [...PLUGINS],
  },
  plugins: {
    SystemBars: {
      // `index.html` asks for `viewport-fit=cover` and `src/index.css` pads the
      // chrome with `env(safe-area-inset-*)`, which is what the website does on
      // an iPhone. `native` makes an Android web view honour the same meta tag,
      // and pads the view itself on a Chromium too old to report the insets.
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
    },
    SplashScreen: {
      // Hidden by the app once React has painted (`src/components/native/NativeShell.tsx`),
      // rather than on a timer that races a slow first IndexedDB open.
      launchAutoHide: false,
      backgroundColor: '#0f172a',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    Keyboard: {
      // The mobile nav bar and the FAB are fixed to the bottom edge; resizing
      // the web view keeps them above the keyboard instead of under it.
      resize: 'native',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
