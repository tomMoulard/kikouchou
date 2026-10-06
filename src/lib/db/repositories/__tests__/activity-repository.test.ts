/**
 * Integration tests for Activity Repository
 *
 * Covers CRUD, ownership validation, participation (join/leave with seat cap)
 * and the date/participant lookups used by the agenda views.
 *
 * @module lib/db/repositories/__tests__/activity-repository.test
 */
import { describe, it, expect } from 'vitest';

import { db } from '@/lib/db/database';
import {
  createActivity,
  deleteActivityWithOwnershipCheck,
  getActivitiesByOrganizerId,
  getActivitiesByParticipantId,
  getActivitiesByTripId,
  getActivitiesForDate,
  getActivityById,
  getActivityCount,
  isActivityFull,
  setActivityParticipation,
  updateActivityWithOwnershipCheck,
} from '@/lib/db/repositories/activity-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import {
  createPerson,
  deletePersonWithOwnershipCheck,
} from '@/lib/db/repositories/person-repository';
import { isoDate, hexColor, localInstant } from '@/test/utils';
import type { ActivityFormData, ActivityId, PersonId, TripId } from '@/types';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates valid activity form data with optional overrides.
 */
function createTestActivityData(
  overrides?: Partial<ActivityFormData>,
): ActivityFormData {
  return {
    title: 'Fête des plantes',
    category: 'horticulture',
    startDatetime: '2024-07-16T09:00:00.000Z',
    endDatetime: '2024-07-16T12:00:00.000Z',
    allDay: false,
    location: 'Château de Saint-Jean',
    participantIds: [],
    ...overrides,
  };
}

/**
 * Creates a test trip and returns its ID.
 */
async function createTestTrip(name = 'Test Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-22'),
  });
  return trip.id;
}

/**
 * Creates a test person in a trip and returns their ID.
 */
async function createTestPerson(tripId: TripId, name = 'Marie'): Promise<PersonId> {
  const person = await createPerson(tripId, {
    name,
    color: hexColor('#ef4444'),
  });
  return person.id;
}

// ============================================================================
// Tests
// ============================================================================

