import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import type { Trip } from '@/types';

/**
 * Radix's Select trigger calls `hasPointerCapture` on pointerdown and scrolls
 * the chosen item into view; jsdom implements neither, and the resulting
 * `TypeError` escapes as an uncaught exception rather than a failed assertion.
 * Without these the language dropdown cannot be opened in a test at all —
 * which is why the language test used to assert that a `vi.fn()` was defined.
 */
function installPointerCaptureShims(): () => void {
  const element = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  const shims: Record<string, () => unknown> = {
    hasPointerCapture: () => false,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    scrollIntoView: () => undefined,
  };

  // jsdom defines none of these, so the restore has to *delete* them. Writing
  // the captured originals back with `Object.assign` would turn four absent
  // properties into own properties valued `undefined`, and any consumer that
  // feature-detects with `in` would then take the true branch and throw.
  const absent = Object.keys(shims).filter((name) => !(name in element));
  const originals = Object.fromEntries(
    Object.keys(shims)
      .filter((name) => name in element)
      .map((name) => [name, element[name]]),
  );

  Object.assign(element, shims);

  return () => {
    Object.assign(element, originals);
    for (const name of absent) {
      Reflect.deleteProperty(element, name);
    }
  };
}

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

// `isLanguageSupported` reads the same list the options are rendered from, so
// the mock keeps them in step here too: a language added to one is added to
// both, which is the point of the production change this guards.
const { MOCK_SUPPORTED_LANGUAGES } = vi.hoisted(() => ({
  MOCK_SUPPORTED_LANGUAGES: ['en', 'fr'],
}));

vi.mock('@/lib/i18n', () => ({
  SUPPORTED_LANGUAGES: MOCK_SUPPORTED_LANGUAGES,
  changeLanguage: (...args: unknown[]) => mockChangeLanguage(...args),
  getCurrentLanguage: () => 'en',
  isLanguageSupported: (value: string) => MOCK_SUPPORTED_LANGUAGES.includes(value),
}));

// The language card deliberately uses the raw sonner toast rather than the
// offline-aware one, so both have to be observable to tell them apart.
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
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

// Stub the account panel: it needs AuthProvider, which withProviders:false does
// not supply, and its states are covered in features/auth/__tests__.
vi.mock('@/features/auth/components/AccountSection', () => ({
  AccountSection: () => <div data-testid="account-section" />,
}));

