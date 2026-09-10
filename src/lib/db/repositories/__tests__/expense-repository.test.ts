/**
 * Integration tests for the Expense Repository
 *
 * Covers CRUD, ownership validation, the sanitising the write path applies, and
 * what happens to a trip's accounts when a guest or the trip itself is deleted.
 *
 * @module lib/db/repositories/__tests__/expense-repository.test
 */
import { describe, expect, it } from 'vitest';

import { db } from '@/lib/db/database';
import {
  createExpense,
  deleteExpenseWithOwnershipCheck,
  getExpenseById,
  getExpenseCount,
  getExpensesByPayerId,
  getExpensesByTripId,
  updateExpenseWithOwnershipCheck,
} from '@/lib/db/repositories/expense-repository';
import { createPerson, deletePerson } from '@/lib/db/repositories/person-repository';
import { createTrip, deleteTrip } from '@/lib/db/repositories/trip-repository';
import { hexColor, isoDate } from '@/test/utils';
import { MAX_EXPENSE_AMOUNT } from '@/types';
import type { ExpenseFormData, ExpenseId, PersonId, TripId } from '@/types';

// ============================================================================
// Test Data Factories
// ============================================================================

async function createTestTrip(name = 'Test Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: isoDate('2026-07-15'),
    endDate: isoDate('2026-07-22'),
  });
  return trip.id;
}

async function createTestPerson(tripId: TripId, name = 'Marie'): Promise<PersonId> {
  const person = await createPerson(tripId, { name, color: hexColor('#ef4444') });
  return person.id;
}

