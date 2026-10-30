/**
 * @fileoverview The address of a trip's or a room's photo, ready for `<img>`.
 *
 * Reads the bytes from this device's cache and turns them into an object URL.
 * When the cache does not hold them and the trip is a member trip, it fetches
 * them from the bucket once, and the live query shows them when they land.
 *
 * No session is read: the bucket's own rule decides who may read, and a
 * device that is not allowed simply gets nothing back. That keeps the hook
 * usable in a card rendered outside the auth provider.
 *
 * @module hooks/usePhotoUrl
 */

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { db } from '@/lib/db/database';
import { fetchTripPhoto } from '@/lib/photos/photo-sync';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { PhotoId, Trip } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** The parts of a trip the hook needs to find a photo. */
export type PhotoTrip = Pick<Trip, 'id' | 'remoteTripId' | 'viewerToken'>;

// ============================================================================
// Hook
// ============================================================================

/**
 * Resolves a photo id to an object URL.
 *
 * @param trip - The trip the photo belongs to
 * @param photoId - The photo, or `undefined` for none
 * @returns The URL, or `undefined` while loading, when there is no photo, or
 *   when the bytes cannot be had
 */
export function usePhotoUrl(
  trip: PhotoTrip | undefined,
  photoId: PhotoId | undefined,
): string | undefined {
  const { isOnline } = useOnlineStatus();
  const tripId = trip?.id;
  const remoteTripId = trip?.remoteTripId;
  const isViewer = trip?.viewerToken !== undefined;

  // `null` once read and absent, so "not here" and "not read yet" differ.
  const blob = useLiveQuery(
    async () => {
      if (!tripId || !photoId) {
        return null;
      }
      const row = await db.photos.get([tripId, photoId]);
      return row?.blob ?? null;
    },
    [tripId, photoId],
  );

  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return undefined;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [blob]);

  useEffect(() => {
    // A viewer has no account, and the bucket admits members only.
    if (blob !== null || !tripId || !photoId || !remoteTripId || isViewer || !isOnline) {
      return;
    }
    void (async () => {
      const client = await getSupabaseClient();
      if (client) {
        await fetchTripPhoto(client, tripId, remoteTripId, photoId);
      }
    })();
  }, [blob, isOnline, isViewer, photoId, remoteTripId, tripId]);

  return url;
}
