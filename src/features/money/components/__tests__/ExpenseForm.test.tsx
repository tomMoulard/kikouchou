/**
 * @fileoverview Tests for the expense form.
 *
 * The arithmetic itself is pinned in `lib/__tests__`; what matters here is that
 * the form hands the arithmetic the line the person actually typed, and refuses
 * a line it could not divide.
 *
 * @module features/money/components/__tests__/ExpenseForm.test
 */

import { describe, expect, it, vi } from 'vitest';

import { ExpenseForm } from '@/features/money/components/ExpenseForm';
import { render, screen, waitFor } from '@/test/utils';
import type { Expense, ExpenseId, Person, PersonId, TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP = 'trip-a' as TripId;
const ALICE = 'alice' as PersonId;
const BOB = 'bob' as PersonId;

const PERSONS: Person[] = [
  { id: ALICE, tripId: TRIP, name: 'Alice', color: '#ef4444' },
  { id: BOB, tripId: TRIP, name: 'Bob', color: '#3b82f6' },
] as unknown as Person[];

const NIGHTS = new Map<PersonId, number>([
  [ALICE, 6],
  [BOB, 2],
]);

function existing(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'e1' as ExpenseId,
    tripId: TRIP,
    kind: 'expense',
    category: 'groceries',
    title: 'Saturday shopping',
    date: '2026-07-16',
    amount: 100,
    payerId: ALICE,
    splitMode: 'equal',
    splits: [
      { personId: ALICE, value: 1 },
      { personId: BOB, value: 1 },
    ],
    ...overrides,
  } as Expense;
}

function renderForm(props: Partial<Parameters<typeof ExpenseForm>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();

  const result = render(
    <ExpenseForm
      persons={PERSONS}
      personNights={NIGHTS}
      defaultDate={'2026-07-16' as never}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />,
    { withProviders: false },
  );

  return { ...result, onSubmit, onCancel };
}

// ============================================================================
// Tests
// ============================================================================

describe('ExpenseForm', () => {
  it('starts a new line for every guest, which is what "we split it" means', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/money.expense.title_field/), 'Shopping');
    await user.type(screen.getByLabelText(/money.expense.amount/), '100');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      title: 'Shopping',
      amount: 100,
      splitMode: 'equal',
      splits: [
        { personId: ALICE, value: 1 },
        { personId: BOB, value: 1 },
      ],
    });
  });

  it('shows what each guest owes while the line is typed', async () => {
    const { user } = renderForm();

    await user.type(screen.getByLabelText(/money.expense.amount/), '100');

    // Two guests, equally: 50.00 each, and the preview says so before saving.
    await waitFor(() => {
      expect(screen.getAllByText('50.00').length).toBe(2);
    });
  });

  it('refuses a line nobody benefited from', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/money.expense.title_field/), 'Shopping');
    await user.type(screen.getByLabelText(/money.expense.amount/), '100');
    await user.click(screen.getByRole('button', { name: 'money.expense.nobody' }));
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(
      await screen.findByText('money.expense.errors.beneficiaryRequired'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses an amount of zero', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/money.expense.title_field/), 'Shopping');
    await user.type(screen.getByLabelText(/money.expense.amount/), '0');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(
      await screen.findByText('money.expense.errors.amountAboveZero'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses typed amounts that do not add up to the total', async () => {
    const { user, onSubmit } = renderForm({
      expense: existing({ splitMode: 'amounts', splits: [{ personId: ALICE, value: 30 }] }),
    });

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(
      await screen.findByText('money.expense.errors.amountsDoNotAddUp'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the parts a share split was given', async () => {
    const { user, onSubmit } = renderForm({
      expense: existing({
        splitMode: 'shares',
        splits: [
          { personId: ALICE, value: 1 },
          { personId: BOB, value: 5 },
        ],
      }),
    });

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      splitMode: 'shares',
      splits: [
        { personId: ALICE, value: 1 },
        { personId: BOB, value: 5 },
      ],
    });
  });

  it('writes a transfer as the single share it is', async () => {
    const { user, onSubmit } = renderForm({
      expense: existing({
        kind: 'transfer',
        amount: 50,
        payerId: BOB,
        splits: [{ personId: ALICE, value: 50 }],
      }),
    });

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      kind: 'transfer',
      payerId: BOB,
      splits: [{ personId: ALICE, value: 50 }],
    });
  });

  it('refuses a transfer to the guest who paid it', async () => {
    const { user, onSubmit } = renderForm({
      expense: existing({
        kind: 'transfer',
        amount: 50,
        payerId: ALICE,
        splits: [{ personId: ALICE, value: 50 }],
      }),
    });

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(
      await screen.findByText('money.expense.errors.recipientIsPayer'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a night split when none of the guests slept a night', async () => {
    const { user, onSubmit } = renderForm({
      expense: existing({
        splitMode: 'nights',
        splits: [{ personId: 'ghost' as PersonId, value: 1 }],
      }),
      persons: [
        ...PERSONS,
        { id: 'ghost' as PersonId, tripId: TRIP, name: 'Ghost', color: '#000000' },
      ] as unknown as Person[],
    });

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(
      await screen.findByText('money.expense.errors.noNightsToSplitBy'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
