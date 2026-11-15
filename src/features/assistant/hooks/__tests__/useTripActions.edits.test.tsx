/**
 * useTripActions: the edits that came after the first batch.
 *
 * Each action here changes a record the assistant could only add or remove
 * before: a guest, a room, an assignment, a leg, a car, a shopping item, a
 * saved group, and the trip itself. Every test reads the row back from Dexie,
 * so it proves the write and not the summary line.
 *
 * @module features/assistant/hooks/__tests__/useTripActions.edits.test
 */

import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { AppProviders } from '@/contexts/AppProviders';
import { useTripContext } from '@/contexts/TripContext';
import { FLAG_OVERRIDE_PREFIX } from '@/hooks/useFeatureFlag';
import { db } from '@/lib/db/database';
import { createAssignment } from '@/lib/db/repositories/assignment-repository';
import { createGuestGroup } from '@/lib/db/repositories/guest-group-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createRoom } from '@/lib/db/repositories/room-repository';
import { createShoppingItem } from '@/lib/db/repositories/shopping-item-repository';
import {
  createSharedTransports,
  createTransport,
} from '@/lib/db/repositories/transport-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { createVehicle } from '@/lib/db/repositories/vehicle-repository';
import { MEAL_PLANNER_FLAG } from '@/lib/flags';
import {
  hexColor,
  installTestLocalStorage,
  isoDate,
  localInstant,
  waitForTripDoc,
} from '@/test/utils';
import type { PersonId, TripId } from '@/types';

import { DESTRUCTIVE_ACTIONS, useTripActions, type ActionExecutionResult } from '../useTripActions';

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

async function seedTrip(): Promise<{ tripId: TripId; alice: PersonId; bob: PersonId }> {
  const trip = await createTrip({
    name: 'Test Trip',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-25'),
  });
  const alice = await createPerson(trip.id, { name: 'Alice', color: hexColor('#ef4444') });
  const bob = await createPerson(trip.id, { name: 'Bob', color: hexColor('#3b82f6') });
  return { tripId: trip.id, alice: alice.id, bob: bob.id };
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
  payload: unknown,
): Promise<ActionExecutionResult> {
  let outcome: ActionExecutionResult = { count: 0, summaries: [] };
  await act(async () => {
    outcome = await executeActions(actionBlock(payload));
  });
  return outcome;
}

/** A second leg on the train the first one started. */
function sameTrain(firstLegId: string) {
  return {
    type: 'arrival' as const,
    datetime: localInstant('2024-07-16', '10:00'),
    location: 'Gare de Lyon',
    needsPickup: false,
    sharedLegId: firstLegId as never,
  };
}

beforeAll(() => {
  installTestLocalStorage();
});

let consoleWarn: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  window.localStorage.setItem(`${FLAG_OVERRIDE_PREFIX}${MEAL_PLANNER_FLAG}`, 'on');
});

afterEach(() => {
  consoleWarn.mockRestore();
  consoleError.mockRestore();
  window.localStorage.clear();
});

// ============================================================================
// Trip
// ============================================================================

describe('useTripActions: the trip', () => {
  it('sets the currency and a map pin', async () => {
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(result.current.actions.executeActions, {
      action: 'updateTrip',
      data: { currency: 'chf', latitude: 46.2, longitude: 6.15 },
    });

    expect(outcome.count).toBe(1);
    await expect(db.trips.get(tripId)).resolves.toMatchObject({
      currency: 'CHF',
      coordinates: { lat: 46.2, lon: 6.15 },
    });
  });

  it('refuses half a pin and a code that is not a currency', async () => {
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const half = await run(result.current.actions.executeActions, {
      action: 'updateTrip',
      data: { latitude: 46.2 },
    });
    const euros = await run(result.current.actions.executeActions, {
      action: 'updateTrip',
      data: { currency: 'euros' },
    });

    expect(half.count + euros.count).toBe(0);
    const trip = await db.trips.get(tripId);
    expect(trip?.coordinates).toBeUndefined();
    expect(trip?.currency).not.toBe('euros');
  });

  it('deletes a trip, waits for the user first, and drops the selection', async () => {
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    expect(DESTRUCTIVE_ACTIONS.has('deleteTrip')).toBe(true);
    const outcome = await run(result.current.actions.executeActions, {
      action: 'deleteTrip',
      data: { tripId },
    });

    expect(outcome.summaries).toEqual(['assistant.actionDetails.deleteTrip']);
    await expect(db.trips.get(tripId)).resolves.toBeUndefined();
    await expect(db.persons.where('tripId').equals(tripId).count()).resolves.toBe(0);
    await waitFor(() => {
      expect(result.current.trip.currentTrip).toBeNull();
    });
  });
});

