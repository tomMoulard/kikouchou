/**
 * @fileoverview What the money page writes when somebody acts on it.
 *
 * The sibling file covers what it lists. This one covers the handlers: opening
 * a line, saving one, deleting one, switching to the balances, recording a
 * settling payment, and the two error surfaces — a trip that would not load and
 * a read that failed.
 *
 * The expense dialog and the balances card are stubbed down to buttons: their
 * own forms are covered by their own files, and what matters here is the
 * payload the page writes when they call back.
 *
 * @module features/money/pages/__tests__/TripMoneyPage.actions.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/utils';
import { db } from '@/lib/db/database';
import type {
  Expense,
  ExpenseFormData,
  ExpenseId,
  Person,
  PersonId,
  Trip,
  TripId,
} from '@/types';
import type { SettlementPayment } from '@/features/money/lib/balances';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_A = 'trip-a' as TripId;

const TRIP_A_ROW = {
  id: TRIP_A,
  shareId: `share-${TRIP_A}`,
  name: 'Trip A',
  location: 'Brittany',
  startDate: '2026-07-01',
  endDate: '2026-07-05',
  createdAt: Date.now(),
  updatedAt: Date.now(),
} as unknown as Trip;

function person(id: string, name: string): Person {
  return { id, tripId: TRIP_A, name, color: '#3b82f6' } as unknown as Person;
}

function expense(id: string, title: string, overrides: Partial<Expense> = {}): Expense {
  return {
    id: id as ExpenseId,
    tripId: TRIP_A,
    kind: 'expense',
    category: 'groceries',
    title,
    date: '2026-07-02',
    amount: 100,
    payerId: 'p1' as PersonId,
    splitMode: 'equal',
    splits: [{ personId: 'p1' as PersonId, value: 1 }],
    ...overrides,
  } as Expense;
}

const SAVED_FORM: ExpenseFormData = {
  kind: 'expense',
  category: 'groceries',
  title: 'Sunday market',
  date: '2026-07-03',
  amount: 42,
  payerId: 'p1' as PersonId,
  splitMode: 'equal',
  splits: [{ personId: 'p1' as PersonId, value: 1 }],
} as ExpenseFormData;

// ============================================================================
// Mocks
// ============================================================================

const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn();
const mockCheckConnection = vi.fn();
const mockSetSearchParams = vi.fn();
const mockNotifySuccess = vi.fn();

let currentSearchParams = new URLSearchParams();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-a' }),
    useSearchParams: () => [currentSearchParams, mockSetSearchParams],
  };
});

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));

vi.mock('@/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks')>('@/hooks');
  return {
    ...actual,
    useTripIdentity: () => ({ myPersonId: undefined }),
    useOfflineAwareNotify: () => ({ notifySuccess: mockNotifySuccess }),
  };
});

vi.mock('@/hooks/useTripAccess', () => ({
  useTripAccess: () => ({ canEdit: true, access: 'member' }),
}));

/** The dialog reduced to the three callbacks the page owns. */
vi.mock('@/features/money/components/ExpenseDialog', () => ({
  ExpenseDialog: ({
    open,
    expense: editing,
    onSave,
    onDelete,
    onOpenChange,
  }: {
    open: boolean;
    expense?: Expense;
    onSave: (data: ExpenseFormData, expense: Expense | undefined) => Promise<void>;
    onDelete?: (expense: Expense) => Promise<void>;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="expense-dialog" data-expense-id={editing?.id ?? ''}>
        <button data-testid="save-btn" onClick={() => void onSave(SAVED_FORM, editing)}>
          save
        </button>
        <button
          data-testid="delete-btn"
          onClick={() => {
            if (editing) {
              void onDelete?.(editing).catch(() => {
                // The page re-throws to keep the dialog open; the stub has no
                // dialog to keep, so the rejection stops here.
              });
            }
          }}
        >
          delete
        </button>
        <button data-testid="close-btn" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null,
}));

/** The balances card reduced to the one callback the page owns. */
vi.mock('@/features/money/components/BalancesCard', () => ({
  BalancesCard: ({
    onRecordPayment,
  }: {
    onRecordPayment?: (payment: SettlementPayment) => void;
  }) => (
    <div data-testid="balances-card">
      <button
        data-testid="record-payment-btn"
        onClick={() =>
          onRecordPayment?.({
            fromPersonId: 'p2' as PersonId,
            toPersonId: 'p1' as PersonId,
            amount: 25,
          } as SettlementPayment)
        }
      >
        record
      </button>
    </div>
  ),
}));

import { TripMoneyPage } from '../TripMoneyPage';
import { useTripContext } from '@/contexts/TripContext';

// ============================================================================
// Helpers
// ============================================================================

function mockTripContext(overrides: Partial<ReturnType<typeof useTripContext>> = {}): void {
  vi.mocked(useTripContext).mockReturnValue({
    trips: [TRIP_A_ROW],
    currentTrip: TRIP_A_ROW,
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
    checkConnection: mockCheckConnection,
    ...overrides,
  } as ReturnType<typeof useTripContext>);
}

async function seedTrip(): Promise<void> {
  await db.trips.put(TRIP_A_ROW);
  await db.persons.bulkPut([person('p1', 'Marie'), person('p2', 'Paul')]);
  await db.expenses.put(expense('e1', 'Saturday shopping'));
}

// ============================================================================
// Tests
// ============================================================================

describe('TripMoneyPage — acting on a line', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    mockSetCurrentTrip.mockResolvedValue(undefined);
    mockCheckConnection.mockResolvedValue(undefined);
    mockTripContext();
    await db.expenses.clear();
    await db.persons.clear();
    await db.trips.clear();
  });

  it('opens the line that was tapped', async () => {
    await seedTrip();
    const { user } = render(<TripMoneyPage />, { withProviders: false });

    await user.click(await screen.findByText('Saturday shopping'));

    expect(await screen.findByTestId('expense-dialog')).toHaveAttribute('data-expense-id', 'e1');
  });

  it('forgets what it was editing once the dialog closes', async () => {
    await seedTrip();
    const { user } = render(<TripMoneyPage />, { withProviders: false });

    await user.click(await screen.findByText('Saturday shopping'));
    await user.click(await screen.findByTestId('close-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('expense-dialog')).not.toBeInTheDocument();
    });
  });

  it('writes a new line', async () => {
    await seedTrip();
    const { user } = render(<TripMoneyPage />, { withProviders: false });

    const addButtons = await screen.findAllByRole('button', { name: /money.expense.new/i });
    await user.click(addButtons[0]!);
    await user.click(await screen.findByTestId('save-btn'));

    await waitFor(async () => {
      const titles = (await db.expenses.where('tripId').equals(TRIP_A).toArray()).map(
        (row) => row.title,
      );
      expect(titles).toContain('Sunday market');
    });
  });

  it('updates the line it was opened on', async () => {
    await seedTrip();
    const { user } = render(<TripMoneyPage />, { withProviders: false });

    await user.click(await screen.findByText('Saturday shopping'));
    await user.click(await screen.findByTestId('save-btn'));

    await waitFor(async () => {
      expect((await db.expenses.get('e1' as ExpenseId))?.title).toBe('Sunday market');
    });
  });

  it('deletes the line and says so', async () => {
    await seedTrip();
    const { user } = render(<TripMoneyPage />, { withProviders: false });

    await user.click(await screen.findByText('Saturday shopping'));
    await user.click(await screen.findByTestId('delete-btn'));

    await waitFor(async () => {
      expect(await db.expenses.get('e1' as ExpenseId)).toBeUndefined();
    });
    expect(mockNotifySuccess).toHaveBeenCalled();
  });

  it('does not claim a deletion that failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedTrip();
    const { user } = render(<TripMoneyPage />, { withProviders: false });

    await user.click(await screen.findByText('Saturday shopping'));
    vi.spyOn(db.expenses, 'delete').mockRejectedValue(new Error('offline'));
    await user.click(await screen.findByTestId('delete-btn'));

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalled();
    });
    expect(mockNotifySuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('TripMoneyPage — the balances view', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    mockSetCurrentTrip.mockResolvedValue(undefined);
    mockCheckConnection.mockResolvedValue(undefined);
    mockTripContext();
    await db.expenses.clear();
    await db.persons.clear();
    await db.trips.clear();
  });

  it('puts the chosen view in the URL', async () => {
    await seedTrip();
    const { user } = render(<TripMoneyPage />, { withProviders: false });

    await user.click(await screen.findByRole('radio', { name: /money.view.balances/i }));

    expect(mockSetSearchParams).toHaveBeenCalled();
    const [next] = mockSetSearchParams.mock.calls[0]!;
    expect((next as URLSearchParams).get('view')).toBe('balances');
  });

  it('records a settling payment as a transfer', async () => {
    currentSearchParams = new URLSearchParams('view=balances');
    await seedTrip();
    const { user } = render(<TripMoneyPage />, { withProviders: false });

    await user.click(await screen.findByTestId('record-payment-btn'));

    await waitFor(async () => {
      const transfers = (await db.expenses.where('tripId').equals(TRIP_A).toArray()).filter(
        (row) => row.kind === 'transfer',
      );
      expect(transfers).toHaveLength(1);
      expect(transfers[0]).toMatchObject({ amount: 25, payerId: 'p2' });
    });
    expect(mockNotifySuccess).toHaveBeenCalled();
  });
});

