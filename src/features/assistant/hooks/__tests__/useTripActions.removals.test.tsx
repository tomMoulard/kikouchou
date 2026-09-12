/**
 * useTripActions — removals, and the transport pair.
 *
 * Every action here deletes something or adds a leg to the transport list. The
 * pattern each one is checked against is the same: the row is gone (or there),
 * the reply counts it once, and an id the trip does not own changes nothing.
 *
 * Same stack as the sibling files: the real Dexie on fake-indexeddb, no mocks.
 *
 * @module features/assistant/hooks/__tests__/useTripActions.removals.test
 */

import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { AppProviders } from '@/contexts/AppProviders';
import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { createAssignment } from '@/lib/db/repositories/assignment-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createRoom } from '@/lib/db/repositories/room-repository';
import { createTransport } from '@/lib/db/repositories/transport-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { hexColor, isoDate, localInstant, waitForTripDoc } from '@/test/utils';
import type { PersonId, RoomId, TripId } from '@/types';

import { useTripActions, type ActionExecutionResult } from '../useTripActions';

// ============================================================================
// Test Helpers
// ============================================================================

function Wrapper({ children }: { children: ReactNode }) {
  return <AppProviders>{children}</AppProviders>;
}

function useCombined() {
  return { trip: useTripContext(), actions: useTripActions() };
}

function actionBlock(payload: unknown): string {
  return `Sure!\n\n\`\`\`action\n${JSON.stringify(payload)}\n\`\`\``;
}

async function seedTrip(): Promise<{ tripId: TripId; personId: PersonId; roomId: RoomId }> {
  const trip = await createTrip({
    name: 'Test Trip',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-30'),
  });
  const person = await createPerson(trip.id, { name: 'Alice', color: hexColor('#ef4444') });
  const room = await createRoom(trip.id, { name: 'Attic', capacity: 2 });

  return { tripId: trip.id, personId: person.id, roomId: room.id };
}

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

describe('useTripActions — removing guests and rooms', () => {
  it('removes a guest named by id', async () => {
    const { tripId, personId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'removeGuest', data: { personId } }),
    );

    expect(outcome.count).toBe(1);
    await expect(db.persons.get(personId)).resolves.toBeUndefined();
  });

  it('leaves the guest list alone when the id is not on this trip', async () => {
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'removeGuest', data: { personId: 'no-such-guest' } }),
    );

    expect(outcome.count).toBe(0);
    await expect(db.persons.where('tripId').equals(tripId).count()).resolves.toBe(1);
  });

  it('adds a guest and then removes them in the same reply', async () => {
    const { tripId, personId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      [
        actionBlock({ action: 'addGuest', data: { name: 'Bob' } }),
        actionBlock({ action: 'removeGuest', data: { personId } }),
      ].join('\n\n'),
    );

    expect(outcome.count).toBe(2);
    const guests = await db.persons.where('tripId').equals(tripId).toArray();
    expect(guests.map((guest) => guest.name)).toEqual(['Bob']);
  });

  it('removes a room named by id', async () => {
    const { tripId, roomId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'removeRoom', data: { roomId } }),
    );

    expect(outcome.count).toBe(1);
    await expect(db.rooms.get(roomId)).resolves.toBeUndefined();
  });

  it('leaves the rooms alone when the id is not on this trip', async () => {
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'removeRoom', data: { roomId: 'no-such-room' } }),
    );

    expect(outcome.count).toBe(0);
    await expect(db.rooms.where('tripId').equals(tripId).count()).resolves.toBe(1);
  });
});

describe('useTripActions — removing a room assignment', () => {
  it('removes the stay named by id', async () => {
    const { tripId, personId, roomId } = await seedTrip();
    const assignment = await createAssignment(tripId, {
      personId,
      roomId,
      startDate: isoDate('2024-07-16'),
      endDate: isoDate('2024-07-18'),
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'removeAssignment', data: { assignmentId: assignment.id } }),
    );

    expect(outcome.count).toBe(1);
    await expect(db.roomAssignments.get(assignment.id)).resolves.toBeUndefined();
  });

  it('leaves the stays alone when the id is not on this trip', async () => {
    const { tripId, personId, roomId } = await seedTrip();
    await createAssignment(tripId, {
      personId,
      roomId,
      startDate: isoDate('2024-07-16'),
      endDate: isoDate('2024-07-18'),
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'removeAssignment', data: { assignmentId: 'no-such-stay' } }),
    );

    expect(outcome.count).toBe(0);
    await expect(db.roomAssignments.where('tripId').equals(tripId).count()).resolves.toBe(1);
  });
});

