/**
 * @fileoverview Extract trip share IDs from QR payloads (URLs or raw codes).
 *
 * @module features/sharing/utils/share-qr-parse
 */

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

  // Kikoushou share IDs are 10-character nanoids (URL-safe alphabet).
  if (/^[A-Za-z0-9_-]{10}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}
