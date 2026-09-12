/**
 * @fileoverview The `guest-phone-sharing` PostHog flag.
 *
 * The flag decides one thing: whether a guest's phone number leaves this
 * device. It never decides whether the number is *kept* — `Person.phone` is
 * written to IndexedDB either way, so turning the flag off is not data loss and
 * turning it on later publishes what is already there.
 *
 * Two consequences follow from that split, and both are load-bearing:
 *
 * - **Outbound**, every writer that puts a guest into the shared document or
 *   into a QR changeset redacts the phone while the flag is off.
 * - **Inbound**, the projection must *not* read the document's silence about a
 *   phone as a deletion while the flag is off — this device never published it,
 *   so the document was never going to mention it, and a plain overwrite would
 *   have this device's own sync loop wipe the number the user just typed.
 *   With the flag on the document is authoritative again and a cleared phone
 *   propagates normally.
 *
 * @module lib/flags/guest-phone-sharing
 */

import posthog from '@/lib/posthog';

// ============================================================================
// Constants
// ============================================================================

/** The flag's key in PostHog. */
export const GUEST_PHONE_SHARING_FLAG = 'guest-phone-sharing';

// ============================================================================
// Reads
// ============================================================================

/**
 * Whether this device may share guest phone numbers.
 *
 * Fails closed, in three different ways, because every one of them means "we do
 * not know that sharing was allowed" and the cost of guessing wrong is somebody
 * else's phone number on a server:
 *
 * - no PostHog client at all (no `VITE_POSTHOG_KEY`: a fresh clone, a fork's
 *   CI, every unit test);
 * - flags not downloaded yet — `isFeatureEnabled` answers `undefined` for the
 *   first moments of a page's life, which is not a yes;
 * - the client throwing, which analytics is never allowed to do to the app.
 *
 * The early-load case does mean a device whose flag is on spends its first
 * moments not publishing phones, and may briefly redact one that was already in
 * the document. The next Dexie change re-publishes it — the collection is
 * rewritten on every live-query tick — so the state converges rather than
 * sticking.
 *
 * @returns `true` only on an explicit enable
 */
export function isGuestPhoneSharingEnabled(): boolean {
  try {
    return posthog?.isFeatureEnabled(GUEST_PHONE_SHARING_FLAG) === true;
  } catch {
    return false;
  }
}
