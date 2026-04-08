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

import { InstallPrompt } from '../InstallPrompt';

describe('InstallPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockCanInstall.mockReturnValue(false);
    mockInstall.mockResolvedValue(true);
    mockIsInstalling.mockReturnValue(false);
    mockIsInstalled.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
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
});
