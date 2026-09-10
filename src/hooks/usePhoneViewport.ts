/**
 * @fileoverview Which of the layout's two shapes the viewport is asking for.
 *
 * Two named breakpoints, both of them Tailwind's and both of them lines the
 * layout already draws:
 *
 * - `md`, below which the bottom bar replaces the sidebar. Installation is
 *   worth suggesting there, where a Home Screen icon is how apps get opened,
 *   and worth nothing on a laptop, where nobody installs a web app and Firefox
 *   on macOS cannot.
 * - `xl`, above which the trip pages carry the organiser's column beside them.
 *
 * The queries live here rather than in the components so that the breakpoint
 * a component gates on is the same number the stylesheet uses.
 *
 * @module hooks/usePhoneViewport
 */

import { useMediaQuery } from '@/hooks/useMediaQuery';

// ============================================================================
// Constants
// ============================================================================

/** Below Tailwind's `md` (768px): the layout shows the bottom bar here. */
export const PHONE_MEDIA_QUERY = '(max-width: 767px)';

/** From Tailwind's `xl` (1280px): the width the organiser's column needs. */
export const WIDE_MEDIA_QUERY = '(min-width: 1280px)';

// ============================================================================
// Hooks
// ============================================================================

/**
 * True on a phone-sized viewport, and kept current across rotation and resize.
 *
 * @returns Whether the viewport is narrower than the `md` breakpoint
 */
export function usePhoneViewport(): boolean {
  return useMediaQuery(PHONE_MEDIA_QUERY);
}

/**
 * True where a second column fits, and kept current across resize.
 *
 * Gating the render rather than only the CSS is deliberate: the column mounts
 * cards that read the trip's contexts and, for the accounts, the database. A
 * phone that will never show it should not pay for it, and a document holding
 * a hidden second copy of every guest and room name is a document every text
 * search has to disambiguate.
 *
 * @returns Whether the viewport is at least as wide as the `xl` breakpoint
 */
export function useWideViewport(): boolean {
  return useMediaQuery(WIDE_MEDIA_QUERY);
}
