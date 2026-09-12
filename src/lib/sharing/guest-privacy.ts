/**
 * @fileoverview What of a guest record is allowed to leave this device.
 *
 * Pure, and deliberately separate from the flag that drives it: the boundaries
 * that call this — the Yjs document writers and the QR changeset builders —
 * each read {@link isGuestPhoneSharingEnabled} once and pass the answer in, so
 * the redaction itself can be tested without a PostHog client and read without
 * chasing a global.
 *
 * @module lib/sharing/guest-privacy
 */

// ============================================================================
// Types
// ============================================================================

/**
 * The parts of a guest this module decides about.
 *
 * `phone` is `unknown` rather than `string` so the constraint also admits the
 * loosely typed `SharedRecord` the Yjs writers hand around, which carries an
 * `unknown`-valued index signature instead of named fields.
 *
 * `id` is required, and not only because a guest has one: a constraint of
 * nothing but optional properties is a *weak type*, which TypeScript then
 * infers in preference to the argument's own type — every call site collapsed
 * to `Shareable` and stopped type-checking as the record it actually passed.
 */
interface Shareable {
  readonly id: string;
  phone?: unknown;
}

// ============================================================================
// Redaction
// ============================================================================

/**
 * Returns the guest as it may be published, dropping what this device is not
 * allowed to share.
 *
 * The phone is **deleted from the returned object rather than set to
 * `undefined`**, and the difference matters at both call sites:
 * `upsertDocEntity` prunes any key the entity does not carry, so an absent
 * `phone` actively removes a number the document already held — flipping the
 * flag off un-shares what a previous session shared, instead of leaving it
 * behind on every other member's device.
 *
 * @param guest - The guest row as Dexie holds it
 * @param options.sharePhone - Whether the phone may leave this device
 * @returns A copy safe to publish; the input is never mutated
 *
 * @example
 * ```typescript
 * const sharePhone = isGuestPhoneSharingEnabled();
 * const published = guests.map((guest) => toSharedGuest(guest, { sharePhone }));
 * ```
 */
export function toSharedGuest<T extends Shareable>(
  guest: T,
  options: { readonly sharePhone: boolean },
): T {
  if (options.sharePhone || guest.phone === undefined) {
    return guest;
  }

  const redacted = { ...guest };
  delete redacted.phone;
  return redacted;
}
