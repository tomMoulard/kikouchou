/**
 * @fileoverview Acts on a link the operating system opened the store app with.
 *
 * Kept out of `NativeShell.tsx` so that file exports components only, which
 * is what React's fast refresh needs.
 *
 * @module components/native/open-deep-link
 */

import { resolveDeepLink } from '@/lib/native/deep-links';
import { NATIVE_URL_SCHEME, getPublicAppOrigin } from '@/lib/platform';
import { deliverAuthCallbackUrl } from '@/lib/supabase/auth-callback';
import { router } from '@/router';

function shareOrigin(): string {
  const configured = import.meta.env.VITE_SHARE_ORIGIN;
  return typeof configured === 'string' ? configured.trim() : '';
}

/**
 * Acts on a link the operating system opened the app with.
 *
 * @param url - The link
 */
export function openDeepLink(url: string): void {
  const target = resolveDeepLink(url, {
    app: getPublicAppOrigin(),
    share: shareOrigin(),
    scheme: NATIVE_URL_SCHEME,
  });
  switch (target.kind) {
    case 'auth':
      deliverAuthCallbackUrl(url);
      if (target.then !== null) {
        void router.navigate(target.then, { replace: true });
      }
      return;
    case 'navigate':
      void router.navigate(target.to);
      return;
    default:
      return;
  }
}
