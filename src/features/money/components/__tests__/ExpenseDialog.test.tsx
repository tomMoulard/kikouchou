/**
 * @fileoverview Tests for ExpenseDialog.
 *
 * The dialog owns three decisions and nothing else: which mode it is in, what
 * it does with a submitted line, and whether closing it is allowed to throw
 * away an edit. The form inside it has its own file, so it is replaced here by
 * three buttons that drive those three paths.
 *
 * @module features/money/components/__tests__/ExpenseDialog.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen, waitFor } from '@/test/utils';
import type {
  Expense,
  ExpenseFormData,
  ExpenseId,
  ISODateString,
  Person,
  PersonId,
  TripId,
} from '@/types';

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

const existingExpense: Expense = {
  id: 'e1' as ExpenseId,
  tripId: TRIP_ID,
  kind: 'expense',
  category: 'groceries',
  title: 'Saturday shopping',
  date: '2026-07-02',
  amount: 100,
  payerId: marie.id,
  splitMode: 'equal',
  splits: [{ personId: marie.id, value: 1 }],
} as Expense;

const submitted: ExpenseFormData = {
  kind: 'expense',
  category: 'groceries',
  title: 'Sunday market',
  date: '2026-07-03',
  amount: 42,
  payerId: marie.id,
  splitMode: 'equal',
  splits: [{ personId: marie.id, value: 1 }],
} as ExpenseFormData;

// ============================================================================
// Mocks
// ============================================================================

const mockNotifySuccess = vi.fn();

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: mockNotifySuccess, errorToast: vi.fn() }),
  useFormSubmission: <T,>(onSubmit: (data: T) => Promise<void>) => ({
    isSubmitting: false,
    submitError: undefined,
    handleSubmit: onSubmit,
    clearError: vi.fn(),
  }),
}));

vi.mock('@/features/money/components/ExpenseForm', () => ({
  ExpenseForm: ({
    expense,
    defaultDate,
    onSubmit,
    onCancel,
    onDirtyChange,
  }: {
    expense?: Expense;
    defaultDate?: string;
    onSubmit: (data: ExpenseFormData) => Promise<void>;
    onCancel: () => void;
    onDirtyChange?: (dirty: boolean) => void;
  }) => (
    <div data-testid="expense-form" data-expense-id={expense?.id ?? ''}>
      <span data-testid="default-date">{defaultDate ?? 'none'}</span>
      <button data-testid="submit-btn" onClick={() => void onSubmit(submitted)}>
        submit
      </button>
      <button data-testid="cancel-btn" onClick={onCancel}>
        cancel
      </button>
      <button data-testid="dirty-btn" onClick={() => onDirtyChange?.(true)}>
        dirty
      </button>
    </div>
  ),
}));

import { ExpenseDialog } from '../ExpenseDialog';

// ============================================================================
// Helpers
// ============================================================================

function renderDialog(props: Partial<Parameters<typeof ExpenseDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn().mockResolvedValue(undefined);

  const view = render(
    <ExpenseDialog
      open
      onOpenChange={onOpenChange}
      persons={[marie]}
      personNights={new Map([[marie.id, 3]])}
      currency="EUR"
      onSave={onSave}
      onDelete={onDelete}
      {...props}
    />,
    { withProviders: false },
  );

  return { ...view, onOpenChange, onSave, onDelete };
}

// ============================================================================
// Tests
// ============================================================================

describe('ExpenseDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens in create mode when no line was given', () => {
    renderDialog({ defaultDate: '2026-07-04' as ISODateString });

    expect(screen.getByText('money.expense.new')).toBeInTheDocument();
    expect(screen.getByText('money.expense.newDescription')).toBeInTheDocument();
    expect(screen.getByTestId('default-date')).toHaveTextContent('2026-07-04');
    expect(
      screen.queryByRole('button', { name: 'money.expense.delete' }),
    ).not.toBeInTheDocument();
  });

  it('opens in edit mode on the line it was given', () => {
    renderDialog({ expense: existingExpense, defaultDate: '2026-07-04' as ISODateString });

    expect(screen.getByText('money.expense.edit')).toBeInTheDocument();
    expect(screen.getByTestId('expense-form')).toHaveAttribute('data-expense-id', 'e1');
    // An existing line carries its own date; the default would overwrite it.
    expect(screen.getByTestId('default-date')).toHaveTextContent('none');
    expect(screen.getByRole('button', { name: 'money.expense.delete' })).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    renderDialog({ open: false });

    expect(screen.queryByText('money.expense.new')).not.toBeInTheDocument();
  });

  it('saves a new line, says so and closes', async () => {
    const { user, onSave, onOpenChange } = renderDialog();

    await user.click(screen.getByTestId('submit-btn'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(submitted, undefined);
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('money.expense.createSuccess');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('saves an edit against the line it was opened on', async () => {
    const { user, onSave } = renderDialog({ expense: existingExpense });

    await user.click(screen.getByTestId('submit-btn'));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(submitted, existingExpense);
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('money.expense.updateSuccess');
  });

  it('closes straight away when cancelling a clean form', async () => {
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByTestId('cancel-btn'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('unsaved.discardChanges')).not.toBeInTheDocument();
  });

  it('asks before throwing away an unsaved edit', async () => {
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByTestId('dirty-btn'));
    await user.click(screen.getByTestId('cancel-btn'));

    expect(screen.getByText('unsaved.discardChanges')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('asks before an Escape throws away an unsaved edit', async () => {
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByTestId('dirty-btn'));
    await user.keyboard('{Escape}');

    expect(await screen.findByText('unsaved.discardChanges')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('closes once the discard is confirmed', async () => {
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByTestId('dirty-btn'));
    await user.click(screen.getByTestId('cancel-btn'));
    await user.click(screen.getByRole('button', { name: 'unsaved.discard' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the edit when the discard prompt is dismissed', async () => {
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByTestId('dirty-btn'));
    await user.click(screen.getByTestId('cancel-btn'));
    await user.click(screen.getByRole('button', { name: 'unsaved.keepEditing' }));

    await waitFor(() => {
      expect(screen.queryByText('unsaved.discardChanges')).not.toBeInTheDocument();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('expense-form')).toBeInTheDocument();
  });

  it('asks before deleting, and deletes on yes', async () => {
    const { user, onDelete, onOpenChange } = renderDialog({ expense: existingExpense });

    await user.click(screen.getByRole('button', { name: 'money.expense.delete' }));
    expect(screen.getByText('confirm.deleteExpense')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'common.delete' }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(existingExpense);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the line when the delete prompt is dismissed', async () => {
    const { user, onDelete } = renderDialog({ expense: existingExpense });

    await user.click(screen.getByRole('button', { name: 'money.expense.delete' }));
    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    await waitFor(() => {
      expect(screen.queryByText('confirm.deleteExpense')).not.toBeInTheDocument();
    });
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('clears the dirty flag when the dialog is reopened', async () => {
    const { user, rerender, onOpenChange } = renderDialog();

    await user.click(screen.getByTestId('dirty-btn'));
    rerender(
      <ExpenseDialog
        open={false}
        onOpenChange={onOpenChange}
        persons={[marie]}
        personNights={new Map([[marie.id, 3]])}
        currency="EUR"
        onSave={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    rerender(
      <ExpenseDialog
        open
        onOpenChange={onOpenChange}
        persons={[marie]}
        personNights={new Map([[marie.id, 3]])}
        currency="EUR"
        onSave={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.click(screen.getByTestId('cancel-btn'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('unsaved.discardChanges')).not.toBeInTheDocument();
  });
});
