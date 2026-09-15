/**
 * @fileoverview The expense form's controls and the lines it refuses.
 *
 * The sibling file pins the arithmetic the form hands on. This one covers the
 * controls that change what is being typed — the kind, the date, the payer, the
 * description, and the shortcut that picks everybody — and the five ways the
 * form says no before anything is saved.
 *
 * @module features/money/components/__tests__/ExpenseForm.controls.test
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

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
      currency="EUR"
      defaultDate={'2026-07-16' as never}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />,
    { withProviders: false },
  );

  return { ...result, onSubmit, onCancel };
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= (): boolean => false;
  Element.prototype.setPointerCapture ??= (): void => undefined;
  Element.prototype.releasePointerCapture ??= (): void => undefined;
  Element.prototype.scrollIntoView ??= (): void => undefined;
});

/** Opens a Radix select by its label and picks the option named. */
async function chooseFrom(
  user: ReturnType<typeof render>['user'],
  label: RegExp,
  optionName: RegExp,
): Promise<void> {
  await user.click(screen.getByLabelText(label));
  await user.click(await screen.findByRole('option', { name: optionName }));
}

// ============================================================================
// Tests
// ============================================================================

describe('ExpenseForm — the controls', () => {
  it('records who paid', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/money.expense.title_field/), 'Shopping');
    await user.type(screen.getByLabelText(/money.expense.amount/), '100');
    await chooseFrom(user, /money.expense.paidBy/, /Bob/);
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ payerId: BOB });
  });

  it('records the day it happened', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/money.expense.title_field/), 'Shopping');
    await user.type(screen.getByLabelText(/money.expense.amount/), '100');
    const date = screen.getByLabelText(/money.expense.date/);
    await user.clear(date);
    await user.type(date, '2026-07-18');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ date: '2026-07-18' });
  });

  it('records the free-text note', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/money.expense.title_field/), 'Shopping');
    await user.type(screen.getByLabelText(/money.expense.amount/), '100');
    await user.type(screen.getByLabelText(/money.expense.description/), 'Two trolleys');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ description: 'Two trolleys' });
  });

  it('puts everybody back in with one tap', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/money.expense.title_field/), 'Shopping');
    await user.type(screen.getByLabelText(/money.expense.amount/), '100');

    // Take Bob out, then take the shortcut back.
    await user.click(screen.getByRole('button', { name: /Bob/ }));
    await user.click(screen.getByRole('button', { name: 'money.expense.everyone' }));
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });
    expect(onSubmit.mock.calls[0]?.[0]?.splits).toHaveLength(2);
  });

  it('reports the form as dirty once a beneficiary is dropped', async () => {
    const onDirtyChange = vi.fn();
    const { user } = renderForm({ expense: existing(), onDirtyChange });

    await user.click(screen.getByRole('button', { name: /Bob/ }));

    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenCalledWith(true);
    });
  });
});

describe('ExpenseForm — the lines it refuses', () => {
  it('refuses a line with no title', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/money.expense.amount/), '100');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses an amount larger than the trip could plausibly hold', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/money.expense.title_field/), 'Shopping');
    await user.type(screen.getByLabelText(/money.expense.amount/), '2000000');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a line nobody is on', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/money.expense.title_field/), 'Shopping');
    await user.type(screen.getByLabelText(/money.expense.amount/), '100');
    await user.click(screen.getByRole('button', { name: /Alice/ }));
    await user.click(screen.getByRole('button', { name: /Bob/ }));
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses an amount of nothing', async () => {
    const { user, onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/money.expense.title_field/), 'Shopping');
    await user.type(screen.getByLabelText(/money.expense.amount/), '0');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
