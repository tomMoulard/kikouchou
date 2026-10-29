/**
 * @fileoverview Hands a link to the system share sheet.
 *
 * A phone user sends an invitation through a messaging app, not by copying a
 * URL. The store apps open the sheet through the Share plugin, and a browser
 * through `navigator.share`, which most desktop browsers lack. Where neither
 * exists, the caller keeps its copy button and shows no share button.
 *
 * @module lib/native/share-link
 */

import { Share } from '@capacitor/share';

import { hasNativePlugin, isNativeApp } from '@/lib/platform';

// ============================================================================
// Type Definitions
// ============================================================================

/** How handing over the link ended. */
export type ShareLinkOutcome = 'shared' | 'cancelled' | 'failed';

export interface ShareLinkInput {
  readonly url: string;
  /** The sheet's title, already translated. */
  readonly title: string;
  /** A line sent along with the link, already translated. */
  readonly text: string;
}

// ============================================================================
// Constants
// ============================================================================

const SHARE_PLUGIN = 'Share';

// ============================================================================
// Helpers
// ============================================================================

function usesNativeSheet(): boolean {
  return isNativeApp() && hasNativePlugin(SHARE_PLUGIN);
}

function hasWebShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Whether this device has a share sheet to open.
 *
 * @returns True in a store app with the plugin, or a browser with Web Share
 */
export function canShareLink(): boolean {
  return usesNativeSheet() || hasWebShare();
}

/**
 * Opens the share sheet on a link.
 *
 * @param input - See {@link ShareLinkInput}
 * @returns How it ended; a dismissed sheet is `cancelled`, not a failure
 */
export async function shareLink({ url, title, text }: ShareLinkInput): Promise<ShareLinkOutcome> {
  try {
    if (usesNativeSheet()) {
      await Share.share({ title, text, url });
      return 'shared';
    }
    if (hasWebShare()) {
      await navigator.share({ title, text, url });
      return 'shared';
    }
    return 'failed';
  } catch (error: unknown) {
    // The browser rejects a dismissed sheet with an AbortError; both plugins
    // reject it with a message rather than a code.
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || /cancel/i.test(error.message))
    ) {
      return 'cancelled';
    }
    console.error('Failed to open the share sheet:', error);
    return 'failed';
  }
}
