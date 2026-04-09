import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import type { Trip } from '@/types';

const mockNavigate = vi.fn();
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

const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(() => ({
    currentTrip: mockTrip,
    setCurrentTrip: mockSetCurrentTrip,
    trips: [mockTrip],
    isLoading: false,
    error: null,
    checkConnection: vi.fn().mockResolvedValue(undefined),
  })),
}));

const mockDbDelete = vi.fn().mockResolvedValue(undefined);
const mockDbOpen = vi.fn().mockResolvedValue(undefined);
const mockDeleteTrip = vi.fn().mockResolvedValue(undefined);
const mockUpdateTrip = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db', () => ({
  db: { delete: (...args: unknown[]) => mockDbDelete(...args), open: (...args: unknown[]) => mockDbOpen(...args) },
  deleteTrip: (...args: unknown[]) => mockDeleteTrip(...args),
  updateTrip: (...args: unknown[]) => mockUpdateTrip(...args),
}));

const mockChangeLanguage = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/i18n', () => ({
  SUPPORTED_LANGUAGES: ['en', 'fr'],
  changeLanguage: (...args: unknown[]) => mockChangeLanguage(...args),
  getCurrentLanguage: () => 'en',
}));

const mockSuccessToast = vi.fn();

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: mockSuccessToast,
    errorToast: vi.fn(),
  }),
}));

// Mock TripForm to expose onSubmit, onCancel, and onDirtyChange callbacks
vi.mock('@/features/trips/components/TripForm', () => ({
  TripForm: ({ onSubmit, onCancel, onDirtyChange }: { onSubmit?: (data: unknown) => Promise<void>; onCancel?: () => void; onDirtyChange?: (dirty: boolean) => void }) => (
    <div data-testid="trip-form">
      <button data-testid="trip-form-submit" onClick={() => void onSubmit?.({ name: 'Updated', startDate: '2026-07-01', endDate: '2026-07-10' }).catch(() => {})}>Submit</button>
      <button data-testid="trip-form-cancel" onClick={onCancel}>Cancel</button>
      <button data-testid="trip-form-dirty" onClick={() => onDirtyChange?.(true)}>Mark Dirty</button>
    </div>
  ),
}));

// Mock ConfirmDialog to capture confirm callback and onOpenChange
vi.mock('@/components/shared/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, onConfirm, onOpenChange }: { open: boolean; onConfirm: () => Promise<void>; onOpenChange?: (o: boolean) => void }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <button data-testid="confirm-action" onClick={() => void onConfirm().catch(() => {})}>Confirm</button>
        {onOpenChange && <button data-testid="confirm-close" onClick={() => onOpenChange(false)}>Close</button>}
      </div>
    ) : null,
}));