// Same reason for the identity card: it reads PersonProvider and, through
// `useTripIdentity`, AuthProvider and Dexie. Its own states are covered in
// features/settings/components/__tests__/TripIdentitySelector.test.tsx; what
// this file asserts is that the page still composes it.
vi.mock('@/features/settings/components/TripIdentitySelector', () => ({
  TripIdentitySelector: () => <div data-testid="trip-identity-selector" />,
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
  let restorePointerCaptureShims: () => void;

  beforeAll(() => {
    restorePointerCaptureShims = installPointerCaptureShims();
  });

  afterAll(() => {
    restorePointerCaptureShims();
  });

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
    expect(screen.getByText('auth.account.title')).toBeInTheDocument();
    expect(screen.getByText('settings.language')).toBeInTheDocument();
    expect(screen.getByText('settings.theme')).toBeInTheDocument();
    expect(screen.getByText('settings.about')).toBeInTheDocument();
    expect(screen.getByText('settings.dataManagement')).toBeInTheDocument();
  });

  it('mounts the account panel', () => {
    render(<SettingsPage />, { withProviders: false });
    expect(screen.getByTestId('account-section')).toBeInTheDocument();
  });

  it('mounts the identity card, which is the only way to answer "who am I"', () => {
    render(<SettingsPage />, { withProviders: false });
    expect(screen.getByTestId('trip-identity-selector')).toBeInTheDocument();
  });

  it('renders current trip section when trip is selected', () => {
    render(<SettingsPage />, { withProviders: false });
    expect(screen.getByText('settings.currentTrip')).toBeInTheDocument();
    expect(screen.getByTestId('trip-form')).toBeInTheDocument();
  });

  describe('CurrentTripSection states', () => {
    it('shows a loading state, not a hole, while the trip query resolves', () => {
      vi.mocked(useTripContext).mockReturnValue({
        currentTrip: null,
        setCurrentTrip: vi.fn().mockResolvedValue(undefined),
        trips: [],
        isLoading: true,
        error: null,
        checkConnection: vi.fn().mockResolvedValue(undefined),
      } as ReturnType<typeof useTripContext>);
      render(<SettingsPage />, { withProviders: false });

      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('aria-busy', 'true');
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(status).toHaveTextContent('settings.currentTripLoading');
      expect(screen.queryByTestId('trip-form')).not.toBeInTheDocument();
    });

    it('shows an error with a retry that rechecks the connection', async () => {
      const checkConnection = vi.fn().mockResolvedValue(undefined);
      vi.mocked(useTripContext).mockReturnValue({
        currentTrip: null,
        setCurrentTrip: vi.fn().mockResolvedValue(undefined),
        trips: [],
        isLoading: false,
        error: new Error('IndexedDB is unavailable'),
        checkConnection,
      } as ReturnType<typeof useTripContext>);
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      const alert = screen.getByRole('alert');
      expect(alert).toHaveAttribute('aria-live', 'assertive');
      expect(alert).toHaveTextContent('settings.currentTripError');
      expect(alert).toHaveTextContent('IndexedDB is unavailable');

      await user.click(screen.getByRole('button', { name: /common\.retry/i }));
      expect(checkConnection).toHaveBeenCalledTimes(1);
    });

    it('keeps the editable form when a stale context error arrives with a trip', () => {
      // TripContext's error is shared: a setCurrentTrip that failed on another
      // page leaves it set. That must not unmount a form the user can still use.
      vi.mocked(useTripContext).mockReturnValue({
        currentTrip: mockTrip,
        setCurrentTrip: mockSetCurrentTrip,
        trips: [mockTrip],
        isLoading: false,
        error: new Error('Trip with ID "other" not found'),
        checkConnection: vi.fn().mockResolvedValue(undefined),
      } as ReturnType<typeof useTripContext>);
      render(<SettingsPage />, { withProviders: false });

      expect(screen.getByTestId('trip-form')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('swallows a retry that fails again instead of rejecting', async () => {
      const checkConnection = vi.fn().mockRejectedValue(new Error('still broken'));
      vi.mocked(useTripContext).mockReturnValue({
        currentTrip: null,
        setCurrentTrip: vi.fn().mockResolvedValue(undefined),
        trips: [],
        isLoading: false,
        error: new Error('IndexedDB is unavailable'),
        checkConnection,
      } as ReturnType<typeof useTripContext>);
      const onUnhandled = vi.fn();
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      process.on('unhandledRejection', onUnhandled);
      try {
        render(<SettingsPage />, { withProviders: false });
        await user.click(screen.getByRole('button', { name: /common\.retry/i }));
        await waitFor(() => {
          expect(checkConnection).toHaveBeenCalledTimes(1);
        });
        // Give the microtask queue a turn for a rejection to surface.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(onUnhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    it('shows an empty state pointing at the trip list when trips exist', async () => {
      vi.mocked(useTripContext).mockReturnValue({
        currentTrip: null,
        setCurrentTrip: vi.fn().mockResolvedValue(undefined),
        trips: [mockTrip],
        isLoading: false,
        error: null,
        checkConnection: vi.fn().mockResolvedValue(undefined),
      } as ReturnType<typeof useTripContext>);
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      expect(screen.getByText('settings.noCurrentTrip')).toBeInTheDocument();
      expect(screen.getByText('settings.noCurrentTripDescription')).toBeInTheDocument();
      expect(screen.queryByTestId('trip-form')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'settings.chooseTrip' }));
      expect(mockNavigate).toHaveBeenCalledWith('/trips');
    });

    it('offers to create the first trip when the device has none', async () => {
      vi.mocked(useTripContext).mockReturnValue({
        currentTrip: null,
        setCurrentTrip: vi.fn().mockResolvedValue(undefined),
        trips: [],
        isLoading: false,
        error: null,
        checkConnection: vi.fn().mockResolvedValue(undefined),
      } as ReturnType<typeof useTripContext>);
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      expect(screen.getByText('settings.noTripsYetDescription')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'settings.createFirstTrip' }));
      expect(mockNavigate).toHaveBeenCalledWith('/trips/new');
    });

    it('hides the destructive delete button when there is no trip to delete', () => {
      vi.mocked(useTripContext).mockReturnValue({
        currentTrip: null,
        setCurrentTrip: vi.fn().mockResolvedValue(undefined),
        trips: [mockTrip],
        isLoading: false,
        error: null,
        checkConnection: vi.fn().mockResolvedValue(undefined),
      } as ReturnType<typeof useTripContext>);
      render(<SettingsPage />, { withProviders: false });
      expect(screen.queryByText('common.delete')).not.toBeInTheDocument();
    });
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

    it('confirms a trip update through the offline-aware toast', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      await user.click(screen.getByTestId('trip-form-submit'));

      await waitFor(() => {
        expect(mockSuccessToast).toHaveBeenCalledWith('trips.updated');
      });
    });

    it('confirms a trip deletion through the offline-aware toast', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      await user.click(screen.getAllByText('common.delete')[0]!);
      await user.click(await screen.findByTestId('confirm-action'));

      await waitFor(() => {
        expect(mockSuccessToast).toHaveBeenCalledWith('trips.deleted');
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
      const selector = screen.getByRole('combobox', { name: 'settings.language' });
      // Not a placeholder: the trigger has to show what the app is already set
      // to, which `getCurrentLanguage()` reports as English here.
      expect(selector).toHaveTextContent('settings.languages.en');
    });

    it('offers every supported language', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      await user.click(screen.getByRole('combobox', { name: 'settings.language' }));

      const options = await screen.findAllByRole('option');
      expect(options.map((option) => option.textContent)).toEqual([
        'settings.languages.en',
        'settings.languages.fr',
      ]);
    });
  });

  describe('CurrentTripSection error handling', () => {
    it('handles update trip error gracefully', async () => {
      await import('sonner');
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

      // `isDirty` is not internal — it renders the unsaved-changes notice, so
      // "should reset" is observable rather than a comment. This test used to
      // click Cancel and assert nothing at all.
      await user.click(screen.getByTestId('trip-form-dirty'));
      expect(screen.getByText('settings.unsavedTripChanges')).toBeInTheDocument();

      await user.click(screen.getByTestId('trip-form-cancel'));
      expect(screen.queryByText('settings.unsavedTripChanges')).not.toBeInTheDocument();
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
    it('switches the app language when a different one is picked', async () => {
      // This test used to end on `expect(mockChangeLanguage).toBeDefined()`,
      // with the comment "Verify the mock is set up" — a `vi.fn()` is always
      // defined, the language was never changed, and deleting the whole
      // `onValueChange` handler passed. Now it picks French and checks that
      // French is what `changeLanguage` was asked for.
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      await user.click(screen.getByRole('combobox', { name: 'settings.language' }));
      await user.click(await screen.findByRole('option', { name: 'settings.languages.fr' }));

      expect(mockChangeLanguage).toHaveBeenCalledWith('fr');
      expect(mockChangeLanguage).toHaveBeenCalledTimes(1);
      // A raw toast on purpose: the language lives in localStorage and never
      // syncs, so the offline-aware "saved on this device" wording would be a
      // lie about a device-local preference.
      expect(mockToastSuccess).toHaveBeenCalledWith('settings.languageChanged');
      expect(mockSuccessToast).not.toHaveBeenCalled();
    });

    it('does not re-announce a language that is already active', async () => {
      const { userEvent } = await import('@testing-library/user-event');
      const user = userEvent.setup();
      render(<SettingsPage />, { withProviders: false });

      await user.click(screen.getByRole('combobox', { name: 'settings.language' }));
      await user.click(await screen.findByRole('option', { name: 'settings.languages.en' }));

      // Radix does not fire `onValueChange` for the value already selected, so
      // re-picking English must not reload i18n or pop a toast.
      expect(mockChangeLanguage).not.toHaveBeenCalled();
      expect(mockToastSuccess).not.toHaveBeenCalled();
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
      expect(screen.queryByText('settings.unsavedTripChanges')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('trip-form-dirty'));

      // Asserting the button is still in the document (what this used to do)
      // cannot see whether the callback did anything.
      expect(screen.getByText('settings.unsavedTripChanges')).toBeInTheDocument();
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
