/**
 * @fileoverview The trip a sign-in was started for, across the redirect.
 *
 * The first-trip wizard ends on its invite screen, and a first visitor has no
 * account, so that screen asks for one. Google and a magic link both leave the
 * page and come back to `/`, where the wizard and the trip it just made are
 * gone from the screen. This key is what brings the person back to the link
 * they were about to send: `PendingInviteDialog` reads it on load and opens
 * the share dialog once the session is there.
 *
 * It holds a local trip id and a time, nothing else. It expires, so a sign-in
 * abandoned today does not open a dialog the next time the person signs in
 * from somewhere else.
 *
 * @module features/sharing/utils/pending-invite
 */

import type { TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

export const PENDING_INVITE_KEY = 'kikouchou-pending-invite';

/** Long enough for a magic link to arrive and be clicked, no longer. */
export const PENDING_INVITE_TTL_MS = 30 * 60 * 1000;

// ============================================================================
// Exports
// ============================================================================

/**
 * Remembers the trip a sign-in is about to be started for.
 *
 * @param tripId - The local trip to share once signed in
 * @param now - The current time, in milliseconds
 */
export function rememberPendingInvite(tripId: TripId, now: number = Date.now()): void {
  try {
    localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ tripId, savedAt: now }));
  } catch {
    // Storage blocked: the person finds the share button on the trip instead.
  }
}

/**
 * The trip a sign-in was started for, while it is recent enough to act on.
 *
 * An expired or unreadable entry is removed on the way.
 *
 * @param now - The current time, in milliseconds
 * @returns The trip id, or null
 */
export function readPendingInvite(now: number = Date.now()): TripId | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'tripId' in parsed &&
      'savedAt' in parsed &&
      typeof parsed.tripId === 'string' &&
      parsed.tripId !== '' &&
      typeof parsed.savedAt === 'number' &&
      now - parsed.savedAt >= 0 &&
      now - parsed.savedAt <= PENDING_INVITE_TTL_MS
    ) {
      return parsed.tripId as TripId;
    }
  } catch {
    // Not JSON: dropped below like any other entry this code did not write.
  }
  forgetPendingInvite();
  return null;
}

/** Drops the entry: the link was shown, or the person moved on. */
export function forgetPendingInvite(): void {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Storage blocked: nothing was written either.
  }
}
