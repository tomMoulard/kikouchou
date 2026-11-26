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
  listStayNights,
} from '@/features/rooms/utils/capacity-utils';
import { db } from '@/lib/db/database';
import { changeAuthor } from '@/lib/notifications/guest-change';
import { captureEvent } from '@/lib/posthog';
import {
  getPersonHeadcount,
  type ActivityId,
  type PersonId,
  type RideId,
  type RoomAssignment,
  type RoomId,
  type TripId,
} from '@/types';

import {
  ACHIEVEMENT_FAMILIES,
  ACHIEVEMENT_KEYS,
  GROUP_ACTIVITY_SIZE,
  isAchievementKey,
  keysEarnedByCounter,
  placeOfAchievement,
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
    const place = placeOfAchievement(key);
    captureEvent('achievement_unlocked', {
      key,
      family: place.type === 'stage' ? place.family.id : null,
      stage: place.type === 'stage' ? place.index + 1 : null,
      hidden: place.type === 'special' && place.special.kind === 'hidden',
    });
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
    const fresh = ACHIEVEMENT_KEYS.filter(
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

/** The `achievementCounters` row that remembers the last day the app opened. */
const LAST_OPENED_DAY = 'lastOpenedDay';

/**
 * Counts things once each: a thing marked before adds nothing.
 *
 * @param counter - Which counter.
 * @param marks - One id per thing, unique within the counter.
 * @param weigh - How much each new thing adds, 1 by default.
 * @returns How much the counter moved.
 */
async function countOnce(
  counter: AchievementCounter,
  marks: readonly string[],
  weigh: (mark: string) => number = () => 1,
): Promise<number> {
  const keys = marks.map((mark) => `${counter}:${mark}`);
  const added = await db.transaction('rw', db.achievementMarks, async () => {
    const seen = await db.achievementMarks.bulkGet(keys);
    const fresh = marks.filter((_, index) => seen[index] === undefined);
    await db.achievementMarks.bulkAdd(fresh.map((mark) => ({ key: `${counter}:${mark}` })));
    return fresh;
  });
  const by = added.reduce((sum, mark) => sum + weigh(mark), 0);
  if (by > 0) {
    await incrementCounter(counter, by);
  }
  return by;
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
  return safely('recordGuestAdded', () => incrementCounter('guestsAdded'));
}

/** A person asked the assistant a question. A view shortcut is not one. */
export function recordQuestionAsked(): Promise<void> {
  return safely('recordQuestionAsked', () => incrementCounter('questionsAsked'));
}

/**
 * A person added journeys: one row per guest, so a train for three is three.
 *
 * @param count - How many rows the save created.
 */
export function recordJourneysAdded(count = 1): Promise<void> {
  return safely('recordJourneysAdded', async () => {
    if (count > 0) {
      await incrementCounter('journeysAdded', count);
    }
  });
}

/** A person recorded a money line: an expense, an income or a transfer. */
export function recordMoneyLine(): Promise<void> {
  return safely('recordMoneyLine', () => incrementCounter('moneyLines'));
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
    // Loyalty counts days, not opens: the local calendar day, once.
    const day = at.getFullYear() * 10_000 + (at.getMonth() + 1) * 100 + at.getDate();
    const isNewDay = await db.transaction('rw', db.achievementCounters, async () => {
      const last = (await db.achievementCounters.get(LAST_OPENED_DAY))?.value;
      if (last === day) {
        return false;
      }
      await db.achievementCounters.put({ key: LAST_OPENED_DAY, value: day });
      return true;
    });
    if (isNewDay) {
      await incrementCounter('daysOpened');
    }
  });
}

/**
 * An activity's participants changed.
 *
 * Unlocks `group_activity` at three guests, and counts the activity once for
 * the activities family when this device's own guest is in it. The device's
 * guest is the one the open trip's layout knows (`changeAuthor`): unknown,
 * nothing is counted.
 *
 * @param tripId - The trip.
 * @param activityId - The activity.
 * @param participantIds - Who takes part now.
 */
export function recordActivityParticipants(
  tripId: TripId,
  activityId: ActivityId,
  participantIds: readonly PersonId[],
): Promise<void> {
  return safely('recordActivityParticipants', async () => {
    if (participantIds.length >= GROUP_ACTIVITY_SIZE) {
      await unlockAchievement('group_activity');
    }
    const me = changeAuthor(tripId);
    if (me !== undefined && participantIds.includes(me)) {
      await countOnce('activitiesJoined', [`${tripId}/${activityId}`]);
    }
  });
}

/**
 * A ride gained a driver or passengers: counts the passengers this device's
 * own guest drives, each once per ride.
 *
 * People, not rows: a couple riding along counts two. The driver riding in
 * their own car is not a passenger.
 *
 * @param tripId - The trip.
 * @param rideId - The ride.
 */