// ============================================================================
// Guests and groups
// ============================================================================

describe('useTripActions: guests and saved groups', () => {
  it('edits a guest, and clears a stay when asked', async () => {
    const { tripId, alice } = await seedTrip();
    const result = await renderWithTrip(tripId);

    await run(result.current.actions.executeActions, {
      action: 'updateGuest',
      data: {
        personId: alice,
        name: 'Alice M.',
        stayStartDate: '2024-07-16',
        stayEndDate: '2024-07-20',
        headcount: 2,
        color: '#10B981',
        dietaryTags: ['vegan'],
      },
    });
    await expect(db.persons.get(alice)).resolves.toMatchObject({
      name: 'Alice M.',
      stayStartDate: '2024-07-16',
      stayEndDate: '2024-07-20',
      headcount: 2,
      color: '#10b981',
      dietaryTags: ['vegan'],
    });

    await run(result.current.actions.executeActions, {
      action: 'updateGuest',
      data: { personId: alice, clearStay: true },
    });
    const cleared = await db.persons.get(alice);
    expect(cleared?.stayStartDate).toBeUndefined();
    expect(cleared?.stayEndDate).toBeUndefined();
  });

  it('refuses a stay that ends before it starts, and a guest of another trip', async () => {
    const { tripId, alice } = await seedTrip();
    const other = await createTrip({ name: 'Other' });
    const stranger = await createPerson(other.id, { name: 'Zoe', color: hexColor('#000000') });
    const result = await renderWithTrip(tripId);

    const backwards = await run(result.current.actions.executeActions, {
      action: 'updateGuest',
      data: { personId: alice, stayStartDate: '2024-07-20', stayEndDate: '2024-07-16' },
    });
    const elsewhere = await run(result.current.actions.executeActions, {
      action: 'updateGuest',
      data: { personId: stranger.id, name: 'Hijacked' },
    });

    expect(backwards.count + elsewhere.count).toBe(0);
    await expect(db.persons.get(stranger.id)).resolves.toMatchObject({ name: 'Zoe' });
  });

  it('keeps the diet out of an edit while the meal planner is off', async () => {
    window.localStorage.setItem(`${FLAG_OVERRIDE_PREFIX}${MEAL_PLANNER_FLAG}`, 'off');
    const { tripId, alice } = await seedTrip();
    const result = await renderWithTrip(tripId);

    await run(result.current.actions.executeActions, {
      action: 'updateGuest',
      data: { personId: alice, notes: 'Late', dietaryTags: ['vegan'] },
    });

    const stored = await db.persons.get(alice);
    expect(stored?.notes).toBe('Late');
    expect(stored?.dietaryTags).toBeUndefined();
  });

  it('saves guests as a group, edits it and deletes it', async () => {
    const { tripId, alice, bob } = await seedTrip();
    const result = await renderWithTrip(tripId);

    await run(result.current.actions.executeActions, {
      action: 'createGuestGroup',
      data: { name: 'Cousins', personIds: [alice] },
    });
    const [group] = await db.guestGroups.toArray();
    expect(group?.members.map((member) => member.name)).toEqual(['Alice']);

    await run(result.current.actions.executeActions, {
      action: 'updateGuestGroup',
      data: { groupId: group!.id, name: 'The cousins', addPersonIds: [bob] },
    });
    await expect(db.guestGroups.get(group!.id)).resolves.toMatchObject({
      name: 'The cousins',
      members: [expect.objectContaining({ name: 'Alice' }), expect.objectContaining({ name: 'Bob' })],
    });

    expect(DESTRUCTIVE_ACTIONS.has('removeGuestGroup')).toBe(true);
    await run(result.current.actions.executeActions, {
      action: 'removeGuestGroup',
      data: { groupId: group!.id },
    });
    await expect(db.guestGroups.get(group!.id)).resolves.toBeUndefined();
  });

  it('takes a member out of a group', async () => {
    const { tripId } = await seedTrip();
    const group = await createGuestGroup({
      name: 'Family',
      members: [
        { name: 'Tom', color: hexColor('#ef4444') },
        { name: 'Léa', color: hexColor('#3b82f6') },
      ],
    });
    const result = await renderWithTrip(tripId);

    await run(result.current.actions.executeActions, {
      action: 'updateGuestGroup',
      data: { groupId: group.id, removeMemberIds: [group.members[0]!.id] },
    });

    const stored = await db.guestGroups.get(group.id);
    expect(stored?.members.map((member) => member.name)).toEqual(['Léa']);
  });
});

