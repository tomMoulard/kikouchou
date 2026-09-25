/**
 * @fileoverview Tests for the trip money page.
 * @module features/money/pages/__tests__/TripMoneyPage.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/utils';
import { db } from '@/lib/db/database';
import type { Expense, ExpenseId, Person, PersonId, Trip, TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_A = 'trip-a' as TripId;
const TRIP_B = 'trip-b' as TripId;

function trip(id: TripId, name: string): Trip {
  return {
    id,
    shareId: `share-${id}`,
    name,
    location: 'Brittany',
    // Four nights: the 1st to the 4th.
    startDate: '2026-07-01',
    endDate: '2026-07-05',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as unknown as Trip;
}

const TRIP_A_ROW = trip(TRIP_A, 'Trip A');
const TRIP_B_ROW = trip(TRIP_B, 'Trip B');

function person(id: string, tripId: TripId, name: string): Person {
  return { id, tripId, name, color: '#3b82f6' } as unknown as Person;
}

function expense(
  id: string,
  tripId: TripId,
  title: string,
  overrides: Partial<Expense> = {},
): Expense {
  return {
    id: id as ExpenseId,
    tripId,
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

// ============================================================================
// Mocks
// ============================================================================

const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);
const mockCheckConnection = vi.fn().mockResolvedValue(undefined);

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-a' }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(),
}));

// The page asks who is holding this device so it can pre-select the payer, and
// that answer comes from the auth and sharing providers this test does without.
vi.mock('@/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks')>('@/hooks');
  return {
    ...actual,
    useTripIdentity: () => ({ myPersonId: undefined }),
    useOfflineAwareNotify: () => ({ notifySuccess: vi.fn() }),
  };
});

vi.mock('@/hooks/useTripAccess', () => ({
  useTripAccess: () => ({ canEdit: true, access: 'member' }),
}));

import { TripMoneyPage } from '../TripMoneyPage';
import { useTripContext } from '@/contexts/TripContext';

// ============================================================================
// Helpers
// ============================================================================

function mockTripContext(
  overrides: Partial<ReturnType<typeof useTripContext>> = {},
): void {
  vi.mocked(useTripContext).mockReturnValue({
    trips: [TRIP_A_ROW, TRIP_B_ROW],
    currentTrip: TRIP_A_ROW,
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
    checkConnection: mockCheckConnection,
    ...overrides,
  } as ReturnType<typeof useTripContext>);
}

// ============================================================================
// Tests
// ============================================================================

describe('TripMoneyPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSetCurrentTrip.mockResolvedValue(undefined);
    mockCheckConnection.mockResolvedValue(undefined);
    mockTripContext();
  });

  it('lists the lines of the trip named in the URL', async () => {
    await db.trips.bulkPut([TRIP_A_ROW, TRIP_B_ROW]);
    await db.persons.bulkPut([
      person('p1', TRIP_A, 'Marie'),
      person('p9', TRIP_B, 'Somebody else'),
    ]);
    await db.expenses.bulkPut([
      expense('e1', TRIP_A, 'Saturday shopping'),
      expense('e9', TRIP_B, "Another trip's line"),
    ]);

    render(<TripMoneyPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('Saturday shopping')).toBeInTheDocument();
    });
    expect(screen.queryByText("Another trip's line")).not.toBeInTheDocument();
  });

  it('reads the trip in the URL even while another trip is current', async () => {
    // The trip contexts lag the URL during a switch, and a balance taken from
    // the previous trip's guests is worse than none.
    mockTripContext({ currentTrip: TRIP_B_ROW });
    await db.trips.bulkPut([TRIP_A_ROW, TRIP_B_ROW]);
    await db.persons.bulkPut([person('p1', TRIP_A, 'Marie')]);
    await db.expenses.bulkPut([expense('e1', TRIP_A, 'Saturday shopping')]);

    render(<TripMoneyPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('Saturday shopping')).toBeInTheDocument();
    });
  });

  it('offers to add the first line when the accounts are empty', async () => {
    await db.trips.put(TRIP_A_ROW);
    await db.persons.bulkPut([person('p1', TRIP_A, 'Marie')]);

    render(<TripMoneyPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('money.expense.empty')).toBeInTheDocument();
    });
  });

  it('opens the form when a line is added', async () => {
    await db.trips.put(TRIP_A_ROW);
    await db.persons.bulkPut([person('p1', TRIP_A, 'Marie')]);

    const { user } = render(<TripMoneyPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('money.expense.empty')).toBeInTheDocument();
    });

    // The empty state's own call to action, so the test does not depend on
    // which of the two "new line" buttons the viewport shows.
    await user.click(screen.getAllByRole('button', { name: 'money.expense.new' })[0]!);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('answers a trip this device does not have with a not-found state', async () => {
    render(<TripMoneyPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
    });
  });

  it('renders an in-page alert when the read fails', async () => {
    await db.trips.put(TRIP_A_ROW);
    vi.spyOn(db.persons, 'where').mockImplementation(() => {
      throw new Error('IndexedDB is gone');
    });

    render(<TripMoneyPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('IndexedDB is gone')).toBeInTheDocument();
    });
  });
});
