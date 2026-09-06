/**
 * useTripActions Tests
 *
 * Covers execution of the agenda action blocks: creating, updating, deleting
 * activities and changing who is signed up, plus the guards that keep an
 * invalid or hallucinated payload out of IndexedDB.
 *
 * @module features/assistant/hooks/__tests__/useTripActions.test
 */

import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { AppProviders } from '@/contexts/AppProviders';
import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { createActivity } from '@/lib/db/repositories/activity-repository';
import { createGuestGroup } from '@/lib/db/repositories/guest-group-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import {
  createRide,
  setTransportRide,
} from '@/lib/db/repositories/ride-repository';
import { createRoom } from '@/lib/db/repositories/room-repository';
import { createTransport } from '@/lib/db/repositories/transport-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { createVehicle } from '@/lib/db/repositories/vehicle-repository';
import { hexColor, isoDate, waitForTripDoc } from '@/test/utils';
import type {
  Activity,
  ISODateTimeString,
  PersonId,
  Ride,
  TransportId,
  TripId,
} from '@/types';

import {
  useTripActions,
  type ActionExecutionResult,
} from '../useTripActions';

// ============================================================================
// Test Helpers
// ============================================================================

function Wrapper({ children }: { children: ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}

function useCombined() {
  return { trip: useTripContext(), actions: useTripActions() };
}

/** Wraps an action payload in the fenced block the LLM is asked to emit. */
function actionBlock(payload: unknown): string {
  return `Sure!\n\n\`\`\`action\n${JSON.stringify(payload)}\n\`\`\``;
}

async function seedTrip(): Promise<{ tripId: TripId; personId: PersonId }> {
  const trip = await createTrip({
    name: 'Test Trip',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-30'),
  });
  const person = await createPerson(trip.id, {
    name: 'Alice',
    color: hexColor('#ef4444'),
  });
  return { tripId: trip.id, personId: person.id };
}

/**
 * Selects the trip, then waits for its document to have been seeded from Dexie.
 *
 * That second wait is load-bearing rather than defensive — see
 * {@link waitForTripDoc} for the race it closes.
 */
async function renderWithTrip(tripId: TripId) {
  const { result } = renderHook(() => useCombined(), { wrapper: Wrapper });

  await waitFor(() => {
    expect(result.current.trip.isLoading).toBe(false);
  });

  await act(async () => {
    await result.current.trip.setCurrentTrip(tripId);
  });

  await waitFor(() => {
    expect(result.current.trip.currentTrip?.id).toBe(tripId);
  });

  await waitForTripDoc(tripId);

  return result;
}

async function activitiesOf(tripId: TripId): Promise<Activity[]> {
  return db.activities.where('tripId').equals(tripId).toArray();
}

/**
 * Executes an LLM response inside `act`, so the live queries the mutations
 * trigger settle before the assertions run.
 */
async function run(
  executeActions: (response: string) => Promise<ActionExecutionResult>,
  response: string,
): Promise<ActionExecutionResult> {
  let outcome: ActionExecutionResult = { count: 0, summaries: [] };
  await act(async () => {
    outcome = await executeActions(response);
  });
  return outcome;
}

// ============================================================================
// Tests
// ============================================================================

describe('useTripActions — activities', () => {
  it('creates an activity from an addActivity block', async () => {
    const { tripId, personId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addActivity',
        data: {
          title: 'Plant fair',
          category: 'horticulture',
          startDatetime: '2024-07-16T09:00:00',
          endDatetime: '2024-07-16T12:00:00',
          location: 'Château de Saint-Jean',
          participantIds: [personId],
          maxParticipants: 6,
        },
      }),
    );

    expect(outcome.count).toBe(1);

    const [activity] = await activitiesOf(tripId);
    expect(activity?.title).toBe('Plant fair');
    expect(activity?.category).toBe('horticulture');
    expect(activity?.allDay).toBe(false);
    expect(activity?.participantIds).toEqual([personId]);
  });

  it('drops participant ids that do not belong to the trip', async () => {
    const { tripId, personId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addActivity',
        data: {
          title: 'Hike',
          category: 'hike',
          startDatetime: '2024-07-17T09:00:00',
          participantIds: [personId, 'made-up-id'],
        },
      }),
    );

    const [activity] = await activitiesOf(tripId);
    expect(activity?.participantIds).toEqual([personId]);
  });

  it('refuses an activity that ends before it starts', async () => {
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addActivity',
        data: {
          title: 'Backwards',
          category: 'other',
          startDatetime: '2024-07-18T12:00:00',
          endDatetime: '2024-07-18T09:00:00',
        },
      }),
    );

    expect(outcome.count).toBe(0);
    expect(await activitiesOf(tripId)).toHaveLength(0);
  });

  it('updates an existing activity', async () => {
    const { tripId } = await seedTrip();
    const activity = await createActivity(tripId, {
      title: 'Market',
      category: 'market',
      startDatetime: '2024-07-16T09:00:00.000Z' as ISODateTimeString,
      allDay: false,
      participantIds: [],
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'updateActivity',
        data: {
          activityId: activity.id,
          title: 'Sunday market',
          location: 'Village square',
        },
      }),
    );

    expect(outcome.count).toBe(1);

    const stored = await db.activities.get(activity.id);
    expect(stored?.title).toBe('Sunday market');
    expect(stored?.location).toBe('Village square');
    expect(stored?.category).toBe('market');
  });

  it('refuses an update that would make the record invalid', async () => {
    const { tripId } = await seedTrip();
    const activity = await createActivity(tripId, {
      title: 'Market',
      category: 'market',
      startDatetime: '2024-07-16T09:00:00.000Z' as ISODateTimeString,
      endDatetime: '2024-07-16T11:00:00.000Z' as ISODateTimeString,
      allDay: false,
      participantIds: [],
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'updateActivity',
        data: {
          activityId: activity.id,
          // Z-suffixed: a naive value would be read as local time, making the
          // assertion pass or fail depending on the machine's timezone.
          startDatetime: '2024-07-16T18:00:00.000Z',
        },
      }),
    );

    expect(outcome.count).toBe(0);
    const stored = await db.activities.get(activity.id);
    expect(stored?.startDatetime).toBe('2024-07-16T09:00:00.000Z');
  });

  it('signs a guest up and back out of an activity', async () => {
    const { tripId, personId } = await seedTrip();
    const activity = await createActivity(tripId, {
      title: 'Hike',
      category: 'hike',
      startDatetime: '2024-07-16T09:00:00.000Z' as ISODateTimeString,
      allDay: false,
      participantIds: [],
    });
    const result = await renderWithTrip(tripId);

    await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'joinActivity',
        data: { activityId: activity.id, personId },
      }),
    );
    expect((await db.activities.get(activity.id))?.participantIds).toEqual([
      personId,
    ]);

    await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'leaveActivity',
        data: { activityId: activity.id, personId },
      }),
    );
    expect((await db.activities.get(activity.id))?.participantIds).toEqual([]);
  });

  it('removes an activity', async () => {
    const { tripId } = await seedTrip();
    const activity = await createActivity(tripId, {
      title: 'Cancelled outing',
      category: 'visit',
      startDatetime: '2024-07-16T09:00:00.000Z' as ISODateTimeString,
      allDay: false,
      participantIds: [],
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'removeActivity',
        data: { activityId: activity.id },
      }),
    );

    expect(outcome.count).toBe(1);
    expect(await db.activities.get(activity.id)).toBeUndefined();
  });

  it('normalizes a naive datetime to a UTC instant', async () => {
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addActivity',
        data: {
          title: 'Naive times',
          category: 'other',
          startDatetime: '2024-07-16T09:00:00',
          endDatetime: '2024-07-16T11:00:00',
        },
      }),
    );

    const [activity] = await activitiesOf(tripId);
    // Stored as a real instant, exactly as the form path writes it.
    expect(activity?.startDatetime).toBe(
      new Date('2024-07-16T09:00:00').toISOString(),
    );
    expect(activity?.startDatetime).toMatch(/Z$/);
    expect(activity?.endDatetime).toMatch(/Z$/);
  });

  it('snaps an all-day activity to local day boundaries', async () => {
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addActivity',
        data: {
          title: 'Village fete',
          category: 'culture',
          startDatetime: '2024-07-16T09:00:00',
          allDay: true,
        },
      }),
    );

    const [activity] = await activitiesOf(tripId);
    expect(activity?.allDay).toBe(true);
    // 09:00 is discarded: the span covers the whole local day.
    expect(activity?.startDatetime).toBe(
      new Date(2024, 6, 16, 0, 0, 0, 0).toISOString(),
    );
    expect(activity?.endDatetime).toBe(
      new Date(2024, 6, 16, 23, 59, 59, 999).toISOString(),
    );
  });

  it('re-snaps the instants when an update turns on all-day', async () => {
    const { tripId } = await seedTrip();
    const activity = await createActivity(tripId, {
      title: 'Market',
      category: 'market',
      startDatetime: new Date(2024, 6, 16, 9, 0, 0, 0).toISOString() as ISODateTimeString,
      endDatetime: new Date(2024, 6, 16, 11, 0, 0, 0).toISOString() as ISODateTimeString,
      allDay: false,
      participantIds: [],
    });
    const result = await renderWithTrip(tripId);

    await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'updateActivity',
        data: { activityId: activity.id, allDay: true },
      }),
    );

    const stored = await db.activities.get(activity.id);
    expect(stored?.allDay).toBe(true);
    expect(stored?.startDatetime).toBe(
      new Date(2024, 6, 16, 0, 0, 0, 0).toISOString(),
    );
    expect(stored?.endDatetime).toBe(
      new Date(2024, 6, 16, 23, 59, 59, 999).toISOString(),
    );
  });

  it('keeps a repeated participant id from blowing the seat cap', async () => {
    const { tripId, personId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addActivity',
        data: {
          title: 'Carpool',
          category: 'other',
          startDatetime: '2024-07-16T09:00:00',
          participantIds: [personId, personId, personId],
          maxParticipants: 2,
        },
      }),
    );

    expect(outcome.count).toBe(1);
    const [activity] = await activitiesOf(tripId);
    expect(activity?.participantIds).toEqual([personId]);
  });

  it('refuses to sign up a guest who is not in the trip', async () => {
    const { tripId } = await seedTrip();
    const activity = await createActivity(tripId, {
      title: 'Hike',
      category: 'hike',
      startDatetime: '2024-07-16T09:00:00.000Z' as ISODateTimeString,
      allDay: false,
      participantIds: [],
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'joinActivity',
        data: { activityId: activity.id, personId: 'made-up-id' },
      }),
    );

    expect(outcome.count).toBe(0);
    expect((await db.activities.get(activity.id))?.participantIds).toEqual([]);
  });

  it('does not report a change when a guest is already signed up', async () => {
    const { tripId, personId } = await seedTrip();
    const activity = await createActivity(tripId, {
      title: 'Hike',
      category: 'hike',
      startDatetime: '2024-07-16T09:00:00.000Z' as ISODateTimeString,
      allDay: false,
      participantIds: [personId],
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'joinActivity',
        data: { activityId: activity.id, personId },
      }),
    );

    expect(outcome.count).toBe(0);
    expect(outcome.summaries).toEqual([]);
  });

  it('leaves an activity from another trip untouched', async () => {
    const { tripId } = await seedTrip();
    const other = await createTrip({
      name: 'Other trip',
      startDate: isoDate('2025-01-01'),
      endDate: isoDate('2025-01-05'),
    });
    const foreign = await createActivity(other.id, {
      title: 'Not mine',
      category: 'other',
      startDatetime: '2025-01-02T09:00:00.000Z' as ISODateTimeString,
      allDay: false,
      participantIds: [],
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'removeActivity',
        data: { activityId: foreign.id },
      }),
    );

    expect(outcome.count).toBe(0);
    expect(await db.activities.get(foreign.id)).toBeDefined();
  });
});