describe('activity-repository', () => {
  describe('createActivity', () => {
    it('creates an activity scoped to the trip', async () => {
      const tripId = await createTestTrip();

      const activity = await createActivity(tripId, createTestActivityData());

      expect(activity.id).toBeTruthy();
      expect(activity.tripId).toBe(tripId);
      expect(activity.title).toBe('Fête des plantes');
      expect(activity.category).toBe('horticulture');
      expect(await db.activities.get(activity.id)).toBeDefined();
    });

    it('trims text fields and de-duplicates participants', async () => {
      const tripId = await createTestTrip();
      const personId = await createTestPerson(tripId);

      const activity = await createActivity(
        tripId,
        createTestActivityData({
          title: '   Balade en forêt   ',
          location: '   Forêt de Brocéliande   ',
          notes: '   ',
          participantIds: [personId, personId],
        }),
      );

      expect(activity.title).toBe('Balade en forêt');
      expect(activity.location).toBe('Forêt de Brocéliande');
      expect(activity.notes).toBeUndefined();
      expect(activity.participantIds).toEqual([personId]);
    });

    it('drops a participant cap below 1 as "unlimited"', async () => {
      const tripId = await createTestTrip();

      const activity = await createActivity(
        tripId,
        createTestActivityData({ maxParticipants: 0 }),
      );

      expect(activity.maxParticipants).toBeUndefined();
    });
  });

  describe('getActivitiesByTripId', () => {
    it('returns activities sorted by start datetime', async () => {
      const tripId = await createTestTrip();

      await createActivity(
        tripId,
        createTestActivityData({
          title: 'Later',
          startDatetime: '2024-07-18T10:00:00.000Z',
          endDatetime: undefined,
        }),
      );
      await createActivity(
        tripId,
        createTestActivityData({
          title: 'Earlier',
          startDatetime: '2024-07-16T10:00:00.000Z',
          endDatetime: undefined,
        }),
      );

      const activities = await getActivitiesByTripId(tripId);

      expect(activities.map((activity) => activity.title)).toEqual([
        'Earlier',
        'Later',
      ]);
    });

    it('does not leak activities from another trip', async () => {
      const tripId = await createTestTrip('Trip A');
      const otherTripId = await createTestTrip('Trip B');

      await createActivity(tripId, createTestActivityData({ title: 'Mine' }));
      await createActivity(otherTripId, createTestActivityData({ title: 'Theirs' }));

      const activities = await getActivitiesByTripId(tripId);

      expect(activities).toHaveLength(1);
      expect(activities[0]?.title).toBe('Mine');
    });
  });

  describe('getActivitiesForDate', () => {
    it('includes a multi-day activity on every day it covers', async () => {
      const tripId = await createTestTrip();

      await createActivity(
        tripId,
        createTestActivityData({
          title: 'Festival',
          startDatetime: localInstant('2024-07-16', '10:00'),
          endDatetime: localInstant('2024-07-18', '18:00'),
        }),
      );

      expect(await getActivitiesForDate(tripId, '2024-07-15')).toHaveLength(0);
      expect(await getActivitiesForDate(tripId, '2024-07-16')).toHaveLength(1);
      expect(await getActivitiesForDate(tripId, '2024-07-17')).toHaveLength(1);
      expect(await getActivitiesForDate(tripId, '2024-07-18')).toHaveLength(1);
      expect(await getActivitiesForDate(tripId, '2024-07-19')).toHaveLength(0);
    });

    // Regression: activities are stored as UTC instants, so slicing the first
    // ten characters off `startDatetime` answered with the UTC day. A midnight
    // apéro on the 16th is stored at 22:30Z on the 15th in Paris and was only
    // ever returned for the 15th; the mirror image west of Greenwich hid a
    // late-evening activity behind the following day.
    it('matches the local calendar day of a late-night activity, not the UTC day', async () => {
      const tripId = await createTestTrip();

      await createActivity(
        tripId,
        createTestActivityData({
          title: 'Apéro de minuit',
          startDatetime: localInstant('2024-07-16', '00:30'),
          endDatetime: localInstant('2024-07-16', '23:30'),
        }),
      );

      expect(await getActivitiesForDate(tripId, '2024-07-15')).toHaveLength(0);
      expect(await getActivitiesForDate(tripId, '2024-07-16')).toHaveLength(1);
      expect(await getActivitiesForDate(tripId, '2024-07-17')).toHaveLength(0);
    });
  });

  describe('participant lookups', () => {
    it('finds activities a person joined and organizes', async () => {
      const tripId = await createTestTrip();
      const personId = await createTestPerson(tripId);
      const otherId = await createTestPerson(tripId, 'Paul');

      await createActivity(
        tripId,
        createTestActivityData({
          title: 'Joined',
          participantIds: [personId],
          organizerId: personId,
        }),
      );
      await createActivity(
        tripId,
        createTestActivityData({ title: 'Not joined', participantIds: [otherId] }),
      );

      const joined = await getActivitiesByParticipantId(personId);
      const organized = await getActivitiesByOrganizerId(personId);

      expect(joined.map((activity) => activity.title)).toEqual(['Joined']);
      expect(organized.map((activity) => activity.title)).toEqual(['Joined']);
    });
  });

  describe('updateActivityWithOwnershipCheck', () => {
    it('updates an activity that belongs to the trip', async () => {
      const tripId = await createTestTrip();
      const activity = await createActivity(tripId, createTestActivityData());

      await updateActivityWithOwnershipCheck(activity.id, tripId, {
        title: '  Marché aux fleurs  ',
      });

      const updated = await getActivityById(activity.id);
      expect(updated?.title).toBe('Marché aux fleurs');
      // Untouched fields survive a partial update
      expect(updated?.location).toBe('Château de Saint-Jean');
    });

    it('rejects an update from a different trip', async () => {
      const tripId = await createTestTrip('Trip A');
      const otherTripId = await createTestTrip('Trip B');
      const activity = await createActivity(tripId, createTestActivityData());

      await expect(
        updateActivityWithOwnershipCheck(activity.id, otherTripId, { title: 'Hack' }),
      ).rejects.toThrow(/does not belong to current trip/);

      expect((await getActivityById(activity.id))?.title).toBe('Fête des plantes');
    });

    it('throws when the activity does not exist', async () => {
      const tripId = await createTestTrip();

      await expect(
        updateActivityWithOwnershipCheck('missing' as ActivityId, tripId, {
          title: 'Nope',
        }),
      ).rejects.toThrow(/not found/);
    });
  });

  describe('deleteActivityWithOwnershipCheck', () => {
    it('deletes an activity that belongs to the trip', async () => {
      const tripId = await createTestTrip();
      const activity = await createActivity(tripId, createTestActivityData());

      await deleteActivityWithOwnershipCheck(activity.id, tripId);

      expect(await getActivityById(activity.id)).toBeUndefined();
      expect(await getActivityCount(tripId)).toBe(0);
    });

    it('rejects a delete from a different trip', async () => {
      const tripId = await createTestTrip('Trip A');
      const otherTripId = await createTestTrip('Trip B');
      const activity = await createActivity(tripId, createTestActivityData());

      await expect(
        deleteActivityWithOwnershipCheck(activity.id, otherTripId),
      ).rejects.toThrow(/does not belong to current trip/);

      expect(await getActivityById(activity.id)).toBeDefined();
    });
  });

  describe('setActivityParticipation', () => {
    it('adds and removes a guest', async () => {
      const tripId = await createTestTrip();
      const personId = await createTestPerson(tripId);
      const activity = await createActivity(tripId, createTestActivityData());

      await setActivityParticipation(activity.id, tripId, personId, true);
      expect((await getActivityById(activity.id))?.participantIds).toEqual([personId]);

      await setActivityParticipation(activity.id, tripId, personId, false);
      expect((await getActivityById(activity.id))?.participantIds).toEqual([]);
    });

    it('is a no-op when the guest is already in the requested state', async () => {
      const tripId = await createTestTrip();
      const personId = await createTestPerson(tripId);
      const activity = await createActivity(
        tripId,
        createTestActivityData({ participantIds: [personId] }),
      );

      const result = await setActivityParticipation(activity.id, tripId, personId, true);

      expect(result).toEqual([personId]);
    });

    it('refuses to join an activity that is already full', async () => {
      const tripId = await createTestTrip();
      const first = await createTestPerson(tripId, 'Marie');
      const second = await createTestPerson(tripId, 'Paul');
      const activity = await createActivity(
        tripId,
        createTestActivityData({ participantIds: [first], maxParticipants: 1 }),
      );

      await expect(
        setActivityParticipation(activity.id, tripId, second, true),
      ).rejects.toThrow(/no seat left/);

      expect((await getActivityById(activity.id))?.participantIds).toEqual([first]);
    });

    it('still lets a guest leave a full activity', async () => {
      const tripId = await createTestTrip();
      const personId = await createTestPerson(tripId);
      const activity = await createActivity(
        tripId,
        createTestActivityData({ participantIds: [personId], maxParticipants: 1 }),
      );

      await setActivityParticipation(activity.id, tripId, personId, false);

      expect((await getActivityById(activity.id))?.participantIds).toEqual([]);
    });
  });

  describe('isActivityFull', () => {
    it('treats an unset cap as unlimited', () => {
      expect(isActivityFull({ participantIds: ['a' as PersonId] })).toBe(false);
    });

    it('reports full once the cap is reached', () => {
      expect(
        isActivityFull({ participantIds: ['a' as PersonId], maxParticipants: 1 }),
      ).toBe(true);
    });
  });

  describe('person cascade delete', () => {
    it('drops the guest from activities but keeps the activity', async () => {
      const tripId = await createTestTrip();
      const personId = await createTestPerson(tripId);
      const otherId = await createTestPerson(tripId, 'Paul');
      const activity = await createActivity(
        tripId,
        createTestActivityData({
          participantIds: [personId, otherId],
          organizerId: personId,
        }),
      );

      await deletePersonWithOwnershipCheck(personId, tripId);

      const updated = await getActivityById(activity.id);
      expect(updated).toBeDefined();
      expect(updated?.participantIds).toEqual([otherId]);
      expect(updated?.organizerId).toBeUndefined();
    });
  });
});
