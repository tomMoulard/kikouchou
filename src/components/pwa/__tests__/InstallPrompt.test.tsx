import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@/test/utils';

const mockCanInstall = vi.fn(() => false);
const mockInstall = vi.fn().mockResolvedValue(true);
const mockIsInstalling = vi.fn(() => false);
const mockIsInstalled = vi.fn(() => false);
const mockInstallIntent = vi.fn(() => false);

// The banner reads the app's one install prompt through the context, which is
// where `useInstallPrompt` runs; the context is what gets doubled here.
vi.mock('@/contexts/InstallPromptContext', () => ({
  useInstallPromptState: () => ({
    canInstall: mockCanInstall(),
    install: mockInstall,
    isInstalling: mockIsInstalling(),
    isInstalled: mockIsInstalled(),
    installIntent: mockInstallIntent(),
  }),
}));

// The component talks to the notification facade, not to sonner: a success
// confirmation is an OS notification now, an error is still a toast, and the
// split lives in `src/lib/notifications/notify.ts`.
vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
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

  it('shows an error toast when install fails', async () => {
    const { notify } = await import('@/lib/notifications');
    mockCanInstall.mockReturnValue(true);
    mockInstall.mockResolvedValue(false);
    mockIsInstalled.mockReturnValue(false);
    render(<InstallPrompt />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    const installBtns = screen.getAllByText('pwa.install');
    const installBtn = installBtns.find(el => el.closest('button'))!;
    await act(async () => { installBtn.click(); });
    expect(vi.mocked(notify.error)).toHaveBeenCalled();
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

    it('answers a request raised after mount, dismissal notwithstanding', async () => {
      // Dismissed this week, nothing requested on arrival: silent.
      installMemoryStorage();
      localStorage.setItem(DISMISSAL_KEY, String(Date.now() - 60_000));
      mockCanInstall.mockReturnValue(true);
      mockInstallIntent.mockReturnValue(false);

      const { rerender } = render(<InstallPrompt className="before" />, {
        withProviders: false,
      });
      await act(async () => { vi.advanceTimersByTime(1100); });
      expect(screen.queryByRole('region')).not.toBeInTheDocument();

      // A request raised while the banner is already mounted brings it up at
      // once, and the standing dismissal does not apply — the visitor asked.
      // (A context change re-renders through `memo`; a mocked hook does not,
      // so the prop changes to stand in for it.)
      mockInstallIntent.mockReturnValue(true);
      rerender(<InstallPrompt className="after" />);
      await act(async () => { vi.advanceTimersByTime(0); });

      expect(screen.getByRole('region')).toBeInTheDocument();
    });

    it('stays silent when no beforeinstallprompt was captured', async () => {
      // An iPhone, or Firefox: `beforeinstallprompt` is Chromium's alone, so
      // there is nothing to fire. The banner used to answer that with a list
      // of menu steps. A list of steps is not an install button, so now the
      // request goes unanswered rather than half-answered.
      mockCanInstall.mockReturnValue(false);
      mockInstallIntent.mockReturnValue(true);

      const { container } = render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(1100); });

      expect(container.innerHTML).toBe('');
    });

    it('renders nothing at all when the app is already installed', async () => {
      const { notify } = await import('@/lib/notifications');
      mockCanInstall.mockReturnValue(false);
      mockIsInstalled.mockReturnValue(true);
      mockInstallIntent.mockReturnValue(true);

      const { container } = render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(1100); });

      // Nothing is left to ask for, so neither the card…
      expect(container.innerHTML).toBe('');
      /*
        …nor the confirmation, which belongs to an install that happened here.
        `isInstalled` is true from the first render whenever the app is *opened*
        as an app — `matchMedia('(display-mode: standalone)')` — so firing on
        that alone congratulated the visitor on every single launch.
      */
      expect(vi.mocked(notify.success)).not.toHaveBeenCalled();
    });
  });

  describe('while a trip is being created', () => {
    it('stays hidden on the trip creation form', async () => {
      mockCanInstall.mockReturnValue(true);
      const { container } = render(<InstallPrompt suppressed />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(5000); });
      expect(container.innerHTML).toBe('');
    });

    it('hides at once when the form opens over a visible card', async () => {
      mockCanInstall.mockReturnValue(true);
      const { rerender } = render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(1100); });
      expect(screen.getByRole('region')).toBeInTheDocument();

      rerender(<InstallPrompt suppressed />);
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });

    it('comes back after the usual delay once the form is left', async () => {
      mockCanInstall.mockReturnValue(true);
      const { rerender } = render(<InstallPrompt suppressed />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(5000); });

      rerender(<InstallPrompt />);
      // Not on the very frame the trip page appears: the delay starts again.
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(1100); });
      expect(screen.getByRole('region')).toBeInTheDocument();
    });

    it('does not write a dismissal', async () => {
      mockCanInstall.mockReturnValue(true);
      render(<InstallPrompt suppressed />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(5000); });
      expect(localStorage.getItem(DISMISSAL_KEY)).toBeNull();
    });

    it('waits the usual delay again after hiding a visible card for the form', async () => {
      mockCanInstall.mockReturnValue(true);
      const { rerender } = render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(1100); });
      expect(screen.getByRole('region')).toBeInTheDocument();

      rerender(<InstallPrompt suppressed />);
      rerender(<InstallPrompt />);

      expect(screen.queryByRole('region')).not.toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(1100); });
      expect(screen.getByRole('region')).toBeInTheDocument();
    });

    it('drops the pending show when the form opens before the delay is up', async () => {
      mockCanInstall.mockReturnValue(true);
      const { rerender } = render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(500); });

      rerender(<InstallPrompt suppressed />);
      await act(async () => { vi.advanceTimersByTime(600); });
      rerender(<InstallPrompt />);

      expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });

    it('never flashes the card on the frame the form is left', async () => {
      mockCanInstall.mockReturnValue(true);
      const { container, rerender } = render(<InstallPrompt suppressed />, {
        withProviders: false,
      });
      await act(async () => { vi.advanceTimersByTime(5000); });

      const added: Node[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) added.push(...record.addedNodes);
      });
      observer.observe(container, { childList: true, subtree: true });
      rerender(<InstallPrompt />);
      await act(async () => { await Promise.resolve(); });
      observer.disconnect();

      expect(added).toHaveLength(0);
    });
  });
});

