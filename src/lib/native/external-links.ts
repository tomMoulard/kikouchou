/**
 * @fileoverview Opens a link that leaves Kikouchou: a map, a directions page.
 *
 * In a browser that is a new tab, as it always was. In a store app a new tab
 * does not exist, and a navigation inside the web view would replace the app
 * with a website. The operating system opens the link instead, which is what
 * turns a Google Maps or Apple Maps URL into the Maps app when it is installed.
 *
 * @module lib/native/external-links
 */

import { AppLauncher } from '@capacitor/app-launcher';

import { isNativeApp } from '@/lib/platform';

/**
 * Opens a URL outside the app.
 *
 * @param url - An absolute `https:` URL
 */
export function openExternalUrl(url: string): void {
  if (isNativeApp()) {
    void AppLauncher.openUrl({ url }).catch((error: unknown) => {
      console.error('Failed to open an external link:', error);
    });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
