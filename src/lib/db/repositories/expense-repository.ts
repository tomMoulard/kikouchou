/**
 * Expense Repository
 *
 * Provides CRUD operations for Expense entities — the trip's money lines.
 * All operations use the Dexie.js database and branded types for type safety.
 *
 * @module lib/db/repositories/expense-repository
 */

import { db } from '@/lib/db/database';
import { sanitizeExpenseData } from '@/lib/db/sanitize';
import { createExpenseId } from '@/lib/db/utils';
import type {
  Expense,
  ExpenseFormData,
  ExpenseId,
  PersonId,
  TripId,
} from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Upper bound for a string component of a compound index range.
 * Matches the bound the other trip reads use, so the ranges select the same rows.
 */
const MAX_STRING_KEY = '￿';

// ============================================================================
// Create
// ============================================================================

/**
 * Creates a new money line in the database.
 *
 * @param tripId - The trip this line belongs to
 * @param data - The expense form data
 * @returns The created Expense object
 *
 * @example
 * ```typescript
 * const expense = await createExpense(tripId, {
 *   kind: 'expense',
 *   category: 'groceries',
 *   title: 'Courses du samedi',
 *   date: '2024-07-16' as ISODateString,
 *   amount: 84.2,
 *   payerId,
 *   splitMode: 'equal',
 *   splits: [{ personId, value: 1 }],
 * });
 * ```
 */
export async function createExpense(
  tripId: TripId,
  data: ExpenseFormData,
): Promise<Expense> {
  const sanitizedData = sanitizeExpenseData(data);

  try {
    const expense: Expense = {
      id: createExpenseId(),
      tripId,
      ...sanitizedData,
      splits: [...sanitizedData.splits],
    };

    await db.expenses.add(expense);
    return expense;
  } catch (error) {
    throw new Error(
      `Failed to create expense "${sanitizedData.title}" for trip ${tripId}`,
      { cause: error },
    );
  }
}

// ============================================================================
// Read
// ============================================================================

/**
 * Retrieves every money line of a trip, oldest day first.
 *
 * Uses the compound index [tripId+date] for efficient querying.
 *
 * @param tripId - The trip ID to filter by
 * @returns Array of expenses sorted by date ascending
 */
export async function getExpensesByTripId(tripId: TripId): Promise<Expense[]> {
  return db.expenses
    .where('[tripId+date]')
    .between([tripId, ''], [tripId, MAX_STRING_KEY])
    .toArray();
}

/**
 * Retrieves one money line by its unique ID.
 *
 * @param id - The expense's unique identifier
 * @returns The expense if found, undefined otherwise
 */
export async function getExpenseById(
  id: ExpenseId,
): Promise<Expense | undefined> {
  return db.expenses.get(id);
}

/**
 * Retrieves every line one guest paid, oldest day first.
 *
 * @param payerId - The guest who put the money in
 * @returns Array of expenses that guest paid
 */
export async function getExpensesByPayerId(
  payerId: PersonId,
): Promise<Expense[]> {
  const expenses = await db.expenses.where('payerId').equals(payerId).toArray();

  return expenses.sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Counts the money lines of a trip.
 *
 * @param tripId - The trip ID to count lines for
 * @returns Number of expenses in the trip
 */
export async function getExpenseCount(tripId: TripId): Promise<number> {
  return db.expenses.where('tripId').equals(tripId).count();
}

// ============================================================================
// Transactional Operations with Ownership Validation
// ============================================================================

/**
 * Updates a money line with ownership validation in a single transaction.
 * Prevents a TOCTOU race by combining validation and mutation atomically.
 *
 * @param id - The expense's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @param data - Partial expense form data to update
 * @throws {Error} If the expense is not found or belongs to another trip
 *
 * @example
 * ```typescript
 * await updateExpenseWithOwnershipCheck(expenseId, currentTripId, { amount: 90 });
 * ```
 */
export async function updateExpenseWithOwnershipCheck(
  id: ExpenseId,
  tripId: TripId,
  data: Partial<ExpenseFormData>,
): Promise<void> {
  const sanitizedData = sanitizeExpensePartial(data);

  await db.transaction('rw', db.expenses, async () => {
    const expense = await db.expenses.get(id);

    if (!expense) {
      throw new Error(`Expense with ID "${id}" not found`);
    }
    if (expense.tripId !== tripId) {
      throw new Error('Cannot update expense: expense does not belong to current trip');
    }

    await db.expenses.update(id, sanitizedData);
  });
}

/**
 * Deletes a money line with ownership validation in a single transaction.
 *
 * @param id - The expense's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @throws {Error} If the expense is not found or belongs to another trip
 */
export async function deleteExpenseWithOwnershipCheck(
  id: ExpenseId,
  tripId: TripId,
): Promise<void> {
  await db.transaction('rw', db.expenses, async () => {
    const expense = await db.expenses.get(id);

    if (!expense) {
      throw new Error(`Expense with ID "${id}" not found`);
    }
    if (expense.tripId !== tripId) {
      throw new Error('Cannot delete expense: expense does not belong to current trip');
    }

    await db.expenses.delete(id);
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Sanitizes the subset of expense fields present in a partial update.
 * Fields that are absent stay absent so Dexie does not clear them.
 */
function sanitizeExpensePartial(
  data: Partial<ExpenseFormData>,
): Partial<ExpenseFormData> {
  const sanitized = sanitizeExpenseData({
    title: data.title ?? '',
    description: data.description,
    amount: data.amount ?? 0,
    splits: data.splits,
  });

  const next: Partial<ExpenseFormData> = { ...data };

  if (data.title !== undefined) {
    next.title = sanitized.title;
  }
  if (data.description !== undefined) {
    next.description = sanitized.description;
  }
  if (data.amount !== undefined) {
    next.amount = sanitized.amount;
  }
  if (data.splits !== undefined) {
    next.splits = [...(sanitized.splits ?? [])];
  }

  return next;
}
