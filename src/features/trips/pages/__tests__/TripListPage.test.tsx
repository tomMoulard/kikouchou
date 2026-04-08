import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import type { Trip } from '@/types';

// Must be before imports that use them
const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);
const mockCheckConnection = vi.fn().mockResolvedValue(undefined);

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Paris',
  startDate: '2026-07-01' as Trip['startDate'],
  endDate: '2026-07-10' as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(() => ({
    trips: [mockTrip],
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
    checkConnection: mockCheckConnection,
  })),
}));

vi.mock('@/features/sharing', () => ({
  ImportTripQrDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="import-qr-dialog" /> : null,
}));

vi.mock('@/lib/db/database', () => ({
  db: {
    persons: {
      where: () => ({
        anyOf: () => ({
          toArray: () => Promise.resolve([]),
        }),
      }),
    },
  },
}));

import { TripListPage } from '../TripListPage';
import { useTripContext } from '@/contexts/TripContext';

describe('TripListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useTripContext).mockReturnValue({
      trips: [mockTrip],
      isLoading: false,
      error: null,
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
  });

  it('renders the trip list with trips', async () => {
    render(<TripListPage />, { withProviders: false });
    await waitFor(() => {
      expect(screen.getByText('trips.title')).toBeInTheDocument();
      expect(screen.getByText('Test Trip')).toBeInTheDocument();
    });
  });

  it('renders loading state', () => {
    vi.mocked(useTripContext).mockReturnValue({
      trips: [],
      isLoading: true,
      error: null,
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
    render(<TripListPage />, { withProviders: false });
    expect(screen.getByText('trips.title')).toBeInTheDocument();
  });

  it('renders error state', () => {
    vi.mocked(useTripContext).mockReturnValue({
      trips: [],
      isLoading: false,
      error: new Error('Database error'),
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
    render(<TripListPage />, { withProviders: false });
    expect(screen.getByText('trips.title')).toBeInTheDocument();
  });

  it('renders empty state when no trips', () => {
    vi.mocked(useTripContext).mockReturnValue({
      trips: [],
      isLoading: false,
      error: null,
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
    render(<TripListPage />, { withProviders: false });
    expect(screen.getByText('trips.empty')).toBeInTheDocument();
  });

  it('navigates to create page on new trip button click', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    vi.mocked(useTripContext).mockReturnValue({
      trips: [],
      isLoading: false,
      error: null,
      currentTrip: null,
      setCurrentTrip: mockSetCurrentTrip,
      checkConnection: mockCheckConnection,
    });
    render(<TripListPage />, { withProviders: false });
    // Click the action button in EmptyState (there may be multiple; pick the first button)
    const newBtns = screen.getAllByRole('button', { name: 'trips.new' });
    await user.click(newBtns[0]!);
    expect(mockNavigate).toHaveBeenCalledWith('/trips/new');
  });
});