// ============================================================================
// Rooms and assignments
// ============================================================================

describe('useTripActions: rooms and assignments', () => {
  it('edits a room and copies it', async () => {
    const { tripId } = await seedTrip();
    const room = await createRoom(tripId, { name: 'Attic', capacity: 2 });
    const result = await renderWithTrip(tripId);

    await run(result.current.actions.executeActions, {
      action: 'updateRoom',
      data: { roomId: room.id, name: 'Loft', capacity: 3, icon: 'bunk-bed' },
    });
    await expect(db.rooms.get(room.id)).resolves.toMatchObject({
      name: 'Loft',
      capacity: 3,
      icon: 'bunk-bed',
    });

    const copied = await run(result.current.actions.executeActions, {
      action: 'duplicateRoom',
      data: { roomId: room.id },
    });
    expect(copied.count).toBe(1);
    await expect(db.rooms.where('tripId').equals(tripId).count()).resolves.toBe(2);
  });

  it('refuses a room with no bed', async () => {
    const { tripId } = await seedTrip();
    const room = await createRoom(tripId, { name: 'Attic', capacity: 2 });
    const result = await renderWithTrip(tripId);

    const outcome = await run(result.current.actions.executeActions, {
      action: 'updateRoom',
      data: { roomId: room.id, capacity: 0 },
    });

    expect(outcome.count).toBe(0);
    await expect(db.rooms.get(room.id)).resolves.toMatchObject({ capacity: 2 });
  });

  it('moves an assignment to another room and other nights', async () => {
    const { tripId, alice } = await seedTrip();
    const attic = await createRoom(tripId, { name: 'Attic', capacity: 2 });
    const barn = await createRoom(tripId, { name: 'Barn', capacity: 2 });
    const assignment = await createAssignment(tripId, {
      personId: alice,
      roomId: attic.id,
      startDate: isoDate('2024-07-16'),
      endDate: isoDate('2024-07-18'),
    });
    const result = await renderWithTrip(tripId);

    await run(result.current.actions.executeActions, {
      action: 'updateAssignment',
      data: { assignmentId: assignment.id, roomId: barn.id, endDate: '2024-07-20' },
    });

    await expect(db.roomAssignments.get(assignment.id)).resolves.toMatchObject({
      roomId: barn.id,
      startDate: '2024-07-16',
      endDate: '2024-07-20',
    });
  });

  it('refuses a move onto nights the guest already sleeps somewhere', async () => {
    const { tripId, alice } = await seedTrip();
    const attic = await createRoom(tripId, { name: 'Attic', capacity: 2 });
    const first = await createAssignment(tripId, {
      personId: alice,
      roomId: attic.id,
      startDate: isoDate('2024-07-16'),
      endDate: isoDate('2024-07-18'),
    });
    await createAssignment(tripId, {
      personId: alice,
      roomId: attic.id,
      startDate: isoDate('2024-07-20'),
      endDate: isoDate('2024-07-22'),
    });
    const result = await renderWithTrip(tripId);

    const outcome = await run(result.current.actions.executeActions, {
      action: 'updateAssignment',
      data: { assignmentId: first.id, endDate: '2024-07-21' },
    });

    expect(outcome.count).toBe(0);
    await expect(db.roomAssignments.get(first.id)).resolves.toMatchObject({
      endDate: '2024-07-18',
    });
  });
});

// ============================================================================
// Transport and cars
// ============================================================================

