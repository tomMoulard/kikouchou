/**
 * @fileoverview Unlocking achievements, and the events that unlock them.
 *
 * An achievement is unlocked on the device, in Dexie, the moment the thing it
 * rewards happens. Nothing here waits on a network: the account sync
 * (`./sync`) uploads later, and pulls what the account's other devices hold.
 *
 * The `record…` functions are what the rest of the app calls. Each one is safe
 * to call and forget: it never throws, and a failure costs an achievement, not
 * the save that triggered it. They return a promise so a test can wait for it.
 *
 * A new unlock is announced to the listeners of {@link onAchievementsUnlocked}
 * (`AchievementSync` shows it in the page) and reported to PostHog as
 * `achievement_unlocked` with the key alone. A row pulled from the account is
 * not announced: it is not news on this device's screen.
 *
 * @module lib/achievements/store
 */

import {
  buildNightlyOccupancyByRoom,
  createHeadcountResolver,
} from '@/features/rooms/utils/capacity-utils';
import { db } from '@/lib/db/database';
import { captureEvent } from '@/lib/posthog';
import type { RoomId, TripId } from '@/types';

import {
  ACHIEVEMENTS,
  GROUP_ACTIVITY_SIZE,
  isAchievementKey,
  keysEarnedByCounter,
  type AchievementCounter,
  type AchievementKey,
} from './definitions';

// ============================================================================
// Listeners
// ============================================================================

/** Called with the keys a single unlock added, in definition order. */
export type AchievementsUnlockedListener = (keys: readonly AchievementKey[]) => void;

const listeners = new Set<AchievementsUnlockedListener>();

/**
 * Subscribes to new unlocks on this device.
 *
 * @param listener - Called once per unlock that added at least one key.
 * @returns The unsubscribe function.
 */
export function onAchievementsUnlocked(listener: AchievementsUnlockedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function announce(keys: readonly AchievementKey[]): void {
  for (const key of keys) {
    const definition = ACHIEVEMENTS.find((a) => a.key === key);
    captureEvent('achievement_unlocked', { key, hidden: definition?.kind === 'hidden' });
  }
  for (const listener of listeners) {
    try {
      listener(keys);
    } catch (error: unknown) {
      console.warn('[achievements] a listener failed:', error);
    }
  }
}

// ============================================================================
// Unlocking
// ============================================================================

/**
 * Unlocks the given achievements, once each.
 *
 * @param keys - The keys to unlock. Keys already held are skipped.
 * @param options - `silent` writes without announcing, for rows pulled from
 *   the account; `unlockedAt` overrides the date.
 * @returns The keys this call added, in definition order.
 */
export async function unlockAchievements(
  keys: readonly AchievementKey[],
  options: { readonly silent?: boolean; readonly unlockedAt?: number } = {},
): Promise<AchievementKey[]> {
  if (keys.length === 0) {
    return [];
  }
  const unlockedAt = options.unlockedAt ?? Date.now();

  const added = await db.transaction('rw', db.achievements, async () => {
    const held = new Set(
      (await db.achievements.bulkGet([...keys])).flatMap((row) => (row ? [row.key] : [])),
    );
    const fresh = ACHIEVEMENTS.map((a) => a.key).filter(
      (key) => keys.includes(key) && !held.has(key),
    );
    await db.achievements.bulkAdd(fresh.map((key) => ({ key, unlockedAt })));
    return fresh;
  });

  if (added.length > 0 && options.silent !== true) {
    announce(added);
  }
  return added;
}

/**
 * Reads a counter.
 *
 * @param counter - Which counter.
 * @returns Its value, 0 when it was never written.
 */
export async function readCounter(counter: AchievementCounter): Promise<number> {
  return (await db.achievementCounters.get(counter))?.value ?? 0;
}

/**
 * Moves a counter, then unlocks what its new value earns.
 *
 * @param counter - Which counter.
 * @param next - Computes the new value from the stored one.
 * @param silent - Unlock without a toast or an analytics event.
 * @returns The new value.
 */
async function moveCounter(
  counter: AchievementCounter,
  next: (current: number) => number,
  silent: boolean,
): Promise<number> {
  const value = await db.transaction('rw', db.achievementCounters, async () => {
    const current = (await db.achievementCounters.get(counter))?.value ?? 0,
      updated = next(current);
    if (updated !== current) {
      await db.achievementCounters.put({ key: counter, value: updated });
    }
    return updated;
  });
  await unlockAchievements(keysEarnedByCounter(counter, value), { silent });
  return value;
}

/**
 * Adds to a counter.
 *
 * @param counter - Which counter.
 * @param by - How much, 1 by default.
 * @returns The new value.
 */
export function incrementCounter(counter: AchievementCounter, by = 1): Promise<number> {
  return moveCounter(counter, (current) => current + by, false);
}

/**
 * Raises a counter to at least a value, and never lowers it.
 *
 * Used to backfill: the trips a person created before this build, counted on
 * the device or by the account. What it unlocks is silent, because it runs on
 * a page load where the person did nothing: a toast there would greet them
 * for an old trip, and sat over the FAB and the install banner.
 *
 * @param counter - Which counter.
 * @param atLeast - The floor.
 * @returns The new value.
 */
export function raiseCounter(counter: AchievementCounter, atLeast: number): Promise<number> {
  return moveCounter(counter, (current) => Math.max(current, Math.floor(atLeast)), true);
}

// ============================================================================
// Events
// ============================================================================

/**
 * Runs a recorder and swallows its failure.
 *
 * An achievement is never worth a failed save, so every recorder goes through
 * this.
 */
async function safely(label: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error: unknown) {
    console.warn(`[achievements] ${label} failed:`, error);
  }
}

