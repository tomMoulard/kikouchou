/**
 * @fileoverview The install nudge: phones, shared trips, browser tabs — only.
 *
 * @module components/pwa/__tests__/InstallNudgeCard.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { InstallNudgeCard } from '../InstallNudgeCard';
import { useInstallPromptState } from '@/contexts/InstallPromptContext';
import { usePhoneViewport } from '@/hooks/usePhoneViewport';
import { captureEvent } from '@/lib/posthog';
import type { Trip } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        return fallback;
      }
      const options = fallback ?? {};
      const template = options.defaultValue;
      if (typeof template !== 'string') {
        return key;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options[name] ?? ''),
      );
    },
  }),
}));

vi.mock('@/contexts/InstallPromptContext', () => ({ useInstallPromptState: vi.fn() }));
vi.mock('@/hooks/usePhoneViewport', () => ({ usePhoneViewport: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
// One spy behind both shapes — see `TripLinkPage.test.tsx`.
vi.mock('@/lib/posthog', () => {
  const capture = vi.fn();
  return {
    default: { capture },
    captureEvent: capture,
  // Named export used by every catch block that reports; a mock
  // without it makes the reporter itself the error under test.
  reportError: vi.fn(),
  };
});

const mockedState = vi.mocked(useInstallPromptState);
const mockedPhone = vi.mocked(usePhoneViewport);
const capture = vi.mocked(captureEvent);

const install = vi.fn(async () => true);

function installState(
  overrides: Partial<ReturnType<typeof useInstallPromptState>> = {},
): void {
  mockedState.mockReturnValue({
    canInstall: true,
    isInstalled: false,
    isInstalling: false,
    installIntent: false,
    install,
    ...overrides,
  });
}

const VIEWER_TRIP = {
  id: 'trip-1',
  name: 'Brittany',
  viewerToken: 'tokentokentoken1',
} as unknown as Trip;

const MEMBER_TRIP = {
  id: 'trip-2',
  name: 'Alps',
  remoteTripId: 'remote-2',
} as unknown as Trip;

const LOCAL_TRIP = { id: 'trip-3', name: 'Only here' } as unknown as Trip;

/** A working `localStorage`: Node's experimental global shadows jsdom's. */
const stored = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
    removeItem: (key: string) => {
      stored.delete(key);
    },
    clear: () => stored.clear(),
    key: () => null,
    length: 0,
  },
});

beforeEach(() => {
  stored.clear();
  vi.clearAllMocks();
  install.mockResolvedValue(true);
  mockedPhone.mockReturnValue(true);
  installState();
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Tests
// ============================================================================

describe('InstallNudgeCard', () => {
  it('pitches reminders for a shared trip on a phone', () => {
    render(<InstallNudgeCard trip={VIEWER_TRIP} />);

    expect(screen.getByTestId('install-nudge-card')).toBeInTheDocument();
    expect(screen.getByText(/remind you before Brittany starts/)).toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith('install_nudge_shown', {
      trip_access: 'viewer',
    });
  });

  it('stays off a laptop', () => {
    mockedPhone.mockReturnValue(false);

    const { container } = render(<InstallNudgeCard trip={VIEWER_TRIP} />);

    // Nobody installs a web app on a desktop.
    expect(container).toBeEmptyDOMElement();
    expect(capture).not.toHaveBeenCalled();
  });

  it('stays out of the installed app', () => {
    installState({ isInstalled: true });

    const { container } = render(<InstallNudgeCard trip={VIEWER_TRIP} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('says nothing about a trip that lives on this device only', () => {
    const { container } = render(<InstallNudgeCard trip={LOCAL_TRIP} />);

    // Nothing will ever be sent about it, so there is no reminder to promise.
    expect(container).toBeEmptyDOMElement();
  });

  it('fires the browser prompt where one was captured', async () => {
    const user = userEvent.setup();
    render(<InstallNudgeCard trip={MEMBER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Install app' }));

    expect(install).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('install_nudge_accepted');
  });

  it('stays away where the browser captured no prompt', () => {
    installState({ canInstall: false });

    const { container } = render(<InstallNudgeCard trip={VIEWER_TRIP} />);

    // An iPhone, or Firefox. There is no prompt to fire, and a card whose only
    // button reads "find Add to Home Screen in a menu" is homework, not an
    // offer to install.
    expect(container).toBeEmptyDOMElement();
    expect(capture).not.toHaveBeenCalled();
  });

  it('goes away for 30 days on "Not now"', async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(<InstallNudgeCard trip={VIEWER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(container).toBeEmptyDOMElement();
    expect(capture).toHaveBeenCalledWith('install_nudge_dismissed');
    unmount();

    const { container: again } = render(<InstallNudgeCard trip={VIEWER_TRIP} />);
    expect(again).toBeEmptyDOMElement();
  });

  it('comes back once the dismissal has aged out', () => {
    stored.set(
      'kikouchou-install-nudge-dismissed',
      String(Date.now() - 31 * 24 * 60 * 60 * 1000),
    );

    render(<InstallNudgeCard trip={VIEWER_TRIP} />);

    expect(screen.getByTestId('install-nudge-card')).toBeInTheDocument();
  });
});
