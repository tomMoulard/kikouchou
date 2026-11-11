/**
 * @fileoverview Asking a media query, and following it, on any browser.
 *
 * `MediaQueryList` is not one shape everywhere. Safari before 14 has only the
 * deprecated `addListener`/`removeListener`, and some Android in-app browsers
 * (seen from a Google Ads click, Chrome 155 UA) hand back a stub with
 * `matches` and no listener method at all. A hook that calls
 * `list.addEventListener` there throws `addEventListener is not a function`
 * from an effect, and inside Layout that sends the whole app to the route
 * error page.
 *
 * So both halves are guarded here, once: opening the list, and subscribing to
 * it. A list that cannot be followed still answers `matches`; it simply never
 * reports a change, which is the same answer a page gets until it reloads.
 *
 * @module lib/utils/media-query
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * What a change listener reads. A modern `change` event and the legacy
 * callback argument (the list itself, in old Safari) both carry `matches`.
 */
export type MediaQueryChangeListener = (event: Pick<MediaQueryListEvent, 'matches'>) => void;

/**
 * The listener methods a list may or may not have. Every one is optional,
 * because a stub can lack any of them.
 */
interface LooseMediaQueryList {
  readonly addEventListener?: unknown;
  readonly removeEventListener?: unknown;
  readonly addListener?: unknown;
  readonly removeListener?: unknown;
}

type Subscribe = (this: unknown, ...args: unknown[]) => unknown;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Opens a media query, without throwing.
 *
 * @param query - A CSS media query
 * @returns The list, or `null` where `matchMedia` is missing or throws on the
 *   query (old Safari on a string it cannot parse, a stub that throws)
 */
export function openMediaQuery(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  try {
    const list = window.matchMedia(query) as MediaQueryList | null | undefined;
    return list ?? null;
  } catch {
    return null;
  }
}

/**
 * Reads whether a list matches, without throwing.
 *
 * @param list - A list from {@link openMediaQuery}, or `null`
 * @returns Its `matches`, and `false` when there is no list or the read throws
 */
export function readMediaQueryMatches(list: MediaQueryList | null): boolean {
  if (list === null) {
    return false;
  }
  try {
    return list.matches === true;
  } catch {
    return false;
  }
}

/**
 * Calls one of the list's methods when it has it, and reports whether it did.
 *
 * @param list - The list, of whatever shape the browser gave
 * @param method - The method to call
 * @param args - Its arguments
 * @returns True when the method existed and returned without throwing
 */
function callIfPresent(
  list: LooseMediaQueryList,
  method: keyof LooseMediaQueryList,
  ...args: unknown[]
): boolean {
  const fn = list[method];
  if (typeof fn !== 'function') {
    return false;
  }
  try {
    (fn as Subscribe).apply(list, args);
    return true;
  } catch {
    return false;
  }
}

/**
 * Follows a media query's changes, on whichever API the list has.
 *
 * Prefers `addEventListener('change')`, falls back to the deprecated
 * `addListener`, and otherwise subscribes to nothing. The returned function
 * removes the listener through the same API it was added with, and is safe to
 * call on a list that never accepted it.
 *
 * @param list - A list from {@link openMediaQuery}; `null` subscribes to nothing
 * @param listener - Called with the new `matches` on each change
 * @returns A function that stops following the query
 *
 * @example
 * ```ts
 * const stop = subscribeToMediaQuery(openMediaQuery('(min-width: 1280px)'), (e) => {
 *   setWide(e.matches);
 * });
 * ```
 */
export function subscribeToMediaQuery(
  list: MediaQueryList | null,
  listener: MediaQueryChangeListener,
): () => void {
  if (list === null) {
    return () => {};
  }
  const loose = list as LooseMediaQueryList;

  if (callIfPresent(loose, 'addEventListener', 'change', listener)) {
    return () => {
      callIfPresent(loose, 'removeEventListener', 'change', listener);
    };
  }

  if (callIfPresent(loose, 'addListener', listener)) {
    return () => {
      callIfPresent(loose, 'removeListener', listener);
    };
  }

  return () => {};
}
