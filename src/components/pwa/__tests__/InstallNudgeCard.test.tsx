/**
 * @fileoverview The install nudge: phones, shared trips, browser tabs — only.
 *
 * @module components/pwa/__tests__/InstallNudgeCard.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useInstallPromptState } from '@/contexts/InstallPromptContext';
import { usePhoneViewport } from '@/hooks/usePhoneViewport';
import { notify } from '@/lib/notifications';
import { captureEvent } from '@/lib/posthog';
import type { Trip } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

/** The English fallback on screen, and the key on record. */
const { translate } = vi.hoisted(() => ({
  translate: vi.fn((key: string, fallback?: string | Record<string, unknown>) => {
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
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
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

/**
 * Loaded inside the first test rather than at the top of the file: the
 * dismissal key and window are load-time constants, and Stryker can only test
 * a mutant in load-time code against the test that was running when the
 * module loaded.
 */
let InstallNudgeCard: typeof import('../InstallNudgeCard').InstallNudgeCard;

beforeEach(async () => {
  ({ InstallNudgeCard } = await import('../InstallNudgeCard'));
});

describe('InstallNudgeCard load-time constants', () => {
  it('keeps "Not now" under its own key, for thirty days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 10, 12));
    const day = 24 * 60 * 60 * 1000;
    const key = 'kikouchou-install-nudge-dismissed';

    const user = userEvent.setup();
    const { unmount } = render(<InstallNudgeCard trip={VIEWER_TRIP} />);
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect([...stored.keys()]).toEqual([key]);
    unmount();

    stored.set(key, String(Date.now() - 29 * day));
    const hidden = render(<InstallNudgeCard trip={VIEWER_TRIP} />);
    expect(hidden.container).toBeEmptyDOMElement();
    hidden.unmount();

    stored.set(key, String(Date.now() - 30 * day));
    expect(render(<InstallNudgeCard trip={VIEWER_TRIP} />).container).not.toBeEmptyDOMElement();
  });
});

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

describe('InstallNudgeCard, more of it', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const KEY = 'kikouchou-install-nudge-dismissed';

  it('counts the card for a member trip as a member', () => {
    render(<InstallNudgeCard trip={MEMBER_TRIP} className="extra" />);

    expect(capture).toHaveBeenCalledWith('install_nudge_shown', { trip_access: 'member' });
    const region = screen.getByRole('region', { name: 'Install suggestion' });
    expect(region).toHaveClass('border-primary/20', 'extra');
  });

  it('counts the card again when it appears later', () => {
    installState({ canInstall: false });
    const { rerender } = render(<InstallNudgeCard trip={VIEWER_TRIP} className="a" />);
    expect(capture).not.toHaveBeenCalled();

    installState({ canInstall: true });
    rerender(<InstallNudgeCard trip={VIEWER_TRIP} className="b" />);

    expect(capture).toHaveBeenCalledWith('install_nudge_shown', { trip_access: 'viewer' });
  });

  it('says so when the install does not happen', async () => {
    install.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<InstallNudgeCard trip={VIEWER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Install app' }));

    expect(notify.error).toHaveBeenCalledWith('Installation failed. Please try again.');
    expect(translate).toHaveBeenCalledWith('pwa.installFailed', 'Installation failed. Please try again.');
  });

  it('fires the prompt it holds now', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<InstallNudgeCard trip={VIEWER_TRIP} className="a" />);
    const fresh = vi.fn(async () => true);
    installState({ install: fresh });
    rerender(<InstallNudgeCard trip={VIEWER_TRIP} className="b" />);

    await user.click(screen.getByRole('button', { name: 'Install app' }));

    expect(fresh).toHaveBeenCalledTimes(1);
    expect(install).not.toHaveBeenCalled();
  });

  it('says nothing when the install goes through', async () => {
    const user = userEvent.setup();
    render(<InstallNudgeCard trip={VIEWER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Install app' }));

    expect(notify.error).not.toHaveBeenCalled();
  });

  it('writes when "Not now" was pressed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 10, 12));
    const user = userEvent.setup();
    render(<InstallNudgeCard trip={VIEWER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(stored.get(KEY)).toBe(String(Date.now()));
  });

  it('stays hidden for 29 days and comes back on day 30', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 10, 12));

    stored.set(KEY, String(Date.now() - 29 * DAY_MS));
    expect(render(<InstallNudgeCard trip={VIEWER_TRIP} />).container).toBeEmptyDOMElement();

    stored.set(KEY, String(Date.now() - 30 * DAY_MS));
    expect(render(<InstallNudgeCard trip={VIEWER_TRIP} />).container).not.toBeEmptyDOMElement();
  });

  it('treats an unreadable dismissal as none', () => {
    stored.set(KEY, 'garbage');

    expect(render(<InstallNudgeCard trip={VIEWER_TRIP} />).container).not.toBeEmptyDOMElement();
  });

  it('still offers the card, and still hides it, when storage refuses', async () => {
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const user = userEvent.setup();
    const { container } = render(<InstallNudgeCard trip={VIEWER_TRIP} />);
    expect(container).not.toBeEmptyDOMElement();

    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(container).toBeEmptyDOMElement();
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('keeps the install button dead while the browser prompt is up', () => {
    installState({ isInstalling: true });
    render(<InstallNudgeCard trip={VIEWER_TRIP} />);

    expect(screen.getByRole('button', { name: 'Install app' })).toBeDisabled();
  });

  it('asks for each string under its key', () => {
    render(<InstallNudgeCard trip={VIEWER_TRIP} />);

    expect(translate).toHaveBeenCalledWith('install.nudge.region', 'Install suggestion');
    expect(translate).toHaveBeenCalledWith('install.nudge.title', 'Get a reminder before the trip');
    expect(screen.getByText('Get a reminder before the trip')).toBeInTheDocument();
    expect(translate).toHaveBeenCalledWith(
      'install.nudge.description',
      expect.objectContaining({ tripName: 'Brittany' }),
    );
    expect(translate).toHaveBeenCalledWith('pwa.install', 'Install app');
    expect(translate).toHaveBeenCalledWith('pwa.notNow', 'Not now');
  });
});
