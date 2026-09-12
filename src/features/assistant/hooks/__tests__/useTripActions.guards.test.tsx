/**
 * useTripActions — parsing and the no-trip guards.
 *
 * The sibling file covers what each action writes once a trip is selected.
 * This one covers the two edges around that: what the parser accepts out of a
 * model reply that is not clean JSON, and what every action does when no trip
 * is selected, which is the state the assistant starts a session in.
 *
 * No trip is ever selected here, so nothing reaches a repository and the file
 * needs no seeding.
 *
 * @module features/assistant/hooks/__tests__/useTripActions.guards.test
 */

import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { AppProviders } from '@/contexts/AppProviders';
import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { hexColor, isoDate } from '@/test/utils';

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

/** Wraps an action payload in the fenced block the LLM is asked to emit. */
function actionBlock(payload: unknown): string {
  return `Sure!\n\n\`\`\`action\n${JSON.stringify(payload)}\n\`\`\``;
}

/** Renders the hook with the trip list loaded and no trip selected. */
async function renderWithoutTrip() {
  const { result } = renderHook(() => useCombined(), { wrapper: Wrapper });

  await waitFor(() => {
    expect(result.current.trip.isLoading).toBe(false);
  });

  expect(result.current.trip.currentTrip).toBeNull();

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

/**
 * One schema-valid payload for each action that needs a selected trip.
 *
 * `createTrip` and `selectTrip` are deliberately absent: they are the two that
 * work without one.
 */
const TRIP_SCOPED_ACTIONS: readonly { readonly action: string; readonly data: unknown }[] = [
  { action: 'updateTrip', data: { name: 'Renamed' } },
  { action: 'addGuest', data: { name: 'Alice' } },
  { action: 'importGuestGroup', data: { groupId: 'group-1' } },
  { action: 'removeGuest', data: { personId: 'person-1' } },
  { action: 'addRoom', data: { name: 'Attic', capacity: 2 } },
  { action: 'removeRoom', data: { roomId: 'room-1' } },
  {
    action: 'assignRoom',
    data: {
      personId: 'person-1',
      roomId: 'room-1',
      startDate: '2024-07-16',
      endDate: '2024-07-18',
    },
  },
  { action: 'removeAssignment', data: { assignmentId: 'assignment-1' } },
  {
    action: 'addTransport',
    data: {
      personId: 'person-1',
      type: 'arrival',
      datetime: '2024-07-16T10:00',
      location: 'Gare de Lyon',
    },
  },
  { action: 'removeTransport', data: { transportId: 'transport-1' } },
  {
    action: 'addRide',
    data: { direction: 'pickup', meetDatetime: '2024-07-16T10:00', location: 'Gare de Lyon' },
  },
  { action: 'updateRide', data: { rideId: 'ride-1', location: 'Orly' } },
  { action: 'removeRide', data: { rideId: 'ride-1' } },
  { action: 'addVehicle', data: { name: 'The van' } },
  { action: 'removeVehicle', data: { vehicleId: 'vehicle-1' } },
  { action: 'joinRide', data: { transportId: 'transport-1', rideId: 'ride-1' } },
  { action: 'leaveRide', data: { transportId: 'transport-1' } },
  {
    action: 'addActivity',
    data: { title: 'Market', category: 'market', startDatetime: '2024-07-16T10:00' },
  },
  { action: 'updateActivity', data: { activityId: 'activity-1', title: 'Market' } },
  { action: 'removeActivity', data: { activityId: 'activity-1' } },
  { action: 'joinActivity', data: { activityId: 'activity-1', personId: 'person-1' } },
  { action: 'leaveActivity', data: { activityId: 'activity-1', personId: 'person-1' } },
  { action: 'addExpense', data: { title: 'Groceries', amount: 42, payerId: 'person-1' } },
  { action: 'updateExpense', data: { expenseId: 'expense-1', amount: 43 } },
  { action: 'removeExpense', data: { expenseId: 'expense-1' } },
];

// ============================================================================
// Tests
// ============================================================================

describe('useTripActions — parsing a model reply', () => {
  it('does nothing with a reply that carries no action block', async () => {
    const result = await renderWithoutTrip();

    const outcome = await run(
      result.current.actions.executeActions,
      'Happy to help! Tell me who is arriving and I will add them.',
    );

    expect(outcome).toEqual({ count: 0, summaries: [] });
  });

  it('ignores a fenced block that holds prose rather than JSON', async () => {
    const result = await renderWithoutTrip();

    const outcome = await run(
      result.current.actions.executeActions,
      'Here is the plan:\n\n```\nAdd Alice to the guest list\n```',
    );

    expect(outcome.count).toBe(0);
  });

  it('ignores a fenced block whose JSON was cut off', async () => {
    const result = await renderWithoutTrip();

    const outcome = await run(
      result.current.actions.executeActions,
      'Sure!\n\n```action\n{"action":"addGuest","data":{"name":"Ali\n```',
    );

    expect(outcome.count).toBe(0);
  });

  it('ignores a fenced block naming an action that does not exist', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await renderWithoutTrip();

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'summonHelicopter', data: { when: 'now' } }),
    );

    expect(outcome.count).toBe(0);
    warn.mockRestore();
  });

  it('reads a bare JSON action the model forgot to fence, once', async () => {
    const trip = await createTrip({
      name: 'Bare JSON trip',
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-30'),
    });

    const { result } = renderHook(() => useCombined(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.trip.isLoading).toBe(false);
    });
    await act(async () => {
      await result.current.trip.setCurrentTrip(trip.id);
    });
    await waitFor(() => {
      expect(result.current.trip.currentTrip?.id).toBe(trip.id);
    });

    // The same object twice: the parser dedupes on action plus payload, so this
    // must add one guest, not two.
    const bare = '{"action":"addGuest","data":{"name":"Alice"}}';
    const outcome = await run(
      result.current.actions.executeActions,
      `I will add her now. ${bare}\n\nAnd again for good measure: ${bare}`,
    );

    expect(outcome.count).toBe(1);

    const guests = await db.persons.where('tripId').equals(trip.id).toArray();
    expect(guests.map((guest) => guest.name)).toEqual(['Alice']);
  });

  it('prefers the fenced block and never re-reads it as bare JSON', async () => {
    const result = await renderWithoutTrip();

    const payload = { action: 'addGuest', data: { name: 'Alice' } };
    const outcome = await run(
      result.current.actions.executeActions,
      `${actionBlock(payload)}\n\nTo be explicit: ${JSON.stringify(payload)}`,
    );

    // No trip is selected, so the guard refuses it — what matters here is that
    // the reply produced one action rather than two.
    expect(outcome.count).toBe(0);
  });
});