describe('InstallPrompt, more of it', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    installMemoryStorage();
    mockCanInstall.mockReturnValue(true);
    mockInstall.mockResolvedValue(true);
    mockIsInstalling.mockReturnValue(false);
    mockIsInstalled.mockReturnValue(false);
    mockInstallIntent.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  async function showCard(ui = <InstallPrompt />) {
    const result = render(ui, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    return result;
  }

  it('comes back exactly seven days after a dismissal', async () => {
    localStorage.setItem(DISMISSAL_KEY, String(Date.now() - 7 * DAY_MS));

    await showCard();

    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('still offers the card when storage cannot be read', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('private mode');
    });

    await showCard();

    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('writes when it was dismissed, and hides at once without waiting for the animation', async () => {
    await showCard();

    await act(async () => { screen.getByText('pwa.notNow').click(); });

    expect(localStorage.getItem(DISMISSAL_KEY)).toBe(String(Date.now()));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('stays dismissed through a trip form opened and closed afterwards', async () => {
    const { rerender } = await showCard();
    await act(async () => { screen.getByText('pwa.notNow').click(); });
    await act(async () => { vi.advanceTimersByTime(400); });

    rerender(<InstallPrompt suppressed />);
    rerender(<InstallPrompt />);
    await act(async () => { vi.advanceTimersByTime(1100); });

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('drops the dismissal timer when it goes away first', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = await showCard();
    await act(async () => { screen.getByText('pwa.notNow').click(); });
    const index = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 300);
    const timer: unknown = setTimeoutSpy.mock.results[index]?.value;

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
  });

  it('keeps a card the visitor asked for on screen through the trip form', () => {
    mockInstallIntent.mockReturnValue(true);
    const { rerender } = render(<InstallPrompt />, { withProviders: false });
    expect(screen.getByRole('region')).toBeInTheDocument();

    rerender(<InstallPrompt suppressed />);
    rerender(<InstallPrompt />);

    // No delay: the request stands, so the card comes back with the page.
    expect(screen.getByRole('region')).toBeInTheDocument();
  });

  it('forgets a request withdrawn before it was answered', async () => {
    localStorage.setItem(DISMISSAL_KEY, String(Date.now() - 60_000));
    const { rerender } = render(<InstallPrompt className="a" />, { withProviders: false });

    mockInstallIntent.mockReturnValue(true);
    rerender(<InstallPrompt className="b" />);
    mockInstallIntent.mockReturnValue(false);
    rerender(<InstallPrompt className="c" />);
    await act(async () => { vi.advanceTimersByTime(1100); });

    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('confirms an install that happens here, then goes away', async () => {
    const { notify } = await import('@/lib/notifications');
    const { rerender } = await showCard(<InstallPrompt className="a" />);

    mockIsInstalled.mockReturnValue(true);
    rerender(<InstallPrompt className="b" />);

    expect(vi.mocked(notify.success)).toHaveBeenCalledWith('pwa.installSuccess');
    await act(async () => { vi.advanceTimersByTime(0); });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    // Gone for good, not until the next change.
    mockCanInstall.mockReturnValue(true);
    rerender(<InstallPrompt className="c" suppressed />);
    rerender(<InstallPrompt className="d" />);
    await act(async () => { vi.advanceTimersByTime(1100); });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('does not confirm an install after the card was dismissed', async () => {
    const { notify } = await import('@/lib/notifications');
    const { rerender } = await showCard(<InstallPrompt className="a" />);
    await act(async () => { screen.getByText('pwa.notNow').click(); });
    await act(async () => { vi.advanceTimersByTime(400); });

    mockIsInstalled.mockReturnValue(true);
    rerender(<InstallPrompt className="b" />);

    expect(vi.mocked(notify.success)).not.toHaveBeenCalled();
  });

  it('says nothing when the install went through', async () => {
    const { notify } = await import('@/lib/notifications');
    mockInstall.mockResolvedValue(true);
    await showCard();

    await act(async () => { screen.getAllByText('pwa.install').find(el => el.closest('button'))?.click(); });

    expect(vi.mocked(notify.error)).not.toHaveBeenCalled();
  });

  it('names the failure in the toast', async () => {
    const { notify } = await import('@/lib/notifications');
    mockInstall.mockResolvedValue(false);
    await showCard();

    await act(async () => { screen.getAllByText('pwa.install').find(el => el.closest('button'))?.click(); });

    expect(vi.mocked(notify.error)).toHaveBeenCalledWith('pwa.installFailed');
  });

  it('says nothing about a refused prompt once the app is installed anyway', async () => {
    const { notify } = await import('@/lib/notifications');
    mockInstall.mockResolvedValue(false);
    const { rerender } = await showCard(<InstallPrompt className="a" />);
    mockIsInstalled.mockReturnValue(true);
    rerender(<InstallPrompt className="b" />);

    await act(async () => { screen.getAllByText('pwa.install').find(el => el.closest('button'))?.click(); });

    expect(vi.mocked(notify.error)).not.toHaveBeenCalled();
  });

  it('labels its region and title, and slides in', async () => {
    await showCard();

    const region = screen.getByRole('region', { name: 'pwa.installPromptRegion' });
    expect(region).toHaveClass('transition-transform', 'duration-300', 'ease-out', 'translate-y-0');
    expect(region).not.toHaveClass('translate-y-full');
    const titles = screen.getAllByText('pwa.install');
    expect(titles.some(el => el.closest('button') === null)).toBe(true);
  });
});
