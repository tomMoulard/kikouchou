/**
 * @fileoverview Hands a generated file to the user in a store app.
 *
 * A WKWebView ignores `<a download>`, and an Android web view downloads to a
 * folder nobody opens. The app writes the file to its cache instead and opens
 * the system share sheet on it, which is where a phone user expects a file to
 * go: "Add to Calendar", Files, Mail, AirDrop.
 *
 * @module lib/native/files
 */

import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// ============================================================================
// Type Definitions
// ============================================================================

/** How handing over a file ended. */
export type SaveFileOutcome = 'saved' | 'cancelled' | 'failed';

// ============================================================================
// Exports
// ============================================================================

/**
 * Writes a text file to the app's cache and opens the share sheet on it.
 *
 * @param filename - The file's name, shown in the sheet
 * @param text - The file's content
 * @param title - The sheet's title, already translated
 */
export async function shareTextFile(
  filename: string,
  text: string,
  title: string,
): Promise<SaveFileOutcome> {
  let uri: string;
  try {
    const written = await Filesystem.writeFile({
      path: filename,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    uri = written.uri;
  } catch (error: unknown) {
    console.error('Failed to write the file to share:', error);
    return 'failed';
  }

  try {
    await Share.share({ title, files: [uri] });
    return 'saved';
  } catch (error: unknown) {
    // Both plugins reject a dismissed sheet with this message rather than a code.
    if (error instanceof Error && /cancel/i.test(error.message)) {
      return 'cancelled';
    }
    console.error('Failed to open the share sheet:', error);
    return 'failed';
  }
}
