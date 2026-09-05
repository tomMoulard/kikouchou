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
import { createRoom } from '@/lib/db/repositories/room-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { hexColor, isoDate, waitForTripDoc } from '@/test/utils';
import type { Activity, ISODateTimeString, PersonId, TripId } from '@/types';

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