// ============================================================================
// Cross-trip foreign keys
// ============================================================================

describe('useTripActions — cross-trip references', () => {
  it('refuses to assign a room to a guest from another trip', async () => {
    const { tripId } = await seedTrip();
    const other = await createTrip({
      name: 'Other trip',
      startDate: isoDate('2025-01-01'),
      endDate: isoDate('2025-01-05'),
    });
    const foreignPerson = await createPerson(other.id, {
      name: 'Not mine',
      color: hexColor('#22c55e'),
    });
    const room = await createRoom(tripId, { name: 'Blue', capacity: 2 });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'assignRoom',
        data: {
          personId: foreignPerson.id,
          roomId: room.id,
          startDate: '2024-07-16',
          endDate: '2024-07-18',
        },
      }),
    );

    expect(outcome.count).toBe(0);
    expect(await db.roomAssignments.where('tripId').equals(tripId).count()).toBe(0);
  });

  it('refuses to assign a room that belongs to another trip', async () => {
    const { tripId, personId } = await seedTrip();
    const other = await createTrip({
      name: 'Other trip',
      startDate: isoDate('2025-01-01'),
      endDate: isoDate('2025-01-05'),
    });
    const foreignRoom = await createRoom(other.id, { name: 'Theirs', capacity: 2 });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'assignRoom',
        data: {
          personId,
          roomId: foreignRoom.id,
          startDate: '2024-07-16',
          endDate: '2024-07-18',
        },
      }),
    );

    expect(outcome.count).toBe(0);
    expect(await db.roomAssignments.where('tripId').equals(tripId).count()).toBe(0);
  });

  it('refuses transport for a guest from another trip', async () => {
    const { tripId } = await seedTrip();
    const other = await createTrip({
      name: 'Other trip',
      startDate: isoDate('2025-01-01'),
      endDate: isoDate('2025-01-05'),
    });
    const foreignPerson = await createPerson(other.id, {
      name: 'Not mine',
      color: hexColor('#22c55e'),
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addTransport',
        data: {
          personId: foreignPerson.id,
          type: 'arrival',
          datetime: '2024-07-16T14:00:00',
          location: 'Gare',
        },
      }),
    );

    expect(outcome.count).toBe(0);
    expect(await db.transports.where('tripId').equals(tripId).count()).toBe(0);
  });

  it('still allows a guest and room from the active trip', async () => {
    const { tripId, personId } = await seedTrip();
    const room = await createRoom(tripId, { name: 'Blue', capacity: 2 });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'assignRoom',
        data: {
          personId,
          roomId: room.id,
          startDate: '2024-07-16',
          endDate: '2024-07-18',
        },
      }),
    );

    expect(outcome.count).toBe(1);
    expect(await db.roomAssignments.where('tripId').equals(tripId).count()).toBe(1);
  });
});

