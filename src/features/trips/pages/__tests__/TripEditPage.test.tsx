import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
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

const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({
    currentTrip: mockTrip,
    setCurrentTrip: mockSetCurrentTrip,
  }),
}));

const mockGetTripById = vi.fn().mockResolvedValue(mockTrip);
const mockUpdateTrip = vi.fn().mockResolvedValue(undefined);
const mockDeleteTrip = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db', () => ({
  getTripById: (...args: unknown[]) => mockGetTripById(...args),
  updateTrip: (...args: unknown[]) => mockUpdateTrip(...args),
  deleteTrip: (...args: unknown[]) => mockDeleteTrip(...args),
}));

const mockSuccessToast = vi.fn();

vi.mock('@/hooks', () => ({
  useUnsavedChanges: () => ({
    isBlocked: false,
    proceed: vi.fn(),
    reset: vi.fn(),
    skipNextBlock: vi.fn(),
  }),
  useOfflineAwareToast: () => ({ successToast: mockSuccessToast }),
}));

// Mock TripForm to avoid deep component tree
vi.mock('@/features/trips/components/TripForm', () => ({
  TripForm: ({ trip, onSubmit, onCancel }: { trip?: unknown; onSubmit: (data: unknown) => Promise<void>; onCancel: () => void }) => (
    <div data-testid="trip-form">
      {trip ? <span data-testid="edit-mode">Edit mode</span> : <span data-testid="create-mode">Create mode</span>}
      <button data-testid="submit-btn" onClick={() => void onSubmit({ name: 'Updated Trip', startDate: '2026-07-01', endDate: '2026-07-15' }).catch(() => {})}>Submit</button>
      <button data-testid="cancel-btn" onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

// Mock ConfirmDialog to capture confirm and openChange callbacks
vi.mock('@/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, onConfirm, onOpenChange }: { open: boolean; onConfirm: () => Promise<void>; onOpenChange?: (open: boolean) => void }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <button data-testid="confirm-delete" onClick={onConfirm}>Confirm</button>
        {onOpenChange && <button data-testid="close-dialog" onClick={() => onOpenChange(false)}>Close</button>}
      </div>
    ) : null,
}));

import { TripEditPage } from '../TripEditPage';

describe('TripEditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTripById.mockResolvedValue(mockTrip);
  });

  it('renders the edit page with trip data', async () => {
    render(<TripEditPage />, { withProviders: false });
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

  it('updates trip and navigates on submit', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripEditPage />, { withProviders: false });

    const submitBtn = await screen.findByTestId('submit-btn');
    await user.click(submitBtn);

    expect(mockUpdateTrip).toHaveBeenCalledWith('trip-1', {
      name: 'Updated Trip',
      startDate: '2026-07-01',
      endDate: '2026-07-15',
    });
    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-1/calendar');
    // Through the offline-aware helper, like every other entity.
    expect(mockSuccessToast).toHaveBeenCalledWith('trips.updated');
  });

  it('deletes trip when confirm dialog is confirmed', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripEditPage />, { withProviders: false });

    // Open delete dialog
    const deleteBtn = await screen.findByText('common.delete');
    await user.click(deleteBtn);

    // Confirm deletion
    const confirmBtn = await screen.findByTestId('confirm-delete');
    await user.click(confirmBtn);

    expect(mockDeleteTrip).toHaveBeenCalledWith('trip-1');
    expect(mockSetCurrentTrip).toHaveBeenCalledWith(null);
    expect(mockNavigate).toHaveBeenCalledWith('/trips', { replace: true });
  });

  it('shows error state when trip not found', async () => {
    mockGetTripById.mockResolvedValue(null);
    render(<TripEditPage />, { withProviders: false });

    expect(await screen.findByText('errors.tripNotFound')).toBeInTheDocument();
  });

  it('shows error state when trip loading fails', async () => {
    mockGetTripById.mockRejectedValue(new Error('DB Error'));
    render(<TripEditPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
    });
  });

  it('handles delete error gracefully', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    mockDeleteTrip.mockRejectedValueOnce(new Error('Delete failed'));
    render(<TripEditPage />, { withProviders: false });

    const deleteBtn = await screen.findByText('common.delete');
    await user.click(deleteBtn);

    const confirmBtn = await screen.findByTestId('confirm-delete');
    await user.click(confirmBtn);

    // Should not navigate on error
    await waitFor(() => {
      expect(mockDeleteTrip).toHaveBeenCalled();
    });
    // Should not have navigated
    expect(mockNavigate).not.toHaveBeenCalledWith('/trips', { replace: true });
  });

  it('does not clear currentTrip if it differs from deleted trip', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    // Make currentTrip have a different id
    vi.doMock('@/contexts/TripContext', () => ({
      useTripContext: () => ({
        currentTrip: { ...mockTrip, id: 'other-trip' },
        setCurrentTrip: mockSetCurrentTrip,
      }),
    }));
    render(<TripEditPage />, { withProviders: false });

    const deleteBtn = await screen.findByText('common.delete');
    await user.click(deleteBtn);
    const confirmBtn = await screen.findByTestId('confirm-delete');
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockDeleteTrip).toHaveBeenCalledWith('trip-1');
    });
  });

  it('renders back link to trips', async () => {
    render(<TripEditPage />, { withProviders: false });
    await screen.findByText('trips.edit');
    // The PageHeader with backLink="/trips" should render a link
    expect(screen.getByText('trips.edit')).toBeInTheDocument();
  });

  it('handles update error gracefully', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    mockUpdateTrip.mockRejectedValueOnce(new Error('Update failed'));

    render(<TripEditPage />, { withProviders: false });

    const submitBtn = await screen.findByTestId('submit-btn');
    await user.click(submitBtn);

    // Should have called updateTrip but failed
    expect(mockUpdateTrip).toHaveBeenCalled();
    // Should NOT navigate on error
    expect(mockNavigate).not.toHaveBeenCalledWith('/trips/trip-1/calendar');
  });

  it('shows loading state while trip is loading', () => {
    mockGetTripById.mockReturnValue(new Promise(() => {}));
    render(<TripEditPage />, { withProviders: false });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('closes delete dialog via openChange handler', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripEditPage />, { withProviders: false });

    // Open delete dialog
    const deleteBtn = await screen.findByText('common.delete');
    await user.click(deleteBtn);
    expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();

    // Close via the dialog's openChange handler
    const closeBtn = screen.getByTestId('close-dialog');
    await user.click(closeBtn);
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('navigates to /trips from error state back button', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    mockGetTripById.mockResolvedValue(null);
    render(<TripEditPage />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
    });
    // ErrorDisplay renders a "back" button
    const backBtn = screen.getByRole('button', { name: /common\.back/i });
    await user.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/trips');
  });
});
