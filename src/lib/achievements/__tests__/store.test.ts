/**
 * @fileoverview Tests for unlocking achievements and the events that do it.
 *
 * @module lib/achievements/__tests__/store.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import { createAssignment } from '@/lib/db/repositories/assignment-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createRoom } from '@/lib/db/repositories/room-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { hexColor, isoDate, waitForDb } from '@/test/utils';
import { DEFAULT_SETTINGS, type RoomId, type TripId } from '@/types';

import {
  backfillTripsFromDevice,
  incrementCounter,
  listUnlockedAchievements,
  onAchievementsUnlocked,
  raiseCounter,
  readCounter,
  recordActivityParticipants,
  recordAppOpened,
  recordGuestAdded,
  recordLanguageChanged,
  recordPetTap,
  recordQuestionAsked,
  recordRoomAssigned,
  recordTripCreated,
  recordTripShared,
  unlockAchievement,
  unlockAchievements,
} from '../store';

// ============================================================================
// Mocks
// ============================================================================

const captureEvent = vi.fn();
vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  captureEvent: (...args: unknown[]) => captureEvent(...args),
}));

// ============================================================================
// Helpers
// ============================================================================

async function held(): Promise<string[]> {
  return [...(await listUnlockedAchievements()).keys()].sort();
}

/** A local Date, so the hour tests read the same in every timezone. */
function at(hours: number, minutes: number, month = 5, day = 10): Date {
  return new Date(2026, month, day, hours, minutes);
}

// ============================================================================
// Tests
// ============================================================================