// ============================================================================
// Trip Map Pin
// ============================================================================

describe('useTripActions — trip map pin', () => {
  it('drops the map pin when the assistant renames the location', async () => {
    const trip = await createTrip({
      name: 'Pinned Trip',
      location: 'Brest, Bretagne',
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-30'),
      coordinates: { lat: 48.3904, lon: -4.4861 },
    });
    const result = await renderWithTrip(trip.id);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'updateTrip',
        data: { location: 'Annecy, Haute-Savoie' },
      }),
    );

    expect(outcome.count).toBe(1);

    // The pin was resolved from the old name; keeping it would leave the trip
    // showing in Brittany on the analytics map.
    const updated = await db.trips.get(trip.id);
    expect(updated?.location).toBe('Annecy, Haute-Savoie');
    expect(updated?.coordinates).toBeUndefined();
  });

  it('keeps the map pin when the assistant edits another field', async () => {
    const trip = await createTrip({
      name: 'Pinned Trip',
      location: 'Brest, Bretagne',
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-30'),
      coordinates: { lat: 48.3904, lon: -4.4861 },
    });
    const result = await renderWithTrip(trip.id);

    await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'updateTrip',
        data: { name: 'Renamed Trip' },
      }),
    );

    const updated = await db.trips.get(trip.id);
    expect(updated?.name).toBe('Renamed Trip');
    expect(updated?.coordinates).toEqual({ lat: 48.3904, lon: -4.4861 });
  });
});

