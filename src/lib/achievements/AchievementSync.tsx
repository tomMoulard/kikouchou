/**
 * @fileoverview The app-wide half of achievements: the start-up checks, the
 * "achievement unlocked" message, and the account sync.
 *
 * Mounted once, beside `TripArchiveSync`, and renders nothing.
 *
 * - **On start.** Counts the trips this device made before achievements
 *   existed, and checks the date for `leap_day`.
 * - **On an unlock.** Shows one toast. Unlocks that land within
 *   {@link BATCH_MS} of each other (a backfill, a sync) share it, so a person
 *   with twelve trips sees one message and not three.
 * - **Signed in.** Syncs with the account when a session appears, the network
 *   returns, the tab comes back into view, or an unlock waits for upload.
 *
 * @module lib/achievements/AchievementSync
 */

import { useCallback, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/AuthContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { db } from '@/lib/db/database';
import { notify } from '@/lib/notifications';
import { getSupabaseClient } from '@/lib/supabase/client';

import type { AchievementKey } from './definitions';
import { backfillTripsFromDevice, onAchievementsUnlocked, recordAppOpened } from './store';
import { syncAchievements } from './sync';

// ============================================================================
// Constants
// ============================================================================

/** Unlocks closer together than this share one message. */
const BATCH_MS = 400;

// ============================================================================
// Component
// ============================================================================

/**
 * Runs achievements for the whole app.
 *
 * @returns Nothing. This is a behaviour, not a surface.
 */
export function AchievementSync(): null {
  const { t } = useTranslation();
  const { session } = useAuth();
  const { isOnline } = useOnlineStatus();
  const userId = session?.user.id ?? null;

  // --------------------------------------------------------------------------
  // The message
  // --------------------------------------------------------------------------

  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    let pending: AchievementKey[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const flush = (): void => {
      timer = undefined;
      const keys = pending;
      pending = [];
      const translate = tRef.current,
        names = keys.map((key) => translate(`achievements.items.${key}.name`));
      if (keys.length === 1) {
        notify.reward(translate('achievements.unlocked', 'Achievement unlocked'), names[0]);
      } else if (keys.length > 1) {
        notify.reward(
          translate('achievements.unlockedMany', {
            count: keys.length,
            defaultValue: '{{count}} achievements unlocked',
          }),
          names.join(' · '),
        );
      }
    };

    const unsubscribe = onAchievementsUnlocked((keys) => {
      pending = [...pending, ...keys];
      if (timer === undefined) {
        timer = setTimeout(flush, BATCH_MS);
      }
    });

    return () => {
      unsubscribe();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, []);

  // --------------------------------------------------------------------------
  // Start-up checks
  // --------------------------------------------------------------------------

  useEffect(() => {
    void backfillTripsFromDevice();
    void recordAppOpened();
  }, []);

  // --------------------------------------------------------------------------
  // The account sync
  // --------------------------------------------------------------------------

  /** Unlocks waiting for this account, as a stable string. */
  const pendingKey = useLiveQuery(async () => {
    const rows = await db.achievements.toArray();
    return rows
      .filter((row) => row.uploadedBy !== userId)
      .map((row) => row.key)
      .sort()
      .join(',');
  }, [userId]);

  const inFlightRef = useRef(false);
  const rerunRef = useRef(false);
  // Set when the server has no achievements table: asking again before a
  // reload answers the same.
  const unavailableRef = useRef(false);

  const run = useCallback(async (): Promise<void> => {
    if (!userId || unavailableRef.current) {
      return;
    }
    if (inFlightRef.current) {
      rerunRef.current = true;
      return;
    }

    inFlightRef.current = true;
    try {
      do {
        rerunRef.current = false;
        const result = await syncAchievements(await getSupabaseClient(), userId);
        if (result.status === 'error') {
          // Loud in the console, silent in the UI: the badges work offline.
          console.warn('[achievements] sync failed:', result.message);
          if (result.reason === 'unavailable') {
            unavailableRef.current = true;
          }
          break;
        }
      } while (rerunRef.current);
    } catch (error: unknown) {
      console.warn(
        '[achievements] could not run the sync:',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      inFlightRef.current = false;
    }
  }, [userId]);

  // A session, or the network, appeared.
  useEffect(() => {
    if (!userId || !isOnline) {
      return;
    }
    void run();
  }, [isOnline, run, userId]);

  // An unlock waits for upload. An empty list is not a reason to ask: the
  // upload itself empties it.
  useEffect(() => {
    if (!userId || !isOnline || !pendingKey) {
      return;
    }
    void run();
  }, [isOnline, pendingKey, run, userId]);

  useEffect(() => {
    if (!userId || !isOnline) {
      return;
    }
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        void run();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOnline, run, userId]);

  return null;
}