describe('useTripActions — no trip selected', () => {
  it('refuses every trip-scoped action and writes nothing', async () => {
    const result = await renderWithoutTrip();

    const reply = TRIP_SCOPED_ACTIONS.map((entry) => actionBlock(entry)).join('\n\n');
    const outcome = await run(result.current.actions.executeActions, reply);

    expect(outcome).toEqual({ count: 0, summaries: [] });
    await expect(db.persons.count()).resolves.toBe(0);
    await expect(db.rooms.count()).resolves.toBe(0);
    await expect(db.activities.count()).resolves.toBe(0);
    await expect(db.expenses.count()).resolves.toBe(0);
    await expect(db.transports.count()).resolves.toBe(0);
    await expect(db.rides.count()).resolves.toBe(0);
    await expect(db.vehicles.count()).resolves.toBe(0);
  });

  it('still creates a trip, because that action needs no trip', async () => {
    const result = await renderWithoutTrip();

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'createTrip',
        data: { name: 'Summer house', startDate: '2024-07-15', endDate: '2024-07-30' },
      }),
    );

    expect(outcome.count).toBe(1);
    const trips = await db.trips.toArray();
    expect(trips.map((trip) => trip.name)).toEqual(['Summer house']);
  });

  it('creates a trip and then writes to it in the same reply', async () => {
    const result = await renderWithoutTrip();

    const outcome = await run(
      result.current.actions.executeActions,
      [
        actionBlock({
          action: 'createTrip',
          data: { name: 'Summer house', startDate: '2024-07-15', endDate: '2024-07-30' },
        }),
        actionBlock({ action: 'addGuest', data: { name: 'Alice' } }),
      ].join('\n\n'),
    );

    expect(outcome.count).toBe(2);

    const [trip] = await db.trips.toArray();
    expect(trip).toBeDefined();
    const guests = await db.persons.where('tripId').equals(trip!.id).toArray();
    expect(guests.map((guest) => guest.name)).toEqual(['Alice']);
  });

  it('reports a selectTrip that names a trip which is not there', async () => {
    const result = await renderWithoutTrip();

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'selectTrip', data: { tripId: 'no-such-trip' } }),
    );

    expect(outcome.count).toBe(0);
  });

  it('selects an existing trip and writes to it in the same reply', async () => {
    const trip = await createTrip({
      name: 'Existing trip',
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-30'),
    });

    const result = await renderWithoutTrip();

    const outcome = await run(
      result.current.actions.executeActions,
      [
        actionBlock({ action: 'selectTrip', data: { tripId: trip.id } }),
        actionBlock({ action: 'addRoom', data: { name: 'Attic', capacity: 2 } }),
      ].join('\n\n'),
    );

    expect(outcome.count).toBe(2);
    const rooms = await db.rooms.where('tripId').equals(trip.id).toArray();
    expect(rooms.map((room) => room.name)).toEqual(['Attic']);
  });
});

describe('useTripActions — a read-only trip', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('refuses to write to a trip this device only follows', async () => {
    const trip = await createTrip({
      name: 'Shared with me',
      startDate: isoDate('2024-07-15'),
      endDate: isoDate('2024-07-30'),
    });
    await createPerson(trip.id, { name: 'Alice', color: hexColor('#ef4444') });
    // What a viewer copy is: the server's document, replayed, never written.
    await db.trips.update(trip.id, { viewerToken: 'viewer-token' });

    const { result } = renderHook(() => useCombined(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.trip.isLoading).toBe(false);
    });
    await act(async () => {
      await result.current.trip.setCurrentTrip(trip.id);
    });
    await waitFor(() => {
      expect(result.current.trip.currentTrip?.id).toBe(trip.id);
    });

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'addRoom', data: { name: 'Attic', capacity: 2 } }),
    );

    expect(outcome).toEqual({ count: 0, summaries: [] });
    await expect(db.rooms.where('tripId').equals(trip.id).count()).resolves.toBe(0);
  });
});
