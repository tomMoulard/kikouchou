/**
 * @fileoverview The write paths that unlock achievements, through the real
 * repositories: if one of them stops calling its recorder, this fails.
 *
 * The recorders are not awaited by the write paths, so each test waits for
 * the row rather than reading it straight away.
 *
 * @module lib/achievements/__tests__/wiring.test
 */

import { describe, expect, it } from 'vitest';

import { createTripWithDetails } from '@/features/trips/lib/create-trip-with-details';
import { db } from '@/lib/db/database';
import {
  createActivity,
  setActivityParticipation,
  updateActivityWithOwnershipCheck,
} from '@/lib/db/repositories/activity-repository';
import { createAssignment } from '@/lib/db/repositories/assignment-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createRoom } from '@/lib/db/repositories/room-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { hexColor, isoDate, localInstant, waitFor, waitForDb } from '@/test/utils';
import type { PersonId, TripId } from '@/types';

import { readCounter } from '../store';

// ============================================================================
// Helpers
// ============================================================================

async function waitForUnlock(key: string): Promise<void> {
  await waitFor(async () => {
    expect(await db.achievements.get(key)).toBeDefined();
  });
}

async function guests(tripId: TripId, count: number): Promise<PersonId[]> {
  const ids: PersonId[] = [];
  for (let i = 0; i < count; i++) {
    ids.push((await createPerson(tripId, { name: `G${i}`, color: hexColor('#3b82f6') })).id);
  }
  return ids;
}

function activity(participantIds: PersonId[]) {
  return {
    title: 'Hike',
    category: 'hike' as const,
    startDatetime: localInstant('2026-07-02', '09:00'),
    allDay: false,
    participantIds,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('achievement wiring', () => {
  it('counts a trip created from the form or the wizard', async () => {
    await createTripWithDetails({
      form: { name: 'Chalet' },
      guests: [],
      rooms: [],
      selectAsCurrent: false,
    });

    await waitForUnlock('trips_1');
    expect(await readCounter('tripsCreated')).toBe(1);
  });

  it('does not count a trip written by the repository alone (import, seed)', async () => {
    await createTrip({ name: 'Imported' });
    await waitForDb();
    expect(await readCounter('tripsCreated')).toBe(0);
  });

  it('unlocks first_guest when a guest is created', async () => {
    const tripId = (await createTrip({ name: 'T' })).id;
    await guests(tripId, 1);
    await waitForUnlock('first_guest');
  });

  it('unlocks full_room when an assignment fills a room', async () => {
    const tripId = (await createTrip({ name: 'T' })).id;
    const roomId = (await createRoom(tripId, { name: 'Box room', capacity: 1 })).id;
    const [personId] = await guests(tripId, 1);

    await createAssignment(tripId, {
      roomId,
      personId: personId as PersonId,
      startDate: isoDate('2026-07-01'),
      endDate: isoDate('2026-07-02'),
    });

    await waitForUnlock('full_room');
  });

  it('unlocks group_activity from a new activity with three people', async () => {
    const tripId = (await createTrip({ name: 'T' })).id;
    await createActivity(tripId, activity(await guests(tripId, 3)));
    await waitForUnlock('group_activity');
  });

  it('unlocks group_activity when an edit brings the activity to three', async () => {
    const tripId = (await createTrip({ name: 'T' })).id;
    const ids = await guests(tripId, 3);
    const created = await createActivity(tripId, activity(ids.slice(0, 1)));
    await waitForDb();
    expect(await db.achievements.get('group_activity')).toBeUndefined();

    await updateActivityWithOwnershipCheck(created.id, tripId, { participantIds: ids });
    await waitForUnlock('group_activity');
  });

  it('unlocks group_activity when the third guest joins', async () => {
    const tripId = (await createTrip({ name: 'T' })).id;
    const ids = await guests(tripId, 3);
    const created = await createActivity(tripId, activity(ids.slice(0, 2)));

    await setActivityParticipation(created.id, tripId, ids[2] as PersonId, true);
    await waitForUnlock('group_activity');
  });
});