describe('achievements store', () => {
  beforeEach(() => {
    captureEvent.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('unlockAchievements', () => {
    it('unlocks each key once, reports it, and tells the listeners', async () => {
      const listener = vi.fn();
      const unsubscribe = onAchievementsUnlocked(listener);

      expect(await unlockAchievements(['polyglot', 'trips_1'])).toEqual(['trips_1', 'polyglot']);
      expect(await unlockAchievements(['polyglot'])).toEqual([]);
      unsubscribe();

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(['trips_1', 'polyglot']);
      const reported = captureEvent.mock.calls.filter(([name]) => name === 'achievement_unlocked');
      expect(reported).toEqual([
        ['achievement_unlocked', { key: 'trips_1', hidden: false }],
        ['achievement_unlocked', { key: 'polyglot', hidden: true }],
      ]);
    });

    it('writes a silent unlock without telling anyone, at the date given', async () => {
      const listener = vi.fn();
      const unsubscribe = onAchievementsUnlocked(listener);

      await unlockAchievements(['leap_day'], { silent: true, unlockedAt: 1234 });
      unsubscribe();

      expect(listener).not.toHaveBeenCalled();
      expect(captureEvent).not.toHaveBeenCalledWith('achievement_unlocked', expect.anything());
      expect((await listUnlockedAchievements()).get('leap_day')).toBe(1234);
    });

    it('does nothing for an empty list', async () => {
      expect(await unlockAchievements([])).toEqual([]);
    });

    it('keeps going when a listener throws', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const after = vi.fn();
      const off1 = onAchievementsUnlocked(() => {
        throw new Error('boom');
      });
      const off2 = onAchievementsUnlocked(after);

      await unlockAchievement('polyglot');
      off1();
      off2();

      expect(after).toHaveBeenCalledWith(['polyglot']);
    });

    it('ignores a stored key this build does not know', async () => {
      await db.achievements.add({ key: 'from_the_future', unlockedAt: 1 });
      expect(await held()).toEqual([]);
    });
  });

  describe('counters', () => {
    it('counts up and unlocks every tier the value reaches', async () => {
      expect(await readCounter('tripsCreated')).toBe(0);
      await incrementCounter('tripsCreated', 2);
      expect(await held()).toEqual(['trips_1']);
      await incrementCounter('tripsCreated');
      expect(await held()).toEqual(['trips_1', 'trips_3']);
      expect(await readCounter('tripsCreated')).toBe(3);
    });

    it('raises a counter but never lowers it', async () => {
      await raiseCounter('tripsCreated', 10);
      await raiseCounter('tripsCreated', 4);
      expect(await readCounter('tripsCreated')).toBe(10);
      expect(await held()).toEqual(['trips_1', 'trips_10', 'trips_3']);
    });
  });

  describe('events', () => {
    it('counts a created trip, and a trip created at 3 in the morning is a night owl', async () => {
      await recordTripCreated(at(14, 0));
      expect(await held()).toEqual(['trips_1']);

      await recordTripCreated(at(3, 59));
      expect(await held()).toEqual(['night_owl', 'trips_1']);
      expect(await readCounter('tripsCreated')).toBe(2);
    });

    it('does not count 4 in the morning as a night owl', async () => {
      await recordTripCreated(at(4, 0));
      expect(await held()).toEqual(['trips_1']);
    });

    it('unlocks the midnight pet in the first minute after midnight only', async () => {
      await recordPetTap(at(23, 59));
      await recordPetTap(at(0, 1));
      expect(await held()).toEqual([]);

      await recordPetTap(at(0, 0));
      expect(await held()).toEqual(['midnight_pet']);
      expect(await readCounter('petTaps')).toBe(3);
    });

    it('opens the petting zoo at the hundredth tap', async () => {
      await raiseCounter('petTaps', 98);
      await recordPetTap(at(12, 0));
      expect(await held()).toEqual([]);
      await recordPetTap(at(12, 0));
      expect(await held()).toEqual(['petting_zoo']);
    });

    it('unlocks leap day on 29 February and on no other day', async () => {
      await recordAppOpened(new Date(2028, 2, 1));
      await recordAppOpened(new Date(2027, 1, 28));
      expect(await held()).toEqual([]);

      await recordAppOpened(new Date(2028, 1, 29));
      expect(await held()).toEqual(['leap_day']);
    });

    it('unlocks the one-shot milestones', async () => {
      await recordQuestionAsked();
      await recordLanguageChanged();
      await recordTripShared();
      await recordGuestAdded();
      expect(await held()).toEqual(['first_guest', 'first_question', 'polyglot', 'trip_shared']);
    });

    it('needs three participants for a group activity', async () => {
      await recordActivityParticipants(2);
      expect(await held()).toEqual([]);
      await recordActivityParticipants(3);
      expect(await held()).toEqual(['group_activity']);
    });

    it('swallows a failure rather than failing the save that called it', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(db.achievements, 'bulkGet').mockRejectedValueOnce(new Error('disk full'));

      await expect(recordQuestionAsked()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    });
  });

  describe('recordRoomAssigned', () => {
    let tripId: TripId;
    let roomId: RoomId;

    beforeEach(async () => {
      tripId = (await createTrip({ name: 'Trip' })).id;
      roomId = (await createRoom(tripId, { name: 'Attic', capacity: 3 })).id;
    });

    async function guest(name: string, headcount?: number) {
      return createPerson(tripId, {
        name,
        color: hexColor('#3b82f6'),
        ...(headcount !== undefined && { headcount }),
      });
    }

    it('unlocks a full room when the people on one night reach its capacity', async () => {
      const couple = await guest('Couple', 2);
      const solo = await guest('Solo');
      // `createPerson` unlocks `first_guest` without being awaited.
      await waitForDb();
      await db.achievements.clear();

      await createAssignment(tripId, {
        roomId,
        personId: couple.id,
        startDate: isoDate('2026-07-01'),
        endDate: isoDate('2026-07-03'),
      });
      await recordRoomAssigned(tripId, roomId);
      expect(await held()).toEqual([]);

      // The couple counts two: with one more guest, the room sleeps three.
      await createAssignment(tripId, {
        roomId,
        personId: solo.id,
        startDate: isoDate('2026-07-02'),
        endDate: isoDate('2026-07-04'),
      });
      await recordRoomAssigned(tripId, roomId);
      expect(await held()).toEqual(['full_room']);
    });

    it('does not count guests who never share a night', async () => {
      const a = await guest('A', 2);
      const b = await guest('B');
      // `createPerson` unlocks `first_guest` without being awaited.
      await waitForDb();
      await db.achievements.clear();

      await createAssignment(tripId, {
        roomId,
        personId: a.id,
        startDate: isoDate('2026-07-01'),
        endDate: isoDate('2026-07-03'),
      });
      // Checks in on the day A checks out: one night each, never three people.
      await createAssignment(tripId, {
        roomId,
        personId: b.id,
        startDate: isoDate('2026-07-03'),
        endDate: isoDate('2026-07-05'),
      });
      await recordRoomAssigned(tripId, roomId);
      expect(await held()).toEqual([]);
    });

    it('ignores a room of another trip', async () => {
      const other = (await createTrip({ name: 'Other' })).id;
      await recordRoomAssigned(other, roomId);
      expect(await held()).toEqual([]);
    });
  });

  describe('backfillTripsFromDevice', () => {
    it('counts the trips made here, and not the sample, joined or viewer trips', async () => {
      const own1 = await createTrip({ name: 'Mine 1' });
      await createTrip({ name: 'Mine 2' });
      const sample = await createTrip({ name: 'Sample' });
      const joined = await createTrip({ name: 'Joined' });
      const viewed = await createTrip({ name: 'Viewed' });
      await db.trips.update(joined.id, { remoteTripId: 'remote-1' });
      await db.trips.update(viewed.id, { remoteTripId: 'remote-2', viewerToken: 'token' });
      await db.settings.put({ ...DEFAULT_SETTINGS, sampleTripId: sample.id });

      await backfillTripsFromDevice();

      expect(own1.id).toBeDefined();
      expect(await readCounter('tripsCreated')).toBe(2);
      expect(await held()).toEqual(['trips_1']);
    });
  });
});