/**
 * A person created a trip: the form, the wizard, a template or the assistant.
 *
 * Not the sample trip, not a joined trip, not an imported one: none of those
 * call this.
 *
 * @param at - When, for `night_owl` (03:00 to 03:59, local time).
 */
export function recordTripCreated(at: Date = new Date()): Promise<void> {
  return safely('recordTripCreated', async () => {
    await incrementCounter('tripsCreated');
    if (at.getHours() === 3) {
      await unlockAchievement('night_owl');
    }
  });
}

/** A person added a guest to a trip. */
export function recordGuestAdded(): Promise<void> {
  return safely('recordGuestAdded', () => unlockAchievement('first_guest'));
}

/** A person asked the assistant a question. */
export function recordQuestionAsked(): Promise<void> {
  return safely('recordQuestionAsked', () => unlockAchievement('first_question'));
}

/** A person switched the app's language from the settings. */
export function recordLanguageChanged(): Promise<void> {
  return safely('recordLanguageChanged', () => unlockAchievement('polyglot'));
}

/** Another account joined a trip this person organises. */
export function recordTripShared(): Promise<void> {
  return safely('recordTripShared', () => unlockAchievement('trip_shared'));
}

/**
 * A person tapped the pet.
 *
 * @param at - When, for `midnight_pet` (the minute from 00:00 to 00:01, local time).
 */
export function recordPetTap(at: Date = new Date()): Promise<void> {
  return safely('recordPetTap', async () => {
    await incrementCounter('petTaps');
    if (at.getHours() === 0 && at.getMinutes() === 0) {
      await unlockAchievement('midnight_pet');
    }
  });
}

/**
 * The app opened.
 *
 * @param at - When, for `leap_day` (29 February, local time).
 */
export function recordAppOpened(at: Date = new Date()): Promise<void> {
  return safely('recordAppOpened', async () => {
    if (at.getMonth() === 1 && at.getDate() === 29) {
      await unlockAchievement('leap_day');
    }
  });
}

/**
 * An activity's participants changed.
 *
 * @param participantCount - How many guests now take part.
 */
export function recordActivityParticipants(participantCount: number): Promise<void> {
  return safely('recordActivityParticipants', async () => {
    if (participantCount >= GROUP_ACTIVITY_SIZE) {
      await unlockAchievement('group_activity');
    }
  });
}

/**
 * A guest got a room: unlocks `full_room` when the room is full on any night.
 *
 * People, not rows: a couple counts two (`getPersonHeadcount`).
 *
 * @param tripId - The trip.
 * @param roomId - The room the guest went to.
 */
export function recordRoomAssigned(tripId: TripId, roomId: RoomId): Promise<void> {
  return safely('recordRoomAssigned', async () => {
    const room = await db.rooms.get(roomId);
    if (!room || room.tripId !== tripId || !(room.capacity > 0)) {
      return;
    }
    const [assignments, persons] = await Promise.all([
      db.roomAssignments.where('[tripId+roomId]').equals([tripId, roomId]).toArray(),
      db.persons.where('tripId').equals(tripId).toArray(),
    ]);
    const nights = buildNightlyOccupancyByRoom(
      assignments,
      createHeadcountResolver(persons),
    ).get(roomId);
    for (const people of nights?.values() ?? []) {
      if (people >= room.capacity) {
        await unlockAchievement('full_room');
        return;
      }
    }
  });
}

/**
 * Counts the trips a person made on this device before achievements existed.
 *
 * Only a trip with no server id is certainly theirs: a joined trip always has
 * one. The sample trip and viewer trips are left out. Signed in, the account
 * sync raises the counter again to the trips the account owns.
 */
export function backfillTripsFromDevice(): Promise<void> {
  return safely('backfillTripsFromDevice', async () => {
    const [trips, settings] = await Promise.all([
      db.trips.toArray(),
      db.settings.get('settings'),
    ]);
    const own = trips.filter(
      (trip) =>
        trip.id !== settings?.sampleTripId &&
        trip.remoteTripId === undefined &&
        trip.viewerToken === undefined,
    ).length;
    await raiseCounter('tripsCreated', own);
  });
}

/**
 * Unlocks one achievement.
 *
 * @param key - The key.
 * @returns Whether this call unlocked it.
 */
export async function unlockAchievement(key: AchievementKey): Promise<boolean> {
  return (await unlockAchievements([key])).length > 0;
}

/**
 * Every achievement held on this device, by key.
 *
 * @returns Known keys only, with their unlock date.
 */
export async function listUnlockedAchievements(): Promise<Map<AchievementKey, number>> {
  const rows = await db.achievements.toArray();
  return new Map(
    rows.flatMap((row) => (isAchievementKey(row.key) ? [[row.key, row.unlockedAt]] : [])),
  );
}
