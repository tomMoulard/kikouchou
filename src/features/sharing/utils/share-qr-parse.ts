/**
 * @fileoverview Extract trip share IDs from QR payloads (URLs or raw codes).
 *
 * @module features/sharing/utils/share-qr-parse
 */

/**
 * Parsed P2P invite link: `/trip/:roomId#encryptionKey` (same format as Share dialog QR).
 */
export interface P2pTripInviteFromScan {
  readonly roomId: string;
  readonly encryptionKey: string;
}

function stripViteBaseFromPath(pathname: string): string {
  const viteBase = import.meta.env.BASE_URL.replace(/\/$/, '');
  let path = pathname.replace(/\/$/, '') || '/';
  if (viteBase && path.startsWith(viteBase)) {
    path = path.slice(viteBase.length) || '/';
  }
  return path;
}

/**
 * If `raw` is a P2P collaboration URL (`/trip/:roomId#key`), returns room id and key.
 * Otherwise `null`. Does not match `/share/:id` guest onboarding links.
 */
export function extractP2pTripInviteFromScannedPayload(
  raw: string,
): P2pTripInviteFromScan | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost';

  try {
    let pathname: string;
    let hash: string;

    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      pathname = url.pathname;
      hash = url.hash.slice(1);
    } else {
      const pathPart = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
      const url = new URL(pathPart, origin);
      pathname = url.pathname;
      hash = url.hash.slice(1);
    }

    if (!hash) {
      return null;
    }

    const path = stripViteBaseFromPath(pathname);
    const match = /^\/trip\/([^/]+)$/.exec(path);
    if (!match?.[1]) {
      return null;
    }

    let encryptionKey: string;
    try {
      encryptionKey = decodeURIComponent(hash);
    } catch {
      encryptionKey = hash;
    }

    return {
      roomId: decodeURIComponent(match[1]),
      encryptionKey,
    };
  } catch {
    return null;
  }
}

/**
 * Returns the share ID if `raw` is a share URL, a path containing `/share/:id`,
 * or a plausible bare share code. Otherwise `null`.
 */
export function extractShareIdFromScannedPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const origin =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost';

  const viteBase = import.meta.env.BASE_URL.replace(/\/$/, '');

  const tryPathname = (pathname: string): string | null => {
    let path = pathname.replace(/\/$/, '') || '/';
    if (viteBase && path.startsWith(viteBase)) {
      path = path.slice(viteBase.length) || '/';
    }
    const match = /\/share\/([^/]+)$/.exec(path);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
    return null;
  };

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      const fromPath = tryPathname(url.pathname);
      if (fromPath) {
        return fromPath;
      }
    } else {
      const pathPart = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
      const url = new URL(pathPart, origin);
      const fromPath = tryPathname(url.pathname);
      if (fromPath) {
        return fromPath;
      }
    }
  } catch {
    // Fall through to bare code
  }

  // Kikouchou share IDs are 10-character nanoids (URL-safe alphabet).
  if (/^[A-Za-z0-9_-]{10}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}
