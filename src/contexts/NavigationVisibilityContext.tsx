/**
 * @fileoverview Lets a page take the app's navigation off the screen.
 *
 * `Layout` owns the sidebar and the bottom bar, but only the page knows when
 * they have nowhere useful to go. The first-trip wizard is the case: on the
 * first visit there is no trip, so every trip tab is disabled, and the bar is
 * one more thing to read beside the one question the wizard asks.
 *
 * The layout holds the state and provides the setter; a page calls
 * {@link useHideNavigation} and the navigation comes back when the page says
 * so or unmounts.
 *
 * @module contexts/NavigationVisibilityContext
 */

import { createContext, useContext, useEffect } from 'react';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Sets whether the current page hides the navigation.
 */
export type SetNavigationHidden = (hidden: boolean) => void;

// ============================================================================
// Context
// ============================================================================

/**
 * What a page sees outside the layout: a setter that does nothing.
 *
 * A default rather than a throw, like `InstallPromptContext`: a page rendered
 * in a test without the layout has no navigation to hide, and doing nothing is
 * exactly right there.
 */
const NO_LAYOUT: SetNavigationHidden = () => {};

export const NavigationVisibilityContext = createContext<SetNavigationHidden>(NO_LAYOUT);

// ============================================================================
// Hook
// ============================================================================

/**
 * Hides the sidebar and the bottom bar while `hidden` is true.
 *
 * The cleanup puts them back, so a page that navigates away mid-flow never
 * leaves the next page without its navigation.
 *
 * @param hidden - Whether the navigation should be off the screen
 */
export function useHideNavigation(hidden: boolean): void {
  const setHidden = useContext(NavigationVisibilityContext);

  useEffect(() => {
    setHidden(hidden);
    return () => {
      setHidden(false);
    };
  }, [hidden, setHidden]);
}