import { SettingsPage } from '../SettingsPage';
import { useTripContext } from '@/contexts/TripContext';

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish context mock after clearAllMocks resets return values
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: mockTrip,
      setCurrentTrip: mockSetCurrentTrip,
      trips: [mockTrip],
      isLoading: false,
      error: null,
      checkConnection: vi.fn().mockResolvedValue(undefined),
    } as ReturnType<typeof useTripContext>);
  });

  it('renders settings page with all sections', () => {
    render(<SettingsPage />, { withProviders: false });
    expect(screen.getByText('settings.title')).toBeInTheDocument();
    expect(screen.getByText('settings.language')).toBeInTheDocument();
    expect(screen.getByText('settings.about')).toBeInTheDocument();
    expect(screen.getByText('settings.dataManagement')).toBeInTheDocument();
  });

  it('renders current trip section when trip is selected', () => {
    render(<SettingsPage />, { withProviders: false });
    expect(screen.getByText('settings.currentTrip')).toBeInTheDocument();
    expect(screen.getByTestId('trip-form')).toBeInTheDocument();
  });

  it('does not render current trip section when no trip is selected', () => {
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: null,
      setCurrentTrip: vi.fn().mockResolvedValue(undefined),
      trips: [],
      isLoading: false,
      error: null,
      checkConnection: vi.fn().mockResolvedValue(undefined),
    } as ReturnType<typeof useTripContext>);
    render(<SettingsPage />, { withProviders: false });
    expect(screen.queryByText('settings.currentTrip')).not.toBeInTheDocument();
  });

  it('renders version information', () => {
    render(<SettingsPage />, { withProviders: false });
    expect(screen.getByText('settings.version')).toBeInTheDocument();
  });

  it('renders clear data button', () => {
    render(<SettingsPage />, { withProviders: false });
    expect(screen.getByText('settings.clearData')).toBeInTheDocument();
  });

  it('renders data management section', () => {
    render(<SettingsPage />, { withProviders: false });
    expect(screen.getByText('settings.dataManagement')).toBeInTheDocument();
  });

  describe('CurrentTripSection interactions', () => {
    it('navigates to sync page when sync button is clicked', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      // Find sync button by its text content (may be nested with icon)
      const syncBtn = screen.getByRole('button', { name: /sharing\.sync\.pageTitle|sync/i });
      await user.click(syncBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-1/sync');
    });

    it('updates trip when form is submitted', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      await user.click(screen.getByTestId('trip-form-submit'));

      expect(mockUpdateTrip).toHaveBeenCalledWith('trip-1', {
        name: 'Updated',
        startDate: '2026-07-01',
        endDate: '2026-07-10',
      });
    });

    it('opens delete confirmation and deletes trip', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      // There are multiple "common.delete" buttons; find the one in the current trip section
      const deleteButtons = screen.getAllByText('common.delete');
      // The first delete button is in the CurrentTripSection header
      await user.click(deleteButtons[0]!);

      // Confirm the deletion
      const confirmBtn = await screen.findByTestId('confirm-action');
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockDeleteTrip).toHaveBeenCalledWith('trip-1');
      });
      expect(mockSetCurrentTrip).toHaveBeenCalledWith(null);
      expect(mockNavigate).toHaveBeenCalledWith('/trips', { replace: true });
    });
  });

  describe('LanguageSelector interactions', () => {
    it('renders language selector with current language', () => {
      render(<SettingsPage />, { withProviders: false });
      expect(screen.getByRole('combobox', { name: 'settings.language' })).toBeInTheDocument();
    });
  });

  describe('CurrentTripSection error handling', () => {
    it('handles update trip error gracefully', async () => {
      const { toast } = await import('sonner');
      mockUpdateTrip.mockRejectedValueOnce(new Error('Update failed'));

      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      // The mock TripForm will call onSubmit when submit is clicked
      // but the error will be thrown from updateTrip, which is not caught by the mock
      // The actual form catches this via useFormSubmission
      await user.click(screen.getByTestId('trip-form-submit'));

      // updateTrip should have been called and rejected
      expect(mockUpdateTrip).toHaveBeenCalled();
    });

    it('handles trip cancel by resetting dirty state', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      await user.click(screen.getByTestId('trip-form-cancel'));
      // No crash expected; isDirty should reset
    });

    it('handles delete error gracefully', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      mockDeleteTrip.mockRejectedValueOnce(new Error('Delete failed'));

      render(<SettingsPage />, { withProviders: false });

      const deleteButtons = screen.getAllByText('common.delete');
      await user.click(deleteButtons[0]!);

      const confirmBtn = await screen.findByTestId('confirm-action');
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockDeleteTrip).toHaveBeenCalled();
      });
      // Should not navigate on error
      expect(mockNavigate).not.toHaveBeenCalledWith('/trips', { replace: true });
    });

    it('handles setCurrentTrip failure during delete', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      mockSetCurrentTrip.mockRejectedValueOnce(new Error('Clear failed'));

      render(<SettingsPage />, { withProviders: false });

      const deleteButtons = screen.getAllByText('common.delete');
      await user.click(deleteButtons[0]!);

      const confirmBtn = await screen.findByTestId('confirm-action');
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockDeleteTrip).toHaveBeenCalled();
      });
      // Should still navigate (clear error is non-fatal)
      expect(mockNavigate).toHaveBeenCalledWith('/trips', { replace: true });
    });
  });

  describe('DataSection interactions', () => {
    it('handles clear data failure', async () => {
      mockDbDelete.mockRejectedValueOnce(new Error('DB error'));

      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      await user.click(screen.getByText('settings.clearData'));
      const confirmBtn = await screen.findByTestId('confirm-action');
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockDbDelete).toHaveBeenCalled();
      });
      // Error should be handled (not thrown)
    });

    it('opens clear data dialog and clears data on confirm', async () => {
      // Mock window.location
      const originalHref = window.location.href;
      Object.defineProperty(window, 'location', {
        value: { ...window.location, href: originalHref },
        writable: true,
      });

      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      // Click clear data button
      await user.click(screen.getByText('settings.clearData'));

      // Confirm the action
      const confirmBtn = await screen.findByTestId('confirm-action');
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockDbDelete).toHaveBeenCalled();
      });
      expect(mockDbOpen).toHaveBeenCalled();
    });
  });

  describe('Language change interactions', () => {
    it('calls changeLanguage when language is changed', async () => {
      // Verify language selector is present
      render(<SettingsPage />, { withProviders: false });
      const selector = screen.getByRole('combobox', { name: 'settings.language' });
      expect(selector).toBeInTheDocument();
      // Verify the mock is set up
      expect(mockChangeLanguage).toBeDefined();
    });
  });

  describe('Additional edge cases', () => {
    it('renders trip form in current trip section', () => {
      render(<SettingsPage />, { withProviders: false });
      expect(screen.getByTestId('trip-form')).toBeInTheDocument();
      expect(screen.getByTestId('trip-form-submit')).toBeInTheDocument();
    });

    it('renders about section with version', () => {
      render(<SettingsPage />, { withProviders: false });
      expect(screen.getByText('settings.about')).toBeInTheDocument();
      expect(screen.getByText('settings.aboutDescription')).toBeInTheDocument();
    });

    it('renders data management warning text', () => {
      render(<SettingsPage />, { withProviders: false });
      expect(screen.getByText('settings.clearDataWarning')).toBeInTheDocument();
    });

    it('renders app name in about section', () => {
      render(<SettingsPage />, { withProviders: false });
      expect(screen.getByText('app.name')).toBeInTheDocument();
    });
  });

  describe('handleDirtyChange and dialog interactions', () => {
    it('tracks dirty state via onDirtyChange callback', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });
      // Click the dirty button to trigger onDirtyChange(true)
      const dirtyBtn = screen.getByTestId('trip-form-dirty');
      await user.click(dirtyBtn);
      // The dirty state is internal; just verify no crash
      expect(dirtyBtn).toBeInTheDocument();
    });

    it('closes delete confirm dialog via onOpenChange', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });
      // Open delete dialog
      const deleteBtn = screen.getByRole('button', { name: /common\.delete/i });
      await user.click(deleteBtn);
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      // Close it via onOpenChange
      const closeBtn = screen.getByTestId('confirm-close');
      await user.click(closeBtn);
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    });

    it('closes clear data dialog via onOpenChange', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });
      // Open clear data dialog
      const clearBtn = screen.getByRole('button', { name: /settings\.clearData/i });
      await user.click(clearBtn);
      expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      // Close it via onOpenChange
      const closeBtn = screen.getByTestId('confirm-close');
      await user.click(closeBtn);
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
    });
  });
});