function expenseData(
  payerId: PersonId,
  overrides: Partial<ExpenseFormData> = {},
): ExpenseFormData {
  return {
    kind: 'expense',
    category: 'groceries',
    title: 'Courses du samedi',
    date: isoDate('2026-07-16'),
    amount: 84.2,
    payerId,
    splitMode: 'equal',
    splits: [{ personId: payerId, value: 1 }],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('expense-repository', () => {
  describe('createExpense', () => {
    it('creates a line scoped to the trip', async () => {
      const tripId = await createTestTrip();
      const payerId = await createTestPerson(tripId);

      const expense = await createExpense(tripId, expenseData(payerId));

      expect(expense.id).toBeTruthy();
      expect(expense.tripId).toBe(tripId);
      expect(expense.amount).toBe(84.2);
      expect(expense.splits).toEqual([{ personId: payerId, value: 1 }]);
    });

    it('trims the text and drops an empty description', async () => {
      const tripId = await createTestTrip();
      const payerId = await createTestPerson(tripId);

      const expense = await createExpense(
        tripId,
        expenseData(payerId, { title: '  Courses  ', description: '   ' }),
      );

      expect(expense.title).toBe('Courses');
      expect(expense.description).toBeUndefined();
    });

    it('bounds an amount above the maximum', async () => {
      const tripId = await createTestTrip();
      const payerId = await createTestPerson(tripId);

      const expense = await createExpense(
        tripId,
        expenseData(payerId, { amount: MAX_EXPENSE_AMOUNT * 10 }),
      );

      expect(expense.amount).toBe(MAX_EXPENSE_AMOUNT);
    });

    it('reads a negative amount as zero, because the sign lives in the kind', async () => {
      const tripId = await createTestTrip();
      const payerId = await createTestPerson(tripId);

      const expense = await createExpense(
        tripId,
        expenseData(payerId, { amount: -40 }),
      );

      expect(expense.amount).toBe(0);
    });

    it('keeps one share per guest, the last one typed', async () => {
      const tripId = await createTestTrip();
      const payerId = await createTestPerson(tripId);

      const expense = await createExpense(
        tripId,
        expenseData(payerId, {
          splitMode: 'shares',
          splits: [
            { personId: payerId, value: 1 },
            { personId: payerId, value: 4 },
          ],
        }),
      );

      expect(expense.splits).toEqual([{ personId: payerId, value: 4 }]);
    });

    it('copies the split list rather than keeping the array it was given', async () => {
      const tripId = await createTestTrip();
      const payerId = await createTestPerson(tripId);
      const splits = [{ personId: payerId, value: 1 }];

      const expense = await createExpense(tripId, expenseData(payerId, { splits }));
      splits.push({ personId: 'someone-else' as PersonId, value: 1 });

      const stored = await getExpenseById(expense.id);
      expect(stored?.splits).toHaveLength(1);
    });
  });

  describe('reads', () => {
    it('lists the lines of a trip oldest day first', async () => {
      const tripId = await createTestTrip();
      const payerId = await createTestPerson(tripId);

      await createExpense(
        tripId,
        expenseData(payerId, { title: 'Later', date: isoDate('2026-07-18') }),
      );
      await createExpense(
        tripId,
        expenseData(payerId, { title: 'Earlier', date: isoDate('2026-07-16') }),
      );

      const expenses = await getExpensesByTripId(tripId);

      expect(expenses.map((expense) => expense.title)).toEqual(['Earlier', 'Later']);
    });

    it('never returns the lines of another trip', async () => {
      const tripA = await createTestTrip('A');
      const tripB = await createTestTrip('B');
      const payerA = await createTestPerson(tripA);
      const payerB = await createTestPerson(tripB);

      await createExpense(tripA, expenseData(payerA, { title: 'Mine' }));
      await createExpense(tripB, expenseData(payerB, { title: 'Theirs' }));

      const expenses = await getExpensesByTripId(tripA);

      expect(expenses.map((expense) => expense.title)).toEqual(['Mine']);
      expect(await getExpenseCount(tripA)).toBe(1);
    });

    it('finds every line one guest paid', async () => {
      const tripId = await createTestTrip();
      const marie = await createTestPerson(tripId, 'Marie');
      const paul = await createTestPerson(tripId, 'Paul');

      await createExpense(tripId, expenseData(marie, { title: 'Hers' }));
      await createExpense(tripId, expenseData(paul, { title: 'His' }));

      const paid = await getExpensesByPayerId(marie);

      expect(paid.map((expense) => expense.title)).toEqual(['Hers']);
    });
  });

  describe('updateExpenseWithOwnershipCheck', () => {
    it('changes only the fields it is given', async () => {
      const tripId = await createTestTrip();
      const payerId = await createTestPerson(tripId);
      const expense = await createExpense(
        tripId,
        expenseData(payerId, { description: 'Two trolleys' }),
      );

      await updateExpenseWithOwnershipCheck(expense.id, tripId, { amount: 90 });

      const stored = await getExpenseById(expense.id);
      expect(stored?.amount).toBe(90);
      expect(stored?.description).toBe('Two trolleys');
      expect(stored?.title).toBe('Courses du samedi');
    });

    it('sanitises what it is given', async () => {
      const tripId = await createTestTrip();
      const payerId = await createTestPerson(tripId);
      const expense = await createExpense(tripId, expenseData(payerId));

      await updateExpenseWithOwnershipCheck(expense.id, tripId, {
        title: '  Marché  ',
        amount: MAX_EXPENSE_AMOUNT * 2,
      });

      const stored = await getExpenseById(expense.id);
      expect(stored?.title).toBe('Marché');
      expect(stored?.amount).toBe(MAX_EXPENSE_AMOUNT);
    });

    it('refuses a line belonging to another trip', async () => {
      const tripA = await createTestTrip('A');
      const tripB = await createTestTrip('B');
      const payerId = await createTestPerson(tripA);
      const expense = await createExpense(tripA, expenseData(payerId));

      await expect(
        updateExpenseWithOwnershipCheck(expense.id, tripB, { amount: 1 }),
      ).rejects.toThrow(/does not belong/);
    });

    it('refuses a line that does not exist', async () => {
      const tripId = await createTestTrip();

      await expect(
        updateExpenseWithOwnershipCheck('nope' as ExpenseId, tripId, { amount: 1 }),
      ).rejects.toThrow(/not found/);
    });
  });

  describe('deleteExpenseWithOwnershipCheck', () => {
    it('deletes the line', async () => {
      const tripId = await createTestTrip();
      const payerId = await createTestPerson(tripId);
      const expense = await createExpense(tripId, expenseData(payerId));

      await deleteExpenseWithOwnershipCheck(expense.id, tripId);

      expect(await getExpenseById(expense.id)).toBeUndefined();
    });

    it('refuses a line belonging to another trip', async () => {
      const tripA = await createTestTrip('A');
      const tripB = await createTestTrip('B');
      const payerId = await createTestPerson(tripA);
      const expense = await createExpense(tripA, expenseData(payerId));

      await expect(
        deleteExpenseWithOwnershipCheck(expense.id, tripB),
      ).rejects.toThrow(/does not belong/);
      expect(await getExpenseById(expense.id)).toBeDefined();
    });
  });

  describe('cascades', () => {
    it('deletes the lines a departing guest paid', async () => {
      const tripId = await createTestTrip();
      const marie = await createTestPerson(tripId, 'Marie');
      const paul = await createTestPerson(tripId, 'Paul');

      const hers = await createExpense(tripId, expenseData(marie, { title: 'Hers' }));
      const his = await createExpense(tripId, expenseData(paul, { title: 'His' }));

      await deletePerson(marie);

      expect(await getExpenseById(hers.id)).toBeUndefined();
      expect(await getExpenseById(his.id)).toBeDefined();
    });

    it('drops a departing guest from the lines they only benefited from', async () => {
      const tripId = await createTestTrip();
      const marie = await createTestPerson(tripId, 'Marie');
      const paul = await createTestPerson(tripId, 'Paul');

      const shared = await createExpense(
        tripId,
        expenseData(paul, {
          splits: [
            { personId: paul, value: 1 },
            { personId: marie, value: 1 },
          ],
        }),
      );

      await deletePerson(marie);

      const stored = await getExpenseById(shared.id);
      expect(stored?.splits).toEqual([{ personId: paul, value: 1 }]);
    });

    it('deletes the lines of a trip with the trip', async () => {
      const tripId = await createTestTrip();
      const payerId = await createTestPerson(tripId);
      await createExpense(tripId, expenseData(payerId));

      await deleteTrip(tripId);

      expect(await db.expenses.where('tripId').equals(tripId).count()).toBe(0);
    });
  });
});
