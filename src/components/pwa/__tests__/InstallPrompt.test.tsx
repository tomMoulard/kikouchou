import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@/test/utils';

import type { ManualInstallPlatform } from '@/hooks/useInstallPrompt';

const mockCanInstall = vi.fn(() => false);
const mockInstall = vi.fn().mockResolvedValue(true);
const mockIsInstalling = vi.fn(() => false);
const mockIsInstalled = vi.fn(() => false);
const mockInstallIntent = vi.fn(() => false);
const mockManualInstallPlatform = vi.fn((): ManualInstallPlatform => 'generic');

vi.mock('@/hooks/useInstallPrompt', () => ({
  useInstallPrompt: () => ({
    canInstall: mockCanInstall(),
    install: mockInstall,
    isInstalling: mockIsInstalling(),
    isInstalled: mockIsInstalled(),
    installIntent: mockInstallIntent(),
    manualInstallPlatform: mockManualInstallPlatform(),
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { InstallPrompt } from '../InstallPrompt';

/**
 * The key the component reads on init and writes on dismiss.
 */
const DISMISSAL_KEY = 'kikouchou-install-dismissed';

/**
 * Gives this test file a working `localStorage`, empty, for one test.
 *
 * jsdom ships one, but Node's own experimental `localStorage` global shadows it
 * and reads back `undefined` unless the process was started with
 * `--localstorage-file` — so `typeof localStorage` is `undefined` for the whole
 * suite. Every access in the app sits inside a `try/catch` for Safari's private
 * mode, which swallows the `TypeError` and answers "not dismissed": the 7-day
 * window does not exist in these tests, and a spy on `Storage.prototype` cannot
 * put it back, because nothing ever reaches a `Storage` instance to spy on.
 *
 * Seeding this store is therefore the only way to assert either half of a
 * dismissal — that it silences the banner, and that an explicit install request
 * overrides it.
 */
function installMemoryStorage(): void {
  const store = new Map<string, string>();

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    } satisfies Storage,
  });
}

describe('InstallPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installMemoryStorage();
    mockCanInstall.mockReturnValue(false);
    mockInstall.mockResolvedValue(true);
    mockIsInstalling.mockReturnValue(false);
    mockIsInstalled.mockReturnValue(false);
    mockInstallIntent.mockReturnValue(false);
    mockManualInstallPlatform.mockReturnValue('generic');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('returns null when canInstall is false', () => {
    mockCanInstall.mockReturnValue(false);
    const { container } = render(<InstallPrompt />, { withProviders: false });
    expect(container.innerHTML).toBe('');
  });

  it('returns null initially before delay even when canInstall', () => {
    mockCanInstall.mockReturnValue(true);
    const { container } = render(<InstallPrompt />, { withProviders: false });
    expect(container.innerHTML).toBe('');
  });

  it('shows prompt after delay when canInstall', async () => {
    mockCanInstall.mockReturnValue(true);
    render(<InstallPrompt />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    // The install prompt should be visible now (rendered as a region)
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('shows install and dismiss buttons when visible', async () => {
    mockCanInstall.mockReturnValue(true);
    render(<InstallPrompt />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    // "pwa.install" appears as both title and button text
    expect(screen.getAllByText('pwa.install').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('pwa.notNow')).toBeInTheDocument();
    expect(screen.getByLabelText('common.close')).toBeInTheDocument();
  });

  it('calls install when install button is clicked', async () => {
    mockCanInstall.mockReturnValue(true);
    mockInstall.mockResolvedValue(true);
    render(<InstallPrompt />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    // Click the button (not the title) — use getAllByText and pick the button
    const installBtns = screen.getAllByText('pwa.install');
    const installBtn = installBtns.find(el => el.closest('button'))!;
    await act(async () => { installBtn.click(); });
    expect(mockInstall).toHaveBeenCalled();
  });

  it('shows error toast when install fails', async () => {
    const { toast } = await import('sonner');
    mockCanInstall.mockReturnValue(true);
    mockInstall.mockResolvedValue(false);
    mockIsInstalled.mockReturnValue(false);
    render(<InstallPrompt />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    const installBtns = screen.getAllByText('pwa.install');
    const installBtn = installBtns.find(el => el.closest('button'))!;
    await act(async () => { installBtn.click(); });
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
  });

  it('dismisses prompt when dismiss button is clicked', async () => {
    mockCanInstall.mockReturnValue(true);
    render(<InstallPrompt />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    expect(screen.getByRole('region')).toBeInTheDocument();
    const dismissBtn = screen.getByText('pwa.notNow');
    await act(async () => { dismissBtn.click(); });
    // After dismiss animation timeout
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('dismisses prompt when close (X) button is clicked', async () => {
    mockCanInstall.mockReturnValue(true);
    render(<InstallPrompt />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    const closeBtn = screen.getByLabelText('common.close');
    await act(async () => { closeBtn.click(); });
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('shows loading text when installing', async () => {
    mockCanInstall.mockReturnValue(true);
    mockIsInstalling.mockReturnValue(true);
    render(<InstallPrompt />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    expect(screen.getByText('common.loading')).toBeInTheDocument();
  });

  it('renders description text when visible', async () => {
    mockCanInstall.mockReturnValue(true);
    render(<InstallPrompt />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    expect(screen.getByText('pwa.installDescription')).toBeInTheDocument();
  });

  it('applies custom className', async () => {
    mockCanInstall.mockReturnValue(true);
    render(<InstallPrompt className="my-class" />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    const region = screen.getByRole('region');
    expect(region).toHaveClass('my-class');
  });

  it('shows prompt when dismissed timestamp is NaN (invalid localStorage)', async () => {
    localStorage.setItem(DISMISSAL_KEY, 'invalid-value');
    mockCanInstall.mockReturnValue(true);
    render(<InstallPrompt />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    // isDismissedRecently() returns false for NaN, so prompt should show
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('shows prompt when dismissal timestamp is expired', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISSAL_KEY, eightDaysAgo.toString());
    mockCanInstall.mockReturnValue(true);
    render(<InstallPrompt />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  /**
   * The bottom edge.
   *
   * jsdom loads no stylesheet, so these assert the *classes* — which is as far
   * as a unit test can go. The geometry itself is hit-tested in
   * `e2e/mobile-bottom-edge.spec.ts`, at the FAB's own centre. What these catch
   * is the two ways the fix silently comes undone in a later edit.
   */
  describe('bottom-edge clearance', () => {
    it('is positioned above the bottom stack rather than padded away from it', async () => {
      mockCanInstall.mockReturnValue(true);
      render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(1100); });

      const region = screen.getByRole('region');

      // Padding is part of an element's box and hit-tests like the rest of it,
      // so `bottom-0` plus any amount of bottom padding still swallows every
      // tap across the FAB's band. Only `bottom` moves the box itself.
      expect(region).toHaveClass('bottom-above-stack');
      expect(region.className).not.toMatch(/\bbottom-0\b/);
      expect(region.className).not.toMatch(/\bpb-(20|bottom-stack)\b/);
    });

    it('does not eat taps in the width the card does not fill', async () => {
      mockCanInstall.mockReturnValue(true);
      render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(1100); });

      // The wrapper is `inset-x-0`; the card is `max-w-md mx-auto`. The strips
      // either side of it paint nothing, which is exactly the case
      // `OfflineIndicator` waves through with `pointer-events-none`.
      expect(screen.getByRole('region').className).toMatch(/pointer-events-none/);
    });

    it('keeps its own buttons clickable', async () => {
      mockCanInstall.mockReturnValue(true);
      render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(1100); });

      // `pointer-events-none` on the wrapper is inherited, so the drawn part
      // has to opt back in — without this the Install button is decorative.
      const card = screen.getByRole('region').firstElementChild;
      expect(card?.className).toMatch(/pointer-events-auto/);
    });
  });

  /**
   * An explicit install request.
   *
   * The landing page's "Install on your phone" CTA links to `/?install=1`, and
   * a visitor who clicks it has already said yes. Two things then answer with
   * nothing at all: a dismissal from last week, which is a 7-day silence this
   * card applies on its own, and a browser that never fires
   * `beforeinstallprompt` — every one that is not Chromium, so both iPhones and
   * Firefox. Those are the two halves of the reported bug.
   */
  describe('an explicit install request', () => {
    /**
     * Dismissed a moment ago: inside the 7-day window by any measure.
     */
    function dismissedToday(): void {
      localStorage.setItem(DISMISSAL_KEY, Date.now().toString());
    }

    it('stays silent after a dismissal this week when nothing was requested', async () => {
      dismissedToday();
      mockCanInstall.mockReturnValue(true);

      render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(1100); });

      // The control for the test below: the 7-day window is still a window.
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });

    it('shows the banner despite a dismissal this week', async () => {
      dismissedToday();
      mockCanInstall.mockReturnValue(true);
      mockInstallIntent.mockReturnValue(true);

      render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(1100); });

      expect(screen.getByRole('region')).toBeInTheDocument();
    });

    it('shows the banner without the pre-show delay', () => {
      mockCanInstall.mockReturnValue(true);
      mockInstallIntent.mockReturnValue(true);

      render(<InstallPrompt />, { withProviders: false });

      // No timer advanced. The 1s delay exists to keep the banner from
      // flashing past on a page load nobody asked it to appear on; a visitor
      // who just tapped "Install on your phone" is watching for it.
      expect(screen.getByRole('region')).toBeInTheDocument();
    });

    it('shows the browser own steps when no beforeinstallprompt was captured', () => {
      mockCanInstall.mockReturnValue(false);
      mockInstallIntent.mockReturnValue(true);
      mockManualInstallPlatform.mockReturnValue('ios');

      render(<InstallPrompt />, { withProviders: false });

      expect(screen.getByRole('region')).toBeInTheDocument();
      expect(screen.getByText('pwa.manualInstall.ios')).toBeInTheDocument();
    });

    it('offers no install button in the manual card', () => {
      mockCanInstall.mockReturnValue(false);
      mockInstallIntent.mockReturnValue(true);
      mockManualInstallPlatform.mockReturnValue('ios');

      render(<InstallPrompt />, { withProviders: false });

      // There is no captured event to fire, so a button that reads "Install
      // app" would do nothing but report a failure.
      expect(screen.queryByText('pwa.install')).not.toBeInTheDocument();
      expect(screen.getByText('pwa.manualInstall.title')).toBeInTheDocument();
    });

    it('names the steps of the browser it was told about', () => {
      mockCanInstall.mockReturnValue(false);
      mockInstallIntent.mockReturnValue(true);
      mockManualInstallPlatform.mockReturnValue('firefoxWindows');

      render(<InstallPrompt />, { withProviders: false });

      expect(
        screen.getByText('pwa.manualInstall.firefoxWindows'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('pwa.manualInstall.ios'),
      ).not.toBeInTheDocument();
    });

    it('prefers the native prompt over the steps once the event arrives', () => {
      mockCanInstall.mockReturnValue(true);
      mockInstallIntent.mockReturnValue(true);
      mockManualInstallPlatform.mockReturnValue('generic');

      render(<InstallPrompt />, { withProviders: false });

      // One tap beats a list of instructions whenever the browser offers one.
      expect(
        screen.queryByText('pwa.manualInstall.generic'),
      ).not.toBeInTheDocument();
      expect(screen.getAllByText('pwa.install').length).toBeGreaterThanOrEqual(2);
    });

    it('can be dismissed like the banner', async () => {
      mockCanInstall.mockReturnValue(false);
      mockInstallIntent.mockReturnValue(true);
      mockManualInstallPlatform.mockReturnValue('ios');

      render(<InstallPrompt />, { withProviders: false });
      const gotIt = screen.getByText('pwa.manualInstall.gotIt');
      await act(async () => { gotIt.click(); });
      await act(async () => { vi.advanceTimersByTime(400); });

      expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });

    it('renders nothing at all when the app is already installed', async () => {
      const { toast } = await import('sonner');
      mockCanInstall.mockReturnValue(false);
      mockIsInstalled.mockReturnValue(true);
      mockInstallIntent.mockReturnValue(true);
      mockManualInstallPlatform.mockReturnValue('ios');

      const { container } = render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(1100); });

      // Nothing is left to ask for, so neither the steps…
      expect(container.innerHTML).toBe('');
      /*
        …nor the success toast, which belongs to an install that happened here.
        `isInstalled` is true from the first render whenever the app is *opened*
        as an app — `matchMedia('(display-mode: standalone)')` — so firing on
        that alone congratulated the visitor on every single launch.
      */
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });
  });
});
