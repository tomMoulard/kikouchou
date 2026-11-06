/**
 * @fileoverview Keeps the Android app's page out from under the status bar.
 *
 * `index.html` declares `viewport-fit=cover`, so the website and the iPhone
 * app can draw under the notch and pad themselves with
 * `env(safe-area-inset-*)`. In the Android app, Capacitor's SystemBars plugin
 * reads that same tag: with it, and a WebView of 140 or newer, the page draws
 * under the status bar and gets the insets from the WebView. On a Fairphone 4
 * (Android 15, WebView 157) the WebView reported a top inset of 93 CSS px
 * under a 36px status bar, and painted stale pixels over that whole strip,
 * which covered the header from 0.1.5 on. Without the tag, SystemBars pads
 * the window by the status bar and the gesture bar instead, and the page
 * starts below the status bar, the way an Android app normally lays out.
 *
 * Runs once, in `main.tsx`, before the page finishes loading: SystemBars reads
 * the tag on the load event.
 *
 * @module lib/native/viewport
 */

import { getAppPlatform } from '@/lib/platform';

/**
 * The viewport content without `viewport-fit=cover`.
 *
 * @param content - The `content` of the viewport tag
 */
export function withoutViewportCover(content: string): string {
  return content
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part.replace(/\s+/g, '') !== 'viewport-fit=cover')
    .join(', ');
}

/**
 * Drops `viewport-fit=cover` from the viewport tag in the Android app, and
 * does nothing on the website or in the iPhone app.
 *
 * @param doc - The document; the real one by default
 */
export function fitAndroidViewport(doc: Document = document): void {
  if (getAppPlatform() !== 'android') {
    return;
  }
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="viewport"]')) {
    meta.content = withoutViewportCover(meta.content);
  }
}