// ============================================================================
// Guest groups
// ============================================================================

describe('useTripActions — guest groups', () => {
  /** A group with a couple, a solo guest and somebody carrying notes. */
  async function seedFamilyGroup() {
    return createGuestGroup({
      name: 'Family',
      members: [
        { name: 'Tom + Léa', color: hexColor('#ef4444'), headcount: 2 },
        { name: 'Bob', color: hexColor('#3b82f6') },
        { name: 'Camille', color: hexColor('#22c55e'), notes: 'Peanut allergy' },
      ],
    });
  }

  it('imports the whole group when no members are named', async () => {
    const { tripId } = await seedTrip();
    const group = await seedFamilyGroup();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'importGuestGroup', data: { groupId: group.id } }),
    );

    expect(outcome.count).toBe(1);

    // Alice is already on the trip from seedTrip(), so three more arrive.
    const guests = await db.persons.where('tripId').equals(tripId).toArray();
    expect(guests.map((guest) => guest.name).sort()).toEqual([
      'Alice',
      'Bob',
      'Camille',
      'Tom + Léa',
    ]);
  });

  it('imports only the members the model named', async () => {
    const { tripId } = await seedTrip();
    const group = await seedFamilyGroup();
    const result = await renderWithTrip(tripId);

    await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'importGuestGroup',
        data: { groupId: group.id, memberIds: [group.members[2]!.id] },
      }),
    );

    const guests = await db.persons.where('tripId').equals(tripId).toArray();
    expect(guests.map((guest) => guest.name).sort()).toEqual(['Alice', 'Camille']);
  });

  it('carries headcount and notes onto the imported guests', async () => {
    const { tripId } = await seedTrip();
    const group = await seedFamilyGroup();
    const result = await renderWithTrip(tripId);

    await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'importGuestGroup', data: { groupId: group.id } }),
    );

    const guests = await db.persons.where('tripId').equals(tripId).toArray();
    expect(guests.find((guest) => guest.name === 'Tom + Léa')?.headcount).toBe(2);
    expect(guests.find((guest) => guest.name === 'Camille')?.notes).toBe(
      'Peanut allergy',
    );
  });

  it('does nothing for a group id that does not exist', async () => {
    const { tripId } = await seedTrip();
    await seedFamilyGroup();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'importGuestGroup', data: { groupId: 'nope' } }),
    );

    expect(outcome.count).toBe(0);
    expect(await db.persons.where('tripId').equals(tripId).count()).toBe(1);
  });

  it('imports what it can when a named member has since been removed', async () => {
    const { tripId } = await seedTrip();
    const group = await seedFamilyGroup();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'importGuestGroup',
        data: { groupId: group.id, memberIds: [group.members[0]!.id, 'gone'] },
      }),
    );

    // A stale id is not a reason to import nobody.
    expect(outcome.count).toBe(1);
    const guests = await db.persons.where('tripId').equals(tripId).toArray();
    expect(guests.map((guest) => guest.name).sort()).toEqual(['Alice', 'Tom + Léa']);
  });

  it('leaves the group untouched — an import is a copy', async () => {
    const { tripId } = await seedTrip();
    const group = await seedFamilyGroup();
    const result = await renderWithTrip(tripId);

    await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'importGuestGroup', data: { groupId: group.id } }),
    );

    const stored = await db.guestGroups.get(group.id);
    expect(stored?.members).toHaveLength(3);
  });

  it('imports two groups from one reply', async () => {
    const { tripId } = await seedTrip();
    const family = await seedFamilyGroup();
    const neighbours = await createGuestGroup({
      name: 'Neighbours',
      members: [{ name: 'Dana', color: hexColor('#8b5cf6') }],
    });
    const result = await renderWithTrip(tripId);

    // "One block per change" is the contract the action prompt states, so two
    // families is two blocks rather than a new plural action.
    const outcome = await run(
      result.current.actions.executeActions,
      [
        'Adding both.',
        '```action',
        JSON.stringify({
          action: 'importGuestGroup',
          data: { groupId: family.id },
        }),
        '```',
        '```action',
        JSON.stringify({
          action: 'importGuestGroup',
          data: { groupId: neighbours.id },
        }),
        '```',
      ].join('\n'),
    );

    expect(outcome.count).toBe(2);

    const guests = await db.persons.where('tripId').equals(tripId).toArray();
    expect(guests.map((guest) => guest.name).sort()).toEqual([
      'Alice',
      'Bob',
      'Camille',
      'Dana',
      'Tom + Léa',
    ]);
  });

  it('refuses to import with no trip selected', async () => {
    const group = await seedFamilyGroup();
    const { result } = renderHook(() => useCombined(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.trip.isLoading).toBe(false);
    });

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'importGuestGroup', data: { groupId: group.id } }),
    );

    expect(outcome.count).toBe(0);
    expect(await db.persons.count()).toBe(0);
  });
});

