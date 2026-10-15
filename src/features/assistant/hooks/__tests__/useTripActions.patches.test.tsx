/**
 * useTripActions — patches the executor will not apply.
 *
 * An edit from the model arrives as a partial record, and the executor merges
 * it onto what is already stored before validating the whole thing. That is the
 * guard under test here: a patch that would leave a ride or a line in a state
 * the form itself would reject is refused outright rather than written and
 * repaired later. The no-op patches are covered beside them, because "nothing
 * to change" must not count as an action performed.
 *
 * @module features/assistant/hooks/__tests__/useTripActions.patches.test
 */

import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { AppProviders } from '@/contexts/AppProviders';
import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { createExpense } from '@/lib/db/repositories/expense-repository';
import { createPerson } from '@/lib/db/repositories/person-repository';
import { createRide } from '@/lib/db/repositories/ride-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { hexColor, isoDate, localInstant, waitForTripDoc } from '@/test/utils';
import type { ExpenseId, PersonId, RideId, TripId } from '@/types';

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

interface Seeded {
  tripId: TripId;
  personId: PersonId;
  rideId: RideId;
  expenseId: ExpenseId;
}

async function seedTrip(): Promise<Seeded> {
  const trip = await createTrip({
    name: 'Test Trip',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-30'),
  });
  const person = await createPerson(trip.id, { name: 'Alice', color: hexColor('#ef4444') });
  const ride = await createRide(trip.id, {
    direction: 'pickup',
    meetDatetime: localInstant('2024-07-16', '10:00'),
    location: 'Gare de Lyon',
  });
  const expense = await createExpense(trip.id, {
    kind: 'expense',
    category: 'groceries',
    title: 'Saturday shopping',
    date: isoDate('2024-07-16'),
    amount: 100,
    payerId: person.id,
    splitMode: 'equal',
    splits: [{ personId: person.id, value: 1 }],
  });

  return {
    tripId: trip.id,
    personId: person.id,
    rideId: ride.id,
    expenseId: expense.id,
  };
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

let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  consoleWarn.mockRestore();
});

// ============================================================================
// Tests
// ============================================================================

describe('useTripActions — patches that change nothing', () => {
  it('does not count a ride patch with nothing in it', async () => {
    const { tripId, rideId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'updateRide', data: { rideId } }),
    );

    expect(outcome.count).toBe(0);
    await expect(db.rides.get(rideId)).resolves.toMatchObject({ location: 'Gare de Lyon' });
  });

  it('does not count an activity patch with nothing in it', async () => {
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'updateActivity', data: { activityId: 'whatever' } }),
    );

    expect(outcome.count).toBe(0);
  });
});

describe('useTripActions — patches the validator refuses', () => {
  it('refuses a ride whose new meeting time cannot be read', async () => {
    const { tripId, rideId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'updateRide', data: { rideId, meetDatetime: 'next tuesday' } }),
    );

    expect(outcome.count).toBe(0);
    await expect(db.rides.get(rideId)).resolves.toMatchObject({ location: 'Gare de Lyon' });
  });

  it('refuses a ride patch that would leave the record invalid', async () => {
    const { tripId, rideId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'updateRide', data: { rideId, leadTimeMinutes: 99999 } }),
    );

    expect(outcome.count).toBe(0);
    const ride = await db.rides.get(rideId);
    expect(ride?.leadTimeMinutes).not.toBe(99999);
  });

  it('refuses a line whose new amount is not a number the form would take', async () => {
    const { tripId, expenseId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({ action: 'updateExpense', data: { expenseId, amount: 0 } }),
    );

    expect(outcome.count).toBe(0);
    await expect(db.expenses.get(expenseId)).resolves.toMatchObject({ amount: 100 });
  });

  it('refuses a line moved to a payer who is not on the trip', async () => {
    const { tripId, expenseId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'updateExpense',
        data: { expenseId, payerId: 'no-such-guest' },
      }),
    );

    expect(outcome.count).toBe(0);
    await expect(db.expenses.get(expenseId)).resolves.toMatchObject({ amount: 100 });
  });

  it('re-divides a line when only the parts are given', async () => {
    const { tripId, personId, expenseId } = await seedTrip();
    const bob = await createPerson(tripId, { name: 'Bob', color: hexColor('#3b82f6') });
    await db.expenses.update(expenseId, {
      splitMode: 'shares',
      splits: [
        { personId, value: 1 },
        { personId: bob.id, value: 1 },
      ],
    });

    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      // No beneficiaries named: the parts apply to the guests already on it.
      actionBlock({ action: 'updateExpense', data: { expenseId, shares: ['3', '1'] } }),
    );

    expect(outcome.count).toBe(1);
    const updated = await db.expenses.get(expenseId);
    expect(updated?.splits.map((split) => split.value)).toEqual([3, 1]);
  });
});

describe('useTripActions — references it drops rather than refusing', () => {
  it('adds the car and says the owner was not found', async () => {
    const { tripId } = await seedTrip();
    const result = await renderWithTrip(tripId);

    const outcome = await run(
      result.current.actions.executeActions,
      actionBlock({
        action: 'addVehicle',
        data: { name: 'The van', ownerId: 'no-such-guest' },
      }),
    );

    // The car is worth having even without the owner the model invented.
    expect(outcome.count).toBe(1);
    const vehicles = await db.vehicles.where('tripId').equals(tripId).toArray();
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]?.ownerId).toBeUndefined();
  });
});
