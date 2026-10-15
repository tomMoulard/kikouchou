/**
 * @fileoverview Handing the user a generated text file.
 *
 * The app is local-first and has no server to fetch a file from, so a download
 * is a blob made in the tab and clicked on the user's behalf. That is three
 * lines of DOM work that every caller would otherwise write slightly
 * differently, and one of the three — revoking the object URL — is the line
 * people forget, which leaks the blob for the life of the tab.
 *
 * @module lib/utils/download
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Characters a file name may keep.
 *
 * Everything else folds to a dash. This is deliberately narrower than what any
 * one operating system rejects: a trip is named by its guests, and "Provence
 * 2026 / Août" must not reach a file system as a path separator.
 */
const UNSAFE_FILENAME_CHARS = /[^a-z0-9]+/gi;

/** How long a generated base name may be, before the extension. */
const MAX_FILENAME_LENGTH = 60;

// ============================================================================
// Type Definitions
// ============================================================================

/** One file to hand to the user. */
export interface TextFileDownload {
  /** File name, extension included. */
  readonly filename: string;
  /** The file content. */
  readonly text: string;
  /** MIME type the blob is created with. */
  readonly mimeType: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Folds free text into a file name segment.
 *
 * Accents are stripped rather than kept: the name travels to a phone, a mail
 * attachment and a calendar app, and the ones that mangle non-ASCII do it
 * silently.
 *
 * @param value - Free text, typically a trip name
 * @param fallback - Used when nothing usable survives
 * @returns A lower-case, dash-separated name segment
 *
 * @example
 * ```typescript
 * toFilenameSegment('Provence, août 2026'); // 'provence-aout-2026'
 * ```
 */
export function toFilenameSegment(value: string, fallback: string): string {
  const folded = value
    .normalize('NFD')
    // Combining marks: the accents that `NFD` just split off their letters.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(UNSAFE_FILENAME_CHARS, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, MAX_FILENAME_LENGTH)
    .replace(/-+$/g, '');

  return folded === '' ? fallback : folded;
}

/**
 * Hands the user a text file the tab generated.
 *
 * Reports whether the browser could do it, so a caller can say something
 * useful instead of leaving a button that looks broken. The two capabilities
 * checked are missing in exactly the places that matter: an old in-app browser,
 * and the jsdom used by the unit tests.
 *
 * @param download - The file name, content and MIME type
 * @returns True when the download was started
 *
 * @example
 * ```typescript
 * downloadTextFile({ filename: 'runs.ics', text: ics, mimeType: ICS_MIME_TYPE });
 * ```
 */
export function downloadTextFile(download: TextFileDownload): boolean {
  if (typeof URL.createObjectURL !== 'function' || typeof Blob !== 'function') {
    return false;
  }

  const blob = new Blob([download.text], { type: download.mimeType }),
    url = URL.createObjectURL(blob),
    anchor = document.createElement('a');

  try {
    anchor.href = url;
    anchor.download = download.filename;
    anchor.rel = 'noopener';
    // Appended rather than clicked detached: Firefox ignores a click on an
    // anchor that is not in the document.
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Revoked on the next tick, not here: Safari reads the blob after the
    // click returns, and a URL revoked inside the same task cancels the save
    // with no error anywhere.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }

  return true;
}
