/**
 * Ride Notice Repository
 *
 * Reads and writes {@link RideNoticeRow} — this device's record of what it has
 * already shown the user about a ride, and what a leg's time was the last time
 * it did.
 *
 * ## Why a watermark exists at all
 *
 * `Transport` carries no `updatedAt` and keeps no history, so "Alice moved her
 * pickup from 17:00 to 19:00" is not a fact any record states. It is only ever
 * a *difference* — between the time this phone last showed and the time the
 * document now holds. That difference has to be stored somewhere, and it has to
 * be stored per device: two phones open the app on different days and have
 * genuinely different news.
 *
 * Which is also why none of this syncs. Were these rows in the document, the
 * first device to open the app each morning would mark everything seen and
 * silently suppress everybody else's alerts.
 *
 * @module lib/db/repositories/ride-notice-repository
 */

import { db, type RideNoticeRow } from '@/lib/db/database';
import type { RideId, TransportId, TripId } from '@/types';

// ============================================================================
// Keys
// ============================================================================

/**
 * What a notice is about.
 *
 * - `leave` — "you need to set off now", fired once per ride per device.
 * - `moved` — a passenger's leg time, watermarked so a change can be spotted.
 */
export type RideNoticeKind = 'leave' | 'moved';

/**
 * Builds the primary key for a notice.
 *
 * Composed into one string rather than declared as a compound index because a
 * notice hangs off different ids depending on its kind, and a compound key
 * would need a placeholder column for whichever id does not apply — a row
 * missing the second half of a compound index is invisible to every query that
 * uses it.
 *
 * @param kind - What the notice is about
 * @param subjectId - The ride or transport it concerns
 * @returns The row key
 */
export function rideNoticeKey(
  kind: RideNoticeKind,
  subjectId: RideId | TransportId,
): string {
  return `${kind}:${subjectId}`;
}

// ============================================================================
// Reads
// ============================================================================

/**
 * Reads every notice this device holds for a trip.
 *
 * Returned as a `Map` keyed by row key because callers ask about a whole list
 * of rides at once — one lookup per leg against a map, rather than one Dexie
 * round trip per leg inside a render.
 *
 * @param tripId - The trip to read within
 * @returns Notices keyed by {@link rideNoticeKey}
 */
export async function getRideNotices(
  tripId: TripId,
): Promise<Map<string, RideNoticeRow>> {
  const rows = await db.rideNotices.where('tripId').equals(tripId).toArray();

  return new Map(rows.map((row) => [row.key, row]));
}

// ============================================================================
// Writes
// ============================================================================

/**
 * Records the leg time this device has now shown the user.
 *
 * Called when the user has actually seen the change — acknowledging a card,
 * not merely rendering one. Advancing the watermark on render would mean a
 * change that arrived while the phone was in a pocket is marked read.
 *
 * @param tripId - The trip the leg belongs to
 * @param transportId - The leg being watermarked
 * @param datetime - The leg's datetime as shown, ISO 8601
 */
export async function markTransportSeen(
  tripId: TripId,
  transportId: TransportId,
  datetime: string,
): Promise<void> {
  await db.rideNotices.put({
    key: rideNoticeKey('moved', transportId),
    tripId,
    seenDatetime: datetime,
  });
}

/**
 * Records that this device has announced a notice, so it does not repeat.
 *
 * @param tripId - The trip the subject belongs to
 * @param kind - What the notice was about
 * @param subjectId - The ride or transport it concerned
 * @param firedAtMs - When it was announced, epoch ms
 */
export async function markNoticeFired(
  tripId: TripId,
  kind: RideNoticeKind,
  subjectId: RideId | TransportId,
  firedAtMs: number,
): Promise<void> {
  const key = rideNoticeKey(kind, subjectId),
    existing = await db.rideNotices.get(key);

  await db.rideNotices.put({ ...existing, key, tripId, firedAtMs });
}

/**
 * Forgets every notice attached to one ride.
 *
 * Used when a ride is cancelled: its `leave` row would otherwise sit in the
 * table for the life of the trip, and if the same id ever came back over a
 * re-join the alert would be suppressed as already fired.
 *
 * @param rideId - The ride whose notices to drop
 */
export async function clearRideNotices(rideId: RideId): Promise<void> {
  await db.rideNotices.delete(rideNoticeKey('leave', rideId));
}
