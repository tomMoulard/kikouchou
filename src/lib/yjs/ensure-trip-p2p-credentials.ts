/**
 * @fileoverview Ensures a trip has WebRTC/Yjs room credentials persisted in Dexie.
 * Called when opening a trip (so sync can start without opening Share) and from ShareDialog.
 *
 * @module lib/yjs/ensure-trip-p2p-credentials
 */

import { nanoid } from 'nanoid';

import { db } from '@/lib/db/database';
import type { TripId } from '@/types';

export interface TripP2pCredentials {
  readonly roomId: string;
  readonly encryptionKey: string;
}

/**
 * If the trip is missing `p2pRoomId` or `p2pEncryptionKey`, generates and saves a new pair.
 * @returns The effective credentials, or `null` if the trip does not exist.
 */
export async function ensureTripP2pCredentials(
  tripId: TripId,
): Promise<TripP2pCredentials | null> {
  const trip = await db.trips.get(tripId);
  if (!trip) {
    return null;
  }

  if (trip.p2pRoomId && trip.p2pEncryptionKey) {
    return {
      roomId: trip.p2pRoomId,
      encryptionKey: trip.p2pEncryptionKey,
    };
  }

  const roomId = nanoid(12);
  const encryptionKey = nanoid(24);

  await db.trips.update(tripId, {
    p2pRoomId: roomId,
    p2pEncryptionKey: encryptionKey,
  });

  return { roomId, encryptionKey };
}
