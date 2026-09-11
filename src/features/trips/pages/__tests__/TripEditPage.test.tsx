/**
 * @fileoverview Tests for the trip's own settings page.
 *
 * The trip form, the delete button, the guest identity card and the print
 * button used to be spread over this page and `/settings`. They are all here
 * now, so the page's own cover has to say that the two cards are mounted — a
 * card that quietly stopped rendering would otherwise leave the app with no
 * way at all to say which guest this browser is.
 *
 * @module features/trips/pages/__tests__/TripEditPage.test
 */

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
  useOfflineAwareNotify: () => ({ notifySuccess: mockSuccessToast }),
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

// The two trip cards below the form: mounted here, driven by their own tests.
vi.mock('@/features/trips/components/GuestIdentitySelector', () => ({
  GuestIdentitySelector: () => <div data-testid="guest-identity-selector" />,
}));

vi.mock('@/features/trips/components/PrintSummaryCard', () => ({
  PrintSummaryCard: () => <div data-testid="print-summary-card" />,
}));

// The share dialog: mounted here, driven by its own tests. It reads the auth
// context, which this page's tests do not provide.
vi.mock('@/features/sharing', () => ({
  ShareDialog: ({ open, trip }: { open: boolean; trip?: { name: string } }) =>
    open ? <div data-testid="share-dialog">{trip?.name}</div> : null,
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

  it('renders the trip settings page with trip data', async () => {
    render(<TripEditPage />, { withProviders: false });
    expect(await screen.findByText('trips.settings')).toBeInTheDocument();
    expect(await screen.findByTestId('edit-mode')).toBeInTheDocument();
  });

  it('carries the two cards that belong to the trip', async () => {
    render(<TripEditPage />, { withProviders: false });
    expect(await screen.findByTestId('guest-identity-selector')).toBeInTheDocument();
    expect(screen.getByTestId('print-summary-card')).toBeInTheDocument();
  });

  it('shows the facts instead of the form on a viewer trip', async () => {
    // A trip opened from an invite link with no account: `viewerToken` is set,
    // and nothing on the device may write into it.
    mockGetTripById.mockResolvedValue({ ...mockTrip, viewerToken: 'token-1' });
    render(<TripEditPage />, { withProviders: false });

    expect(await screen.findByText('Existing Trip')).toBeInTheDocument();
    expect(screen.getByText('viewer.description')).toBeInTheDocument();
    expect(screen.queryByTestId('trip-form')).not.toBeInTheDocument();
  });

  it('renders delete button', async () => {
    render(<TripEditPage />, { withProviders: false });
    expect(await screen.findByText('common.delete')).toBeInTheDocument();
  });

  it('opens the share dialog for this trip', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<TripEditPage />, { withProviders: false });

    expect(screen.queryByTestId('share-dialog')).not.toBeInTheDocument();

    const shareBtn = await screen.findByText('nav.share');
    await user.click(shareBtn);

    const dialog = await screen.findByTestId('share-dialog');
    expect(dialog).toHaveTextContent('Existing Trip');
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
    await screen.findByText('trips.settings');
    // The PageHeader with backLink="/trips" should render a link
    expect(screen.getByText('trips.settings')).toBeInTheDocument();
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
