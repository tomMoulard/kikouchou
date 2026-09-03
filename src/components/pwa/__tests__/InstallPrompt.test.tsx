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
    // The component reads 'kikouchou-install-dismissed' on init and writes on dismiss.
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
      if (key === 'kikouchou-install-dismissed') return 'invalid-value';
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
      if (key === 'kikouchou-install-dismissed') return eightDaysAgo.toString();
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
});
