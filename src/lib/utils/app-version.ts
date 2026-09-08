/**
 * @fileoverview The build version, shortened for the Settings screen.
 *
 * CI builds set `VITE_APP_VERSION` from the git metadata: `${{ github.sha }}`
 * on a check run and `<ref>@${{ github.sha }}` on a deploy. Both carry the full
 * 40-character sha, which the About card printed whole — a wall of hex that
 * pushed the label off a phone screen and that nobody reads past the first few
 * characters. Seven characters is what git itself shows and what a reader
 * copies into `git show`.
 *
 * @module lib/utils/app-version
 */

/** Shown when the build passed no version at all. */
const FALLBACK_VERSION = 'devel';

/** Characters of a commit sha worth showing, matching git's own short form. */
const SHORT_SHA_LENGTH = 7;

/** A full commit sha, on its own or after a `<ref>@` prefix. */
const FULL_SHA_PATTERN = /\b[0-9a-f]{40}\b/giu;

/**
 * Shortens any full commit sha inside a version string.
 *
 * Anything that is not a sha is left alone, so a semantic version, a tag name
 * or an already-short sha reads exactly as the build set it.
 *
 * @param raw - The raw `VITE_APP_VERSION` value; empty or blank yields `'devel'`
 * @returns The version to display
 *
 * @example
 * ```ts
 * formatAppVersion('main@4d1f1b3a0c9e5d7f2a8b6c4e0d9f3a1b5c7e9d2f'); // 'main@4d1f1b3'
 * formatAppVersion('0.1.0');                                        // '0.1.0'
 * ```
 */
export function formatAppVersion(raw: string): string {
  const version = raw.trim();
  if (!version) {
    return FALLBACK_VERSION;
  }

  return version.replace(FULL_SHA_PATTERN, (sha) => sha.slice(0, SHORT_SHA_LENGTH));
}
