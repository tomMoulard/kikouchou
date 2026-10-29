/**
 * @fileoverview Sends the photos this device holds alone, once there is an
 * account and a network to send them with.
 *
 * Mounted once, beside `AccountTripSync`, for the same reason: the promise is
 * about every trip, not about a screen. Renders nothing.
 *
 * It runs when the set of uploadable photos changes (a photo is added, or a
 * local-only trip is uploaded and its photos become uploadable), when a
 * session appears, and when the network comes back. A photo that failed stays
 * in the set, so it does not restart the pass by itself; the next change or
 * the next reconnect tries it again.
 *
 * @module lib/photos/PhotoUploadSync
 */

import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useAuth } from '@/features/auth/AuthContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { getSupabaseClient } from '@/lib/supabase/client';

import { readUploadablePhotoKey, uploadPendingPhotos } from './photo-sync';

// ============================================================================
// Component
// ============================================================================

/**
 * Uploads pending photos in the background.
 *
 * @returns Nothing. This is a behaviour, not a surface.
 */
export function PhotoUploadSync(): null {
  const { session } = useAuth();
  const { isOnline } = useOnlineStatus();
  const userId = session?.user.id ?? null;

  const uploadableKey = useLiveQuery(readUploadablePhotoKey, []);

  /** Passes run one after another, so one photo is never sent twice at once. */
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (userId === null || !isOnline || !uploadableKey) {
      return;
    }

    chainRef.current = chainRef.current
      .then(async () => {
        const client = await getSupabaseClient();
        if (!client) {
          return;
        }
        await uploadPendingPhotos(client);
      })
      // A rejected chain would refuse every later pass, so it is caught here.
      .catch((error: unknown) => {
        console.warn(
          '[photos] could not run the upload pass:',
          error instanceof Error ? error.message : String(error),
        );
      });
  }, [isOnline, uploadableKey, userId]);

  return null;
}
