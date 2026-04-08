import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/utils';
import type { Trip } from '@/types';

const mockNavigate = vi.fn();
const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Existing Trip',
  location: 'Tokyo',
  startDate: '2026-07-01' as Trip['startDate'],
  endDate: '2026-07-10' as Trip['endDate'],
  description: 'A great trip',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-1' }),
  };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({
    currentTrip: mockTrip,
    setCurrentTrip: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/lib/db', () => ({
  getTripById: vi.fn().mockResolvedValue({
    id: 'trip-1',
    shareId: 'share-1',
    name: 'Existing Trip',
    location: 'Tokyo',
    startDate: '2026-07-01',
    endDate: '2026-07-10',
    description: 'A great trip',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
  updateTrip: vi.fn().mockResolvedValue(undefined),
  deleteTrip: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/hooks', () => ({
  useUnsavedChanges: () => ({
    isBlocked: false,
    proceed: vi.fn(),
    reset: vi.fn(),
    skipNextBlock: vi.fn(),
  }),
}));

// Mock TripForm to avoid deep component tree
vi.mock('@/features/trips/components/TripForm', () => ({
  TripForm: ({ trip, onCancel }: { trip?: unknown; onCancel: () => void }) => (
    <div data-testid="trip-form">
      {trip ? <span data-testid="edit-mode">Edit mode</span> : <span data-testid="create-mode">Create mode</span>}
      <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

import { TripEditPage } from '../TripEditPage';

describe('TripEditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the edit page with trip data', async () => {
    render(<TripEditPage />, { withProviders: false });
    // Wait for async load
    expect(await screen.findByText('trips.edit')).toBeInTheDocument();
    expect(await screen.findByTestId('edit-mode')).toBeInTheDocument();
  });

  it('renders delete button', async () => {
    render(<TripEditPage />, { withProviders: false });
    expect(await screen.findByText('common.delete')).toBeInTheDocument();
  });

  it('navigates back on cancel', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripEditPage />, { withProviders: false });
    const cancelBtn = await screen.findByTestId('cancel-btn');
    await user.click(cancelBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/trips');
  });
});
