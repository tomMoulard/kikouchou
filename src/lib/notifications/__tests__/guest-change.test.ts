/**
 * @fileoverview Every change naming a guest is stamped with its author and
 * announced to the push server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import {
  createActivity,
  createRide,
  createTrip,
  createVehicle,
  setActivityParticipation,
  updateRideWithOwnershipCheck,
} from '@/lib/db';
import type { ISODateString, PersonId, TripId } from '@/types';

import { announceGuestChange, authorPatch, changeAuthor, setChangeAuthor } from '../guest-change';
import { TRIP_NOTIFY_QUEUE_KEY } from '../trip-notify';

const ALICE = 'alice' as PersonId;
const BOB = 'bob' as PersonId;

function queued(): { kind: string; collection?: string; subjectId: string }[] {
  return JSON.parse(localStorage.getItem(TRIP_NOTIFY_QUEUE_KEY) ?? '[]');
}

async function waitForQueue(length: number): Promise<void> {
  await vi.waitFor(() => expect(queued()).toHaveLength(length));
}

let tripId: TripId;

beforeEach(async () => {
  localStorage.clear();
  const trip = await createTrip({ name: 'Noël', startDate: '2026-12-20' as ISODateString, endDate: '2026-12-27' as ISODateString });
  tripId = trip.id;
});

afterEach(() => {
  setChangeAuthor(tripId, null);
  vi.unstubAllEnvs();
});

describe('authorPatch', () => {
  it('stamps the known author, and clears an older one on a change by nobody known', () => {
    expect(authorPatch(tripId, 'create')).toEqual({});
    expect(authorPatch(tripId, 'update')).toEqual({ updatedBy: undefined });

    setChangeAuthor(tripId, ALICE);

    expect(changeAuthor(tripId)).toBe(ALICE);
    expect(authorPatch(tripId, 'create')).toEqual({ updatedBy: ALICE });
    expect(authorPatch(tripId, 'update')).toEqual({ updatedBy: ALICE });
  });
});

describe('repositories', () => {
  it('write who made the change on the row', async () => {
    setChangeAuthor(tripId, ALICE);
    const ride = await createRide(tripId, {
      direction: 'pickup',
      meetDatetime: '2026-12-20T10:00:00.000Z',
      location: 'Gare',
      driverId: BOB,
    });
    expect((await db.rides.get(ride.id))?.updatedBy).toBe(ALICE);

    setChangeAuthor(tripId, BOB);
    await updateRideWithOwnershipCheck(ride.id, tripId, { location: 'Aéroport' });
    expect((await db.rides.get(ride.id))?.updatedBy).toBe(BOB);

    setChangeAuthor(tripId, null);
    await updateRideWithOwnershipCheck(ride.id, tripId, { location: 'Port' });
    expect((await db.rides.get(ride.id))?.updatedBy).toBeUndefined();
  });

  it('ask the push server to tell the guests, for a shared trip only', async () => {
    vi.stubEnv('VITE_SHARE_ORIGIN', 'https://share.example.test');
    const car = await createVehicle(tripId, { name: 'Clio', ownerId: BOB });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queued()).toEqual([]);

    await db.trips.update(tripId, { remoteTripId: '0b9e8c1a-3f2d-4c5b-9a8e-7d6c5b4a3f2e' });
    const activity = await createActivity(tripId, {
      title: 'Ski',
      category: 'sport',
      startDatetime: '2026-12-21T09:00:00.000Z',
      allDay: false,
      participantIds: [ALICE],
    });
    await waitForQueue(1);
    await setActivityParticipation(activity.id, tripId, BOB, true);
    // Joining again changes nothing, and asks nothing.
    await setActivityParticipation(activity.id, tripId, BOB, true);
    announceGuestChange(tripId, 'vehicles', car.id);
    await waitForQueue(2);

    expect(queued()).toMatchObject([
      { kind: 'trip_change', collection: 'activities', subjectId: activity.id },
      { kind: 'trip_change', collection: 'vehicles', subjectId: car.id },
    ]);
  });

  it('never ask from a build without the push server', async () => {
    vi.stubEnv('VITE_SHARE_ORIGIN', '');
    await db.trips.update(tripId, { remoteTripId: '0b9e8c1a-3f2d-4c5b-9a8e-7d6c5b4a3f2e' });
    announceGuestChange(tripId, 'guests', 'g-1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queued()).toEqual([]);
  });
});
