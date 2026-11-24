/**
 * @fileoverview Capacitor configuration for the iOS and Android store apps.
 *
 * The native shells load the same Vite build as the website, from files inside
 * the app bundle (`webDir`), and never from `https://app.kikouchou.app`. That
 * is what makes the first launch work with no network, and what keeps the
 * App Store review from reading the app as a website in a frame. The price is
 * the page origin: `capacitor://localhost` on iOS, `https://app.kikouchou.app`
 * on Android (see `ANDROID_HOSTNAME` below). `src/lib/platform` is where the
 * app learns that it is not the website and answers with the
 * public origin instead. See `plans/2026-09-26-native-apps-v1.md`.
 *
 * `KIKOUCHOU_ANDROID_FLAVOR=fdroid` builds the F-Droid variant. F-Droid ships
 * free software only, and `@capacitor/push-notifications` brings Firebase
 * Cloud Messaging, which is not. That variant leaves the plugin out, and the
 * app then reports push as unsupported, which hides the reminder card. It
 * also leaves out live updates: f-droid.org builds every release from source,
 * and a bundle downloaded at run time would ship code it never built.
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
  '@capawesome/capacitor-live-update',
] as const;

/** Left out of the F-Droid build, for the reasons in the header. */
const NOT_FOR_FDROID: readonly string[] = [
  '@capacitor/push-notifications',
  '@capawesome/capacitor-live-update',
];

/**
 * Verifies every live update bundle (`scripts/build-live-update.sh` signs it
 * with the private half, the `LIVE_UPDATE_PRIVATE_KEY` secret). A bundle that
 * fails the check is never applied. RSA 2048: the iOS side of the plugin reads
 * no other size. Changing it changes the native fingerprint, so the new key
 * ships in a store release before any bundle is signed with it.
 */
const LIVE_UPDATE_PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsY2FOHL3reuoFUEA2Zex\n' +
  'y8DmoPlOSfv9H+fxtMlz8v6HRnWwwgj0nb/dBXhxlDcOEhuN+k0/RqpENSpPjXqA\n' +
  'LPCEiNFcVIHEhYzzwhNxS1psFZQX7ocDS+1wPVZjDc5z9FOMYMJl0OyKoWLStycu\n' +
  '7rxkaABHzAihSn3KGjg0hA8hPhQqb237UZqM9qKgqgwJBY6N/kHe7YyFIuk7KuG1\n' +
  'L85IkAXyevGN2uhJVfXYGCnwMbEkj7FNKa0btuv8UhW0T4YWjtoOGLbSNbeZcz34\n' +
  'HwfMc4+BR4+S+f6G/dp9BrIAywLJxNLm8nX4us7Gm+Th0F7aUhYFEOv8lM4qYxuc\n' +
  'HwIDAQAB\n' +
  '-----END PUBLIC KEY-----';

const isFdroid = process.env.KIKOUCHOU_ANDROID_FLAVOR === 'fdroid';

/**
 * Whether this sync is for the iPhone app. `cap sync` does not say which
 * platform it reads the config for, so the iOS steps say it themselves
 * (`build:native`, and the iOS job in `.github/workflows/native.yml`).
 */
const isIosSync = process.env.KIKOUCHOU_NATIVE_PLATFORM === 'ios';

/**
 * The host the Android app serves its pages as: the website's.
 *
 * Under `https://localhost`, every map tile request told OpenStreetMap it came
 * from `localhost`, and its tile servers refuse that, so the Android app drew
 * no map while the website, the same build, did. Served as the website's host,
 * the app sends the website's Referer, which OpenStreetMap accepts.
 *
 * What it costs, and why it stops at Android:
 * - The page origin is what IndexedDB and localStorage belong to, so an
 *   install upgraded across this change opens empty. Trips that sync come
 *   back with the account; trips that lived only on the phone do not. This
 *   was accepted for Android, to get the maps back.
 * - The web view answers every request to this host from the files inside the
 *   app, so anything the app reads from the real website has to go around it.
 *   The live update manifest does (`fetchOutsideWebView` in
 *   `lib/native/live-update`).
 * - iOS keeps `capacitor://localhost`. Its custom scheme gains nothing from the
 *   host, OpenStreetMap or otherwise, and moving it would empty every iPhone
 *   install for nothing.
 */
const ANDROID_HOSTNAME = 'app.kikouchou.app';

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
  ...(isIosSync ? {} : { server: { hostname: ANDROID_HOSTNAME } }),
  android: {
    includePlugins: isFdroid
      ? PLUGINS.filter((plugin) => !NOT_FOR_FDROID.includes(plugin))
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
      // SystemBars pads the window by the status bar and the gesture bar, and
      // the page starts below the status bar, because the Android app drops
      // `viewport-fit=cover` from the viewport tag (`lib/native/viewport`).
      // With it, a Fairphone 4 (Android 15, WebView 157) reported a top inset
      // of 93px under a 36px status bar and painted stale pixels over the
      // header. The iPhone app keeps `viewport-fit=cover` for the notch.
      insetsHandling: 'native',
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
    // Self-hosted: `src/lib/native/live-update.ts` fetches and applies the
    // bundles, and nothing talks to Capawesome Cloud.
    LiveUpdate: {
      publicKey: LIVE_UPDATE_PUBLIC_KEY,
      // `NativeShell` calls `ready()` once React has painted. A bundle that
      // never gets that far is rolled back to the one in the store build, and
      // blocked so the app does not download it again.
      readyTimeout: 15000,
      autoBlockRolledBackBundles: true,
      autoDeleteBundles: true,
    },
  },
};

export default config;