describe('useTripActions: legs and cars', () => {
  it('edits a leg, and the train fields reach every guest on it', async () => {
    const { tripId, alice, bob } = await seedTrip();
    const leg = await createTransport(tripId, {
      personId: alice,
      type: 'arrival',
      datetime: localInstant('2024-07-16', '10:00'),
      location: 'Gare de Lyon',
      needsPickup: false,
    });
    await createSharedTransports(tripId, sameTrain(leg.id), [bob]);
    const result = await renderWithTrip(tripId);

    await run(result.current.actions.executeActions, {
      action: 'updateTransport',
      data: { transportId: leg.id, transportNumber: 'TGV 6201', notes: 'Coach 4' },
    });

    const legs = await db.transports.where('tripId').equals(tripId).toArray();
    expect(legs).toHaveLength(2);
    for (const each of legs) {
      expect(each.transportNumber).toBe('TGV 6201');
    }
  });

  it('takes a guest off a shared train and keeps their leg', async () => {
    const { tripId, alice, bob } = await seedTrip();
    const leg = await createTransport(tripId, {
      personId: alice,
      type: 'arrival',
      datetime: localInstant('2024-07-16', '10:00'),
      location: 'Gare de Lyon',
      needsPickup: false,
    });
    await createSharedTransports(tripId, sameTrain(leg.id), [bob]);
    const bobLeg = (await db.transports.where('tripId').equals(tripId).toArray()).find(
      (each) => each.personId === bob,
    );
    expect(bobLeg?.sharedLegId).toBe(leg.id);
    const result = await renderWithTrip(tripId);

    await run(result.current.actions.executeActions, {
      action: 'leaveTransport',
      data: { transportId: bobLeg!.id },
    });

    const after = await db.transports.get(bobLeg!.id);
    expect(after).toBeDefined();
    expect(after?.sharedLegId).toBeUndefined();
  });

  it('edits a car and keeps what the edit did not name', async () => {
    const { tripId, bob } = await seedTrip();
    const car = await createVehicle(tripId, { name: 'Espace', seatCount: 7, notes: 'Automatic' });
    const result = await renderWithTrip(tripId);

    await run(result.current.actions.executeActions, {
      action: 'updateVehicle',
      data: { vehicleId: car.id, seatCount: 5, ownerId: bob },
    });

    await expect(db.vehicles.get(car.id)).resolves.toMatchObject({
      name: 'Espace',
      seatCount: 5,
      ownerId: bob,
      notes: 'Automatic',
    });
  });
});

// ============================================================================
// Money and shopping
// ============================================================================

describe('useTripActions: money and shopping', () => {
  it('changes the category and the note of a line', async () => {
    const { tripId, alice } = await seedTrip();
    const result = await renderWithTrip(tripId);
    await run(result.current.actions.executeActions, {
      action: 'addExpense',
      data: { title: 'Market', amount: 40, payerId: alice, description: 'Saturday' },
    });
    const [line] = await db.expenses.where('tripId').equals(tripId).toArray();
    expect(line?.description).toBe('Saturday');

    await run(result.current.actions.executeActions, {
      action: 'updateExpense',
      data: { expenseId: line!.id, category: 'meal', description: 'Sunday' },
    });

    await expect(db.expenses.get(line!.id)).resolves.toMatchObject({
      category: 'meal',
      description: 'Sunday',
    });
  });

  it('puts a bought item back on the list, gives it a buyer, and clears bought items', async () => {
    const { tripId, bob } = await seedTrip();
    const bread = await createShoppingItem(tripId, { name: 'Bread', checked: true });
    await createShoppingItem(tripId, { name: 'Milk', checked: true });
    const result = await renderWithTrip(tripId);

    await run(result.current.actions.executeActions, {
      action: 'updateShoppingItem',
      data: { itemId: bread.id, checked: false, buyerId: bob, quantity: '2' },
    });
    await expect(db.shoppingItems.get(bread.id)).resolves.toMatchObject({
      checked: false,
      buyerId: bob,
      quantity: '2',
    });

    expect(DESTRUCTIVE_ACTIONS.has('clearBoughtItems')).toBe(true);
    const cleared = await run(result.current.actions.executeActions, {
      action: 'clearBoughtItems',
      data: {},
    });
    expect(cleared.count).toBe(1);
    const left = await db.shoppingItems.where('tripId').equals(tripId).toArray();
    expect(left.map((item) => item.name)).toEqual(['Bread']);
  });
});
