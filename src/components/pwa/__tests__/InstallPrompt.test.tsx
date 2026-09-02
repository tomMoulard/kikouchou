import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@/test/utils';

const mockCanInstall = vi.fn(() => false);
const mockInstall = vi.fn().mockResolvedValue(true);
const mockIsInstalling = vi.fn(() => false);
const mockIsInstalled = vi.fn(() => false);

vi.mock('@/hooks/useInstallPrompt', () => ({
  useInstallPrompt: () => ({
    canInstall: mockCanInstall(),
    install: mockInstall,
    isInstalling: mockIsInstalling(),
    isInstalled: mockIsInstalled(),
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { InstallPrompt } from '../InstallPrompt';

describe('InstallPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Spy on localStorage to prevent state leaking between tests.
    // The component reads 'kikoushou-install-dismissed' on init and writes on dismiss.
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    mockCanInstall.mockReturnValue(false);
    mockInstall.mockResolvedValue(true);
    mockIsInstalling.mockReturnValue(false);
    mockIsInstalled.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    // Spy on localStorage.getItem to return a non-numeric value
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === 'kikoushou-install-dismissed') return 'invalid-value';
      return null;
    });
    mockCanInstall.mockReturnValue(true);
    render(<InstallPrompt />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    // isDismissedRecently() returns false for NaN, so prompt should show
    expect(screen.getByRole('region')).toBeInTheDocument();
    getItemSpy.mockRestore();
  });

  it('shows prompt when dismissal timestamp is expired', async () => {
    // Spy on localStorage.getItem to return an expired timestamp
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === 'kikoushou-install-dismissed') return eightDaysAgo.toString();
      return null;
    });
    mockCanInstall.mockReturnValue(true);
    render(<InstallPrompt />, { withProviders: false });
    await act(async () => { vi.advanceTimersByTime(1100); });
    expect(screen.getByRole('region')).toBeInTheDocument();
    getItemSpy.mockRestore();
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
    it('uses the shared bottom-stack padding rather than its own arithmetic', async () => {
      mockCanInstall.mockReturnValue(true);
      render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(1100); });

      const region = screen.getByRole('region');

      // `pb-20` cleared the `h-16` nav bar and left the card body sitting on
      // the `bottom-20 size-14` FAB — 80px to 136px is exactly where a 4rem
      // bottom padding puts it. `pb-bottom-stack` is the shared rule.
      expect(region).toHaveClass('pb-bottom-stack');
      expect(region.className).not.toMatch(/\bpb-20\b/);
    });

    it('does not set bottom padding twice', async () => {
      mockCanInstall.mockReturnValue(true);
      render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(1100); });

      // `p-4` and `pb-bottom-stack` both write `padding-bottom`, and which one
      // wins is stylesheet order — not something `cn()`'s tailwind-merge can
      // resolve for a custom utility it does not know about. The gutter is
      // spelled `px-4 pt-4` so there is only ever one declaration.
      expect(screen.getByRole('region').className).not.toMatch(/\bp-4\b/);
    });

    it('keeps its buttons clickable — it is not an informational overlay', async () => {
      mockCanInstall.mockReturnValue(true);
      render(<InstallPrompt />, { withProviders: false });
      await act(async () => { vi.advanceTimersByTime(1100); });

      // `OfflineIndicator` gets `pointer-events-none` because it only informs.
      // This one has three buttons, so the only fix available to it is being
      // positioned clear of everything else on the bottom edge.
      expect(screen.getByRole('region').className).not.toMatch(/pointer-events-none/);
    });
  });
});