describe('TripMoneyPage — when the trip will not load', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    mockSetCurrentTrip.mockResolvedValue(undefined);
    mockCheckConnection.mockResolvedValue(undefined);
    await db.expenses.clear();
    await db.persons.clear();
    await db.trips.clear();
  });

  it('shows the trip error and retries on demand', async () => {
    await seedTrip();
    mockTripContext({ error: new Error('the network went away') });

    const { user } = render(<TripMoneyPage />, { withProviders: false });

    await user.click(await screen.findByRole('button', { name: /common.retry/i }));

    expect(mockCheckConnection).toHaveBeenCalled();
  });

  it('says so rather than hanging when the connection check itself fails', async () => {
    await seedTrip();
    mockCheckConnection.mockRejectedValue(new Error('still offline'));
    mockTripContext({ error: new Error('the network went away') });

    const { user } = render(<TripMoneyPage />, { withProviders: false });
    await user.click(await screen.findByRole('button', { name: /common.retry/i }));

    await waitFor(() => {
      expect(mockCheckConnection).toHaveBeenCalled();
    });
  });

  it('reports a trip switch that failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedTrip();
    mockSetCurrentTrip.mockRejectedValue(new Error('gone'));
    mockTripContext({ currentTrip: null, setCurrentTrip: mockSetCurrentTrip });

    render(<TripMoneyPage />, { withProviders: false });

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to set current trip from URL:',
        expect.any(Error),
      );
    });
    consoleError.mockRestore();
  });
});
