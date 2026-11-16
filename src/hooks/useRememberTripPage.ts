/**
 * @fileoverview Remembers which page of a trip is on screen.
 *
 * An invite link opened again on this device goes back to that page instead of
 * asking "Which one are you?" a second time (`JoinTripPage`). Mounted in
 * `Layout`, because every page of a trip renders inside it and the join page
 * does not.
 *
 * @module hooks/useRememberTripPage
 */

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { rememberTripPage } from '@/lib/navigation/last-trip-page';

// ============================================================================
// Hook
// ============================================================================

/** Stores the trip page on screen each time the path changes. */
export function useRememberTripPage(): void {
  const { pathname } = useLocation();

  useEffect(() => {
    rememberTripPage(pathname);
  }, [pathname]);
}
