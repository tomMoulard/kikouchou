/**
 * @fileoverview The write paths that unlock achievements, through the real
 * repositories: if one of them stops calling its recorder, this fails.
 *
 * The recorders are not awaited by the write paths, so each test waits for
 * the row rather than reading it straight away.
 *
 * @module lib/achievements/__tests__/wiring.test
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createTripWithDetails } from '@/features/trips/lib/create-trip-with-details';
import { db } from '@/lib/db/database';
import {
  createActivity,
  setActivityParticipation,
  updateActivityWithOwnershipCheck,
} from '@/lib/db/repositories/activity-repository';
import { createAssignment } from '@/lib/db/repositories/assignment-repository';
import { createExpense } from '@/lib/db/repositories/expense-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import {
  createRide,
  setTransportRide,
  updateRideWithOwnershipCheck,
} from '@/lib/db/repositories/ride-repository';
import { createRoom } from '@/lib/db/repositories/room-repository';
import {
  createSharedTransports,
  createTransport,
} from '@/lib/db/repositories/transport-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { setChangeAuthor } from '@/lib/notifications/guest-change';
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

async function waitForCounter(
  counter: Parameters<typeof readCounter>[0],
  value: number,
): Promise<void> {
  await waitFor(async () => {
    expect(await readCounter(counter)).toBe(value);
  });
}

function journey(personId: PersonId) {
  return {
    personId,
    type: 'arrival' as const,
    datetime: localInstant('2026-07-02', '09:30'),
    location: 'Gare de Lyon',
    needsPickup: true,
  };
}

describe('achievement wiring', () => {
  const authored: TripId[] = [];

  afterEach(() => {
    for (const tripId of authored.splice(0)) {
      setChangeAuthor(tripId, null);
    }
  });

  function actAs(tripId: TripId, personId: PersonId): void {
    authored.push(tripId);
    setChangeAuthor(tripId, personId);
  }

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

  it('counts the guest nights of a new booking', async () => {
    const tripId = (await createTrip({ name: 'T' })).id;
    const roomId = (await createRoom(tripId, { name: 'Attic', capacity: 4 })).id;
    const [personId] = await guests(tripId, 1);

    await createAssignment(tripId, {
      roomId,
      personId: personId as PersonId,
      startDate: isoDate('2026-07-01'),
      endDate: isoDate('2026-07-04'),
    });

    await waitForCounter('roomNights', 3);
  });

  it('counts an activity the device joins, from each of the three write paths', async () => {
    const tripId = (await createTrip({ name: 'T' })).id;
    const [me, other] = (await guests(tripId, 2)) as [PersonId, PersonId];
    actAs(tripId, me);

    await createActivity(tripId, activity([me]));
    await waitForCounter('activitiesJoined', 1);

    const second = await createActivity(tripId, activity([other]));
    await waitForDb();
    await updateActivityWithOwnershipCheck(second.id, tripId, { participantIds: [other, me] });
    await waitForCounter('activitiesJoined', 2);

    const third = await createActivity(tripId, activity([other]));
    await setActivityParticipation(third.id, tripId, me, true);
    await waitForCounter('activitiesJoined', 3);
  });

  it('counts every journey row, a shared train once per guest', async () => {
    const tripId = (await createTrip({ name: 'T' })).id;
    const [a, b, c] = (await guests(tripId, 3)) as [PersonId, PersonId, PersonId];

    await createTransport(tripId, journey(a));
    await waitForCounter('journeysAdded', 1);

    await createSharedTransports(
      tripId,
      {
        type: 'arrival',
        datetime: localInstant('2026-07-02', '10:30'),
        location: 'Gare de Lyon',
        needsPickup: false,
      },
      [b, c],
    );
    await waitForCounter('journeysAdded', 3);
  });

  it('counts the passengers of a ride the device drives', async () => {
    const tripId = (await createTrip({ name: 'T' })).id;
    const [me, alice, bob] = (await guests(tripId, 3)) as [PersonId, PersonId, PersonId];
    actAs(tripId, me);
    const ride = await createRide(tripId, {
      direction: 'pickup',
      meetDatetime: localInstant('2026-07-02', '09:00'),
      location: 'Gare de Lyon',
    });
    const aliceLeg = await createTransport(tripId, journey(alice));
    const bobLeg = await createTransport(tripId, journey(bob));

    // Nobody drives yet: Alice gets in, nothing is counted.
    await setTransportRide(aliceLeg.id, tripId, ride.id);
    await waitForDb();
    expect(await readCounter('passengersDriven')).toBe(0);

    // The device volunteers: Alice counts. Then Bob gets in.
    await updateRideWithOwnershipCheck(ride.id, tripId, { driverId: me });
    await waitForCounter('passengersDriven', 1);
    await setTransportRide(bobLeg.id, tripId, ride.id);
    await waitForCounter('passengersDriven', 2);
  });

  it('counts a money line', async () => {
    const tripId = (await createTrip({ name: 'T' })).id;
    const [payer] = (await guests(tripId, 1)) as [PersonId];

    await createExpense(tripId, {
      kind: 'expense',
      category: 'groceries',
      title: 'Shopping',
      date: isoDate('2026-07-02'),
      amount: 40,
      payerId: payer,
      splitMode: 'equal',
      splits: [{ personId: payer, value: 1 }],
    });

    await waitForUnlock('money_1');
  });
});