// ============================================================================
// Rides and cars
// ============================================================================

/** A trip with a guest, a would-be driver, a car and one arrival leg. */
async function seedRideTrip() {
  const trip = await createTrip({
    name: 'Ride Trip',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-30'),
  });
  const alice = await createPerson(trip.id, {
    name: 'Alice',
    color: hexColor('#ef4444'),
  });
  const tom = await createPerson(trip.id, {
    name: 'Tom',
    color: hexColor('#22c55e'),
  });
  const vehicle = await createVehicle(trip.id, {
    name: 'Hired Espace',
    seatCount: 7,
  });
  const leg = await createTransport(trip.id, {
    personId: alice.id,
    type: 'arrival',
    datetime: '2024-07-16T15:00:00.000Z' as ISODateTimeString,
    location: 'Lyon Part-Dieu',
    needsPickup: true,
  });

  return {
    tripId: trip.id,
    tomId: tom.id,
    vehicleId: vehicle.id,
    legId: leg.id,
  };
}

async function ridesOf(tripId: TripId): Promise<Ride[]> {
  return db.rides.where('tripId').equals(tripId).toArray();
}

describe('useTripActions — rides and cars', () => {
  it('creates a ride from an addRide block', async () => {
    const { tripId, tomId, vehicleId } = await seedRideTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addRide',
        data: {
          direction: 'pickup',
          meetDatetime: '2024-07-16T15:02:00',
          location: 'Lyon Part-Dieu',
          leadTimeMinutes: 45,
          driverId: tomId,
          vehicleId,
        },
      }),
    );

    expect(outcome.count).toBe(1);
    const [ride] = await ridesOf(tripId);
    expect(ride?.direction).toBe('pickup');
    expect(ride?.location).toBe('Lyon Part-Dieu');
    expect(ride?.leadTimeMinutes).toBe(45);
    expect(ride?.driverId).toBe(tomId);
    expect(ride?.vehicleId).toBe(vehicleId);
  });

  it('canonicalises a meeting time the model wrote without seconds', async () => {
    const { tripId } = await seedRideTrip();
    const result = await renderWithTrip(tripId);

    // `RideFormDataSchema` demands seconds; a model writing "15:02" means a
    // real instant, so it is normalised the way the form's own input is rather
    // than refused as invalid.
    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addRide',
        data: {
          direction: 'pickup',
          meetDatetime: '2024-07-16T15:02',
          location: 'Gare',
        },
      }),
    );

    expect(outcome.count).toBe(1);
    const [ride] = await ridesOf(tripId);
    expect(ride?.meetDatetime).toMatch(/Z$/);
  });

  it('refuses a ride whose meeting time cannot be placed', async () => {
    const { tripId } = await seedRideTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addRide',
        data: {
          direction: 'pickup',
          meetDatetime: 'next Tuesday',
          location: 'Gare',
        },
      }),
    );

    expect(outcome.count).toBe(0);
    expect(await ridesOf(tripId)).toHaveLength(0);
  });

  it('refuses a lead time outside its bounds instead of storing it', async () => {
    const { tripId } = await seedRideTrip();
    const result = await renderWithTrip(tripId);

    // Unbounded, this value puts a "leave now" alert centuries in the past,
    // where it is permanently due and permanently on screen.
    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addRide',
        data: {
          direction: 'pickup',
          meetDatetime: '2024-07-16T15:02:00',
          location: 'Gare',
          leadTimeMinutes: 100000,
        },
      }),
    );

    expect(outcome.count).toBe(0);
    expect(await ridesOf(tripId)).toHaveLength(0);
  });

  it('drops a driver from another trip and still creates the ride', async () => {
    const { tripId } = await seedRideTrip();
    const other = await createTrip({
      name: 'Other trip',
      startDate: isoDate('2025-01-01'),
      endDate: isoDate('2025-01-05'),
    });
    const foreign = await createPerson(other.id, {
      name: 'Not mine',
      color: hexColor('#8b5cf6'),
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addRide',
        data: {
          direction: 'pickup',
          meetDatetime: '2024-07-16T15:02:00',
          location: 'Gare',
          driverId: foreign.id,
        },
      }),
    );

    // The reference is an orphan waiting to happen; the journey itself is not.
    expect(outcome.count).toBe(1);
    const [ride] = await ridesOf(tripId);
    expect(ride?.driverId).toBeUndefined();
  });

  it('edits an existing ride rather than creating another', async () => {
    const { tripId, tomId } = await seedRideTrip();
    const ride = await createRide(tripId, {
      direction: 'pickup',
      meetDatetime: '2024-07-16T15:02:00.000Z' as ISODateTimeString,
      location: 'Lyon Part-Dieu',
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'updateRide',
        data: { rideId: ride.id, driverId: tomId, location: 'Gare de Brest' },
      }),
    );

    expect(outcome.count).toBe(1);
    const rides = await ridesOf(tripId);
    expect(rides).toHaveLength(1);
    expect(rides[0]?.driverId).toBe(tomId);
    expect(rides[0]?.location).toBe('Gare de Brest');
  });

  it('refuses to edit a ride that belongs to another trip', async () => {
    const { tripId } = await seedRideTrip();
    const other = await createTrip({
      name: 'Other trip',
      startDate: isoDate('2025-01-01'),
      endDate: isoDate('2025-01-05'),
    });
    const foreignRide = await createRide(other.id, {
      direction: 'pickup',
      meetDatetime: '2025-01-02T10:00:00.000Z' as ISODateTimeString,
      location: 'Theirs',
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'updateRide',
        data: { rideId: foreignRide.id, location: 'Mine now' },
      }),
    );

    expect(outcome.count).toBe(0);
    expect((await db.rides.get(foreignRide.id))?.location).toBe('Theirs');
  });

  it('cancels a ride and puts its passengers back to needing a lift', async () => {
    const { tripId, legId } = await seedRideTrip();
    const ride = await createRide(tripId, {
      direction: 'pickup',
      meetDatetime: '2024-07-16T15:02:00.000Z' as ISODateTimeString,
      location: 'Lyon Part-Dieu',
    });
    await setTransportRide(legId, tripId, ride.id);
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'removeRide', data: { rideId: ride.id } }),
    );

    expect(outcome.count).toBe(1);
    expect(await ridesOf(tripId)).toHaveLength(0);
    // Cancelling the car does not cancel anybody's train.
    const leg = await db.transports.get(legId);
    expect(leg).toBeDefined();
    expect(leg?.rideId).toBeUndefined();
  });

  it('clears the pin when the assistant moves a ride to another place', async () => {
    const { tripId } = await seedRideTrip();
    const ride = await createRide(tripId, {
      direction: 'pickup',
      meetDatetime: '2024-07-16T15:02:00.000Z' as ISODateTimeString,
      location: 'Lyon Part-Dieu',
      coordinates: { lat: 45.7605, lon: 4.8595 },
    });
    const result = await renderWithTrip(tripId);

    await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'updateRide',
        data: { rideId: ride.id, location: 'Aéroport Saint-Exupéry' },
      }),
    );

    // Left in place, the directions button sends the driver to the station the
    // ride no longer meets at — on every device, once it syncs. `updateTrip`
    // clears the trip's pin for exactly this reason.
    const stored = await db.rides.get(ride.id);
    expect(stored?.location).toBe('Aéroport Saint-Exupéry');
    expect(stored?.coordinates).toBeUndefined();
  });

  it('turns a pickup into a dropoff without emptying the car', async () => {
    const { tripId, legId } = await seedRideTrip();
    const ride = await createRide(tripId, {
      direction: 'pickup',
      meetDatetime: '2024-07-16T15:02:00.000Z' as ISODateTimeString,
      location: 'Lyon Part-Dieu',
    });
    await setTransportRide(legId, tripId, ride.id);
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'updateRide',
        data: { rideId: ride.id, direction: 'dropoff' },
      }),
    );

    // The alternative — remove and re-add — detaches every passenger, so one
    // wrong word would throw the car's occupants out of it.
    expect(outcome.count).toBe(1);
    expect((await db.rides.get(ride.id))?.direction).toBe('dropoff');
    expect((await db.transports.get(legId))?.rideId).toBe(ride.id);
  });

  it('adds a car with its seats and child restraints', async () => {
    const { tripId, tomId } = await seedRideTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addVehicle',
        data: {
          name: 'La Clio de Guillaume',
          ownerId: tomId,
          seatCount: 5,
          childSeats: ['booster', 'booster'],
        },
      }),
    );

    expect(outcome.count).toBe(1);
    const vehicle = await db.vehicles
      .where('tripId')
      .equals(tripId)
      .filter((row) => row.name === 'La Clio de Guillaume')
      .first();
    expect(vehicle?.seatCount).toBe(5);
    expect(vehicle?.ownerId).toBe(tomId);
    // One entry per seat, so the repeat is the point rather than a duplicate.
    expect(vehicle?.childSeats).toEqual(['booster', 'booster']);
  });

  it('drops a child seat kind the app does not know, keeping the car', async () => {
    const { tripId } = await seedRideTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addVehicle',
        data: { name: 'Kangoo', childSeats: ['booster', 'rehausseur'] },
      }),
    );

    expect(outcome.count).toBe(1);
    const vehicle = await db.vehicles
      .where('tripId')
      .equals(tripId)
      .filter((row) => row.name === 'Kangoo')
      .first();
    expect(vehicle?.childSeats).toEqual(['booster']);
  });

  it('refuses a seat count outside its bounds', async () => {
    const { tripId } = await seedRideTrip();
    const result = await renderWithTrip(tripId);

    // An unbounded capacity reached `Array.from({length: capacity})` elsewhere
    // in this codebase and permanently OOM'd the tab.
    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addVehicle',
        data: { name: 'Coach', seatCount: 100000 },
      }),
    );

    expect(outcome.count).toBe(0);
    const stored = await db.vehicles
      .where('tripId')
      .equals(tripId)
      .filter((row) => row.name === 'Coach')
      .count();
    expect(stored).toBe(0);
  });

  it('puts a leg in a car and takes it back out', async () => {
    const { tripId, legId } = await seedRideTrip();
    const ride = await createRide(tripId, {
      direction: 'pickup',
      meetDatetime: '2024-07-16T15:02:00.000Z' as ISODateTimeString,
      location: 'Lyon Part-Dieu',
    });
    const result = await renderWithTrip(tripId);

    const joined = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'joinRide',
        data: { transportId: legId, rideId: ride.id },
      }),
    );

    expect(joined.count).toBe(1);
    expect((await db.transports.get(legId))?.rideId).toBe(ride.id);

    const left = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'leaveRide', data: { transportId: legId } }),
    );

    expect(left.count).toBe(1);
    expect((await db.transports.get(legId))?.rideId).toBeUndefined();
  });

  it('reports no change when the leg is already in that car', async () => {
    const { tripId, legId } = await seedRideTrip();
    const ride = await createRide(tripId, {
      direction: 'pickup',
      meetDatetime: '2024-07-16T15:02:00.000Z' as ISODateTimeString,
      location: 'Lyon Part-Dieu',
    });
    await setTransportRide(legId, tripId, ride.id);
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'joinRide',
        data: { transportId: legId, rideId: ride.id },
      }),
    );

    // Reporting a change that did not happen is how a change list stops being
    // worth reading.
    expect(outcome.count).toBe(0);
  });

  it('refuses to put a leg from another trip in a car', async () => {
    const { tripId } = await seedRideTrip();
    const other = await createTrip({
      name: 'Other trip',
      startDate: isoDate('2025-01-01'),
      endDate: isoDate('2025-01-05'),
    });
    const foreignPerson = await createPerson(other.id, {
      name: 'Not mine',
      color: hexColor('#8b5cf6'),
    });
    const foreignLeg = await createTransport(other.id, {
      personId: foreignPerson.id,
      type: 'arrival',
      datetime: '2025-01-02T10:00:00.000Z' as ISODateTimeString,
      location: 'Theirs',
      needsPickup: true,
    });
    const ride = await createRide(tripId, {
      direction: 'pickup',
      meetDatetime: '2024-07-16T15:02:00.000Z' as ISODateTimeString,
      location: 'Lyon Part-Dieu',
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'joinRide',
        data: { transportId: foreignLeg.id, rideId: ride.id },
      }),
    );

    expect(outcome.count).toBe(0);
    expect((await db.transports.get(foreignLeg.id))?.rideId).toBeUndefined();
  });

  it('refuses to put a leg in a car from another trip', async () => {
    const { tripId, legId } = await seedRideTrip();
    const other = await createTrip({
      name: 'Other trip',
      startDate: isoDate('2025-01-01'),
      endDate: isoDate('2025-01-05'),
    });
    const foreignRide = await createRide(other.id, {
      direction: 'pickup',
      meetDatetime: '2025-01-02T10:00:00.000Z' as ISODateTimeString,
      location: 'Theirs',
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'joinRide',
        data: { transportId: legId, rideId: foreignRide.id },
      }),
    );

    expect(outcome.count).toBe(0);
    expect((await db.transports.get(legId))?.rideId).toBeUndefined();
  });

  it('takes a leg out of a pre-ride driver arrangement', async () => {
    const { tripId, tomId, legId } = await seedRideTrip();
    // The shape from before rides existed: a driver named on the leg itself,
    // which the prompt shows as a leg somebody is driving.
    await db.transports.update(legId, { driverId: tomId });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'leaveRide', data: { transportId: legId } }),
    );

    // Treating "no rideId" as "already out" made this a silent no-op, and
    // nothing else in the catalogue can clear a leg's own driver.
    expect(outcome.count).toBe(1);
    expect((await db.transports.get(legId))?.driverId).toBeUndefined();
  });

  it('removes a car and leaves the rides that named it standing', async () => {
    const { tripId, vehicleId } = await seedRideTrip();
    const ride = await createRide(tripId, {
      direction: 'pickup',
      meetDatetime: '2024-07-16T15:02:00.000Z' as ISODateTimeString,
      location: 'Lyon Part-Dieu',
      vehicleId,
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'removeVehicle', data: { vehicleId } }),
    );

    expect(outcome.count).toBe(1);
    expect(await db.vehicles.get(vehicleId)).toBeUndefined();
    // Three people still have a train to meet.
    const stored = await db.rides.get(ride.id);
    expect(stored).toBeDefined();
    expect(stored?.vehicleId).toBeUndefined();
  });

  it('does nothing for a leg id that does not exist', async () => {
    const { tripId } = await seedRideTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'leaveRide',
        data: { transportId: 'made-up' as TransportId },
      }),
    );

    expect(outcome.count).toBe(0);
  });

  it('refuses a ride action with no trip selected', async () => {
    const { result } = renderHook(() => useCombined(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.trip.isLoading).toBe(false);
    });

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addRide',
        data: {
          direction: 'pickup',
          meetDatetime: '2024-07-16T15:02:00',
          location: 'Gare',
        },
      }),
    );

    expect(outcome.count).toBe(0);
    expect(await db.rides.count()).toBe(0);
  });
});
