/**
 * @fileoverview Tests for the app settings page.
 *
 * The page is app-level and nothing else: the account, the language, the
 * theme, the ride alerts, the version, and clearing the device. The trip used
 * to be edited here as well, so one test states the separation directly — a
 * trip form or a "delete this trip" button on this page is the bug, and it is
 * the kind that comes back.
 *
 * @module features/settings/pages/__tests__/SettingsPage.test
 */

import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';

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

// The ride-alert card reads the trip on screen, to say whether the server's
// reminders are on for it. It is the only reason this page still asks for the
// trip context at all.
vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ currentTrip: null }),
}));

const mockDbDelete = vi.fn().mockResolvedValue(undefined);
const mockDbOpen = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db', () => ({
  db: { delete: (...args: unknown[]) => mockDbDelete(...args), open: (...args: unknown[]) => mockDbOpen(...args) },
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

// The language card deliberately uses the raw notification rather than the
// offline-aware one, so both have to be observable to tell them apart.
const mockNotifySuccess = vi.fn();
const mockNotifyError = vi.fn();

// The page renders the ride-alert card too, which reads the browser's
// notification permission through this module: a mock that answers only
// `notify` makes that card throw during render.
vi.mock('@/lib/notifications', () => ({
  notify: {
    success: (...args: unknown[]) => mockNotifySuccess(...args),
    error: (...args: unknown[]) => mockNotifyError(...args),
  },
  NOTIFICATION_STATES: ['unsupported', 'default', 'granted', 'denied'],
  getNotificationState: () => 'unsupported',
  isNotificationSupported: () => false,
  requestNotificationPermission: vi.fn().mockResolvedValue('unsupported'),
}));

const mockSuccessToast = vi.fn();

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({
    notifySuccess: mockSuccessToast,
    errorToast: vi.fn(),
  }),
}));

// Stub the account panel: it needs AuthProvider, which withProviders:false does
// not supply, and its states are covered in features/auth/__tests__.
vi.mock('@/features/auth/components/AccountSection', () => ({
  AccountSection: () => <div data-testid="account-section" />,
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

  it('leaves the trip to the trip', () => {
    // The trip form, "Delete this trip", the guest identity card and the print
    // button all live on `/trips/:tripId/edit` now. The only destructive
    // control left here empties the device rather than one trip.
    render(<SettingsPage />, { withProviders: false });

    expect(screen.queryByTestId('trip-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guest-identity-selector')).not.toBeInTheDocument();
    expect(screen.queryByText('common.delete')).not.toBeInTheDocument();
    expect(screen.getByText('settings.clearData')).toBeInTheDocument();
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
      expect(mockNotifySuccess).toHaveBeenCalledWith('settings.languageChanged');
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
      expect(mockNotifySuccess).not.toHaveBeenCalled();
    });
  });

  describe('Additional edge cases', () => {
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

  describe('Dialog interactions', () => {
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
