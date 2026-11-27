/**
 * @fileoverview Tests for ExpenseCard, rendered through the real bundles.
 *
 * A tester read "2026-11-27" on a line of the money page: the row printed the
 * stored day key as it is. These tests render the row in both languages and
 * check that the day reads as a day.
 *
 * @module features/money/components/__tests__/ExpenseCard.test
 */

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithRealI18n } from '@/test/utils';

import { ExpenseCard } from '@/features/money/components/ExpenseCard';
import type { Expense, ExpenseId, Person, PersonId, TripId } from '@/types';

vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

const marie: Person = {
  id: 'p1' as PersonId,
  tripId: TRIP_ID,
  name: 'Marie',
  color: '#3b82f6' as Person['color'],
};

const PERSONS = new Map<PersonId, Person>([[marie.id, marie]]);

function line(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1' as ExpenseId,
    tripId: TRIP_ID,
    kind: 'expense',
    category: 'groceries',
    title: 'Courses',
    date: '2026-11-27',
    amount: 84.2,
    payerId: marie.id,
    splitMode: 'equal',
    splits: [{ personId: marie.id, value: 1 }],
    ...overrides,
  } as Expense;
}

// ============================================================================
// Tests
// ============================================================================

describe('ExpenseCard', () => {
  it('prints the day in French words, not the stored key', async () => {
    await renderWithRealI18n(
      <ExpenseCard expense={line()} personsMap={PERSONS} currency="EUR" onOpen={vi.fn()} />,
      { language: 'fr', withProviders: false },
    );

    expect(screen.getByText('ven. 27 nov.')).toBeInTheDocument();
    expect(screen.queryByText('2026-11-27')).not.toBeInTheDocument();
  });

  it('prints the day in English words under the English bundle', async () => {
    await renderWithRealI18n(
      <ExpenseCard expense={line()} personsMap={PERSONS} currency="EUR" onOpen={vi.fn()} />,
      { language: 'en', withProviders: false },
    );

    expect(screen.getByText('Fri 27 Nov')).toBeInTheDocument();
  });

  it('falls back to the stored text when the day cannot be read', async () => {
    await renderWithRealI18n(
      <ExpenseCard
        expense={line({ date: 'someday' as Expense['date'] })}
        personsMap={PERSONS}
        currency="EUR"
        onOpen={vi.fn()}
      />,
      { language: 'fr', withProviders: false },
    );

    expect(screen.getByText('someday')).toBeInTheDocument();
  });
});
