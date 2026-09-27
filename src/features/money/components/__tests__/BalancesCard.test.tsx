/**
 * @fileoverview Tests for BalancesCard.
 *
 * The arithmetic has its own file (`lib/__tests__/balances.test.ts`), so these
 * tests run it for real and check what the card makes of the result: the empty
 * state, one row per guest, the settled state, and the payment button that is
 * there only when the trip can be written.
 *
 * @module features/money/components/__tests__/BalancesCard.test
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/test/utils';

import { BalancesCard } from '@/features/money/components/BalancesCard';
import type { Expense, ExpenseId, Person, PersonId, TripId } from '@/types';

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

const paul: Person = {
  id: 'p2' as PersonId,
  tripId: TRIP_ID,
  name: 'Paul',
  color: '#ef4444' as Person['color'],
};

const NO_NIGHTS = new Map<PersonId, number>();

/** Marie pays 100 for herself and Paul, so Paul owes her 50. */
function sharedShopping(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1' as ExpenseId,
    tripId: TRIP_ID,
    kind: 'expense',
    category: 'groceries',
    title: 'Saturday shopping',
    date: '2026-07-02',
    amount: 100,
    payerId: marie.id,
    splitMode: 'equal',
    splits: [
      { personId: marie.id, value: 1 },
      { personId: paul.id, value: 1 },
    ],
    ...overrides,
  } as Expense;
}

// ============================================================================
// Tests
// ============================================================================

describe('BalancesCard', () => {
  it('says the accounts are empty when there is no line', () => {
    render(
      <BalancesCard expenses={[]} persons={[marie]} personNights={NO_NIGHTS} currency="EUR" />,
    );

    expect(screen.getByText('money.balances.empty')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows one row per guest and the payment that levels them', () => {
    render(
      <BalancesCard
        expenses={[sharedShopping()]}
        persons={[marie, paul]}
        personNights={NO_NIGHTS}
        currency="EUR"
      />,
    );

    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Marie' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Paul' })).toBeInTheDocument();

    const payment = screen.getByRole('listitem');
    expect(payment).toHaveTextContent(/Paul.*Marie/);
    expect(payment).toHaveTextContent(/50/);
    expect(screen.queryByText('money.balances.settled')).not.toBeInTheDocument();
  });

  it('records a payment when the trip can be written', async () => {
    const onRecordPayment = vi.fn();
    const { user } = render(
      <BalancesCard
        expenses={[sharedShopping()]}
        persons={[marie, paul]}
        personNights={NO_NIGHTS}
        currency="EUR"
        onRecordPayment={onRecordPayment}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'money.balances.recordPayment' }));

    expect(onRecordPayment).toHaveBeenCalledWith({
      fromPersonId: paul.id,
      toPersonId: marie.id,
      amount: 50,
    });
  });

  it('offers no payment button on a read-only trip', () => {
    render(
      <BalancesCard
        expenses={[sharedShopping()]}
        persons={[marie, paul]}
        personNights={NO_NIGHTS}
        currency="EUR"
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'money.balances.recordPayment' }),
    ).not.toBeInTheDocument();
  });

  it('says the group is settled once a transfer cancels the debt', () => {
    const repayment = sharedShopping({
      id: 'e2' as ExpenseId,
      kind: 'transfer',
      title: 'Paul pays Marie back',
      amount: 50,
      payerId: paul.id,
      splits: [{ personId: marie.id, value: 1 }],
    });

    render(
      <BalancesCard
        expenses={[sharedShopping(), repayment]}
        persons={[marie, paul]}
        personNights={NO_NIGHTS}
        currency="EUR"
      />,
    );

    expect(screen.getByText('money.balances.settled')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('names a guest who is no longer on the trip as unknown', () => {
    render(
      <BalancesCard
        expenses={[sharedShopping()]}
        persons={[marie]}
        personNights={NO_NIGHTS}
        currency="EUR"
      />,
    );

    expect(
      within(screen.getByRole('table')).getByRole('rowheader', {
        name: 'money.expense.unknownGuest',
      }),
    ).toBeInTheDocument();
  });
});
