/**
 * @fileoverview Whether the page is on a phone-sized screen.
 *
 * The one question behind "phones only": installation is worth suggesting
 * where a Home Screen icon is how apps get opened, and worth nothing on a
 * laptop, where nobody installs a web app and Firefox on macOS cannot. The
 * breakpoint is Tailwind's `md`, the same line the layout draws between the
 * bottom bar and the sidebar, so "phone" here means what it means everywhere
 * else in the app.
 *
 * @module hooks/usePhoneViewport
 */

import { useEffect, useState } from 'react';

// ============================================================================
// Constants
// ============================================================================

/** Below Tailwind's `md` (768px): the layout shows the bottom bar here. */
export const PHONE_MEDIA_QUERY = '(max-width: 767px)';

// ============================================================================
// Helpers
// ============================================================================

function readPhoneViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia(PHONE_MEDIA_QUERY).matches === true;
  } catch {
    return false;
  }
}

// ============================================================================
// Hook
// ============================================================================

/**
 * True on a phone-sized viewport, and kept current across rotation and resize.
 *
 * @returns Whether the viewport is narrower than the `md` breakpoint
 */
export function usePhoneViewport(): boolean {
  const [isPhone, setIsPhone] = useState<boolean>(readPhoneViewport);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia(PHONE_MEDIA_QUERY);
    const update = (event: MediaQueryListEvent): void => {
      setIsPhone(event.matches);
    };
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
    };
  }, []);

  return isPhone;
}