export function recordRidePassengers(tripId: TripId, rideId: RideId): Promise<void> {
  return safely('recordRidePassengers', async () => {
    const me = changeAuthor(tripId);
    if (me === undefined) {
      return;
    }
    const ride = await db.rides.get(rideId);
    if (!ride || ride.tripId !== tripId || ride.driverId !== me) {
      return;
    }
    const legs = await db.transports.where('rideId').equals(rideId).toArray();
    const passengerIds = [
      ...new Set(
        legs
          .filter((leg) => leg.tripId === tripId && leg.personId !== me)
          .map((leg) => leg.personId),
      ),
    ];
    if (passengerIds.length === 0) {
      return;
    }
    const persons = await db.persons.bulkGet(passengerIds);
    const headcounts = new Map(
      persons.flatMap((person) =>
        person && person.tripId === tripId ? [[person.id, getPersonHeadcount(person)]] : [],
      ),
    );
    await countOnce(
      'passengersDriven',
      passengerIds.map((id) => `${tripId}/${rideId}/${id}`),
      (mark) => headcounts.get(mark.slice(mark.lastIndexOf('/') + 1) as PersonId) ?? 1,
    );
  });
}

/**
 * A guest got a room: counts the guest nights for the rooms family, and
 * unlocks `full_room` when the room is full on any night.
 *
 * People, not rows: a couple counts two (`getPersonHeadcount`), so a couple
 * for three nights is six guest nights.
 *
 * @param tripId - The trip.
 * @param roomId - The room the guest went to.
 * @param assignment - The booking, for the nights it covers.
 */
export function recordRoomAssigned(
  tripId: TripId,
  roomId: RoomId,
  assignment?: Pick<RoomAssignment, 'personId' | 'startDate' | 'endDate'>,
): Promise<void> {
  return safely('recordRoomAssigned', async () => {
    if (assignment) {
      const person = await db.persons.get(assignment.personId),
        nights = listStayNights(assignment.startDate, assignment.endDate).length,
        people = person ? getPersonHeadcount(person) : 1;
      if (nights > 0) {
        await incrementCounter('roomNights', nights * people);
      }
    }
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
 * Counts what a person made on this device before achievements existed.
 *
 * Only a trip with no server id is certainly theirs: a joined trip always has
 * one. The sample trip and viewer trips are left out. From those trips: the
 * trips, the guests, the journeys, the guest nights given a bed and the money
 * lines. A floor, never a step: it runs on every start and adds nothing the
 * second time. Activities joined and passengers driven need to know which
 * guest the person is, so they start from zero. Signed in, the account sync
 * raises the trip counter again to the trips the account owns.
 */
export function backfillFromDevice(): Promise<void> {
  return safely('backfillFromDevice', async () => {
    const [trips, settings] = await Promise.all([
      db.trips.toArray(),
      db.settings.get('settings'),
    ]);
    const own = trips
      .filter(
        (trip) =>
          trip.id !== settings?.sampleTripId &&
          trip.remoteTripId === undefined &&
          trip.viewerToken === undefined,
      )
      .map((trip) => trip.id);
    await raiseCounter('tripsCreated', own.length);
    if (own.length === 0) {
      return;
    }

    const [persons, transports, assignments, expenses] = await Promise.all([
      db.persons.where('tripId').anyOf(own).toArray(),
      db.transports.where('tripId').anyOf(own).toArray(),
      db.roomAssignments.where('tripId').anyOf(own).toArray(),
      db.expenses.where('tripId').anyOf(own).toArray(),
    ]);
    const headcount = createHeadcountResolver(persons);
    const nights = assignments.reduce(
      (sum, a) => sum + listStayNights(a.startDate, a.endDate).length * headcount(a.personId),
      0,
    );
    await raiseCounter('guestsAdded', persons.length);
    await raiseCounter('journeysAdded', transports.length);
    await raiseCounter('roomNights', nights);
    await raiseCounter('moneyLines', expenses.length);
  });
}

/**
 * Raises each family's counter to the highest stage held.
 *
 * A stage pulled from the account's other devices says the counter reached
 * its target there, so the next stage counts on from it here.
 */
export async function raiseCountersToHeldStages(): Promise<void> {
  const held = new Set((await db.achievements.toArray()).map((row) => row.key));
  for (const family of ACHIEVEMENT_FAMILIES) {
    const floor = family.stages.reduce(
      (max, stage) => (held.has(stage.key) ? Math.max(max, stage.target) : max),
      0,
    );
    if (floor > 0) {
      await raiseCounter(family.counter, floor);
    }
  }
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