describe('useTripActions — transports', () => {
  it('adds an arrival for a guest of this trip', async () => {
    const { tripId, personId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addTransport',
        data: {
          personId,
          type: 'arrival',
          datetime: '2024-07-16T10:00',
          location: 'Gare de Lyon',
          transportMode: 'train',
          needsPickup: true,
        },
      }),
    );

    expect(outcome.count).toBe(1);
    const transports = await db.transports.where('tripId').equals(tripId).toArray();
    expect(transports).toHaveLength(1);
    expect(transports[0]).toMatchObject({
      personId,
      type: 'arrival',
      location: 'Gare de Lyon',
      needsPickup: true,
    });
  });

  it('removes a transport named by id', async () => {
    const { tripId, personId } = await seedTrip();
    const transport = await createTransport(tripId, {
      personId,
      type: 'departure',
      datetime: localInstant('2024-07-20', '08:00'),
      location: 'Orly',
      needsPickup: false,
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'removeTransport', data: { transportId: transport.id } }),
    );

    expect(outcome.count).toBe(1);
    await expect(db.transports.get(transport.id)).resolves.toBeUndefined();
  });

  it('leaves the transports alone when the id is not on this trip', async () => {
    const { tripId, personId } = await seedTrip();
    await createTransport(tripId, {
      personId,
      type: 'departure',
      datetime: localInstant('2024-07-20', '08:00'),
      location: 'Orly',
      needsPickup: false,
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'removeTransport', data: { transportId: 'no-such-leg' } }),
    );

    expect(outcome.count).toBe(0);
    await expect(db.transports.where('tripId').equals(tripId).count()).resolves.toBe(1);
  });

  it('adds a leg and removes another in the same reply', async () => {
    const { tripId, personId } = await seedTrip();
    const departure = await createTransport(tripId, {
      personId,
      type: 'departure',
      datetime: localInstant('2024-07-20', '08:00'),
      location: 'Orly',
      needsPickup: false,
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      [
        actionBlock({
          action: 'addTransport',
          data: {
            personId,
            type: 'arrival',
            datetime: '2024-07-16T10:00',
            location: 'Gare de Lyon',
          },
        }),
        actionBlock({ action: 'removeTransport', data: { transportId: departure.id } }),
      ].join('\n\n'),
    );

    expect(outcome.count).toBe(2);
    const transports = await db.transports.where('tripId').equals(tripId).toArray();
    expect(transports.map((leg) => leg.type)).toEqual(['arrival']);
  });
});

describe('useTripActions — ids the trip does not own', () => {
  it('refuses every id that names nothing on this trip', async () => {
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      [
        actionBlock({ action: 'removeRide', data: { rideId: 'no-such-ride' } }),
        actionBlock({ action: 'updateRide', data: { rideId: 'no-such-ride', location: 'Orly' } }),
        actionBlock({ action: 'removeVehicle', data: { vehicleId: 'no-such-car' } }),
        actionBlock({ action: 'removeActivity', data: { activityId: 'no-such-activity' } }),
        actionBlock({
          action: 'updateActivity',
          data: { activityId: 'no-such-activity', title: 'Market' },
        }),
        actionBlock({
          action: 'joinActivity',
          data: { activityId: 'no-such-activity', personId: 'no-such-guest' },
        }),
        actionBlock({ action: 'removeExpense', data: { expenseId: 'no-such-expense' } }),
        actionBlock({ action: 'updateExpense', data: { expenseId: 'no-such-expense', amount: 5 } }),
      ].join('\n\n'),
    );

    expect(outcome.count).toBe(0);
    await expect(db.rides.count()).resolves.toBe(0);
    await expect(db.vehicles.count()).resolves.toBe(0);
    await expect(db.activities.count()).resolves.toBe(0);
    await expect(db.expenses.count()).resolves.toBe(0);
  });

  it('ignores a patch that names no field it can change', async () => {
    const { tripId } = await seedTrip();
    const before = await db.trips.get(tripId);
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'updateTrip', data: {} }),
    );

    expect(outcome.count).toBe(0);
    await expect(db.trips.get(tripId)).resolves.toMatchObject({ name: before!.name });
  });

  it('refuses an activity whose start cannot be read as a time', async () => {
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addActivity',
        data: { title: 'Market', category: 'market', startDatetime: 'next tuesday' },
      }),
    );

    expect(outcome.count).toBe(0);
    await expect(db.activities.where('tripId').equals(tripId).count()).resolves.toBe(0);
  });
});
