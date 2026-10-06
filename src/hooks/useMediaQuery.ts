/**
 * @fileoverview One implementation of "does this viewport match?".
 *
 * A CSS class is the right answer when the markup is cheap and only its
 * appearance changes: `hidden xl:block` costs nothing but a rule. It is the
 * wrong answer when the hidden branch *does* something — mounts a component,
 * runs a live query, adds a second copy of every name to the document — because
 * a phone then pays for a column it will never show.
 *
 * The reads are guarded rather than assumed. `matchMedia` is missing in a
 * server render and in some test environments, and Safari has historically
 * thrown on a query string it could not parse; either way the answer is "no
 * match", which renders the smaller layout rather than nothing at all.
 *
 * @module hooks/useMediaQuery
 */

import { useEffect, useState } from 'react';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Reads a media query once, without throwing.
 *
 * @param query - A CSS media query
 * @returns Whether it matches now, and `false` when it cannot be asked
 */
function readMediaQuery(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia(query).matches === true;
  } catch {
    return false;
  }
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Whether the viewport matches a media query, kept current as it changes.
 *
 * The first value comes from the query itself rather than from `false`, so a
 * layout that depends on it does not render its narrow arm for one frame on a
 * wide screen.
 *
 * @param query - A CSS media query, e.g. `(min-width: 1280px)`
 * @returns Whether the viewport matches
 *
 * @example
 * ```tsx
 * const isWide = useMediaQuery('(min-width: 1280px)');
 * return isWide ? <TwoColumns /> : <OneColumn />;
 * ```
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => readMediaQuery(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    let list: MediaQueryList;
    try {
      list = window.matchMedia(query);
    } catch {
      return;
    }

    // The query may have changed since the state was seeded, and a resize can
    // land between the render and this effect.
    setMatches(list.matches === true);

    const update = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };
    list.addEventListener('change', update);
    return () => {
      list.removeEventListener('change', update);
    };
  }, [query]);

  return matches;
}
