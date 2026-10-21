/**
 * @fileoverview The reminder card: the offer, the click, and what it says back.
 *
 * @module components/shared/__tests__/ReminderCard.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useAuth } from '@/features/auth/AuthContext';
import { resolveTripIdentity } from '@/lib/identity/trip-identity';
import { notify } from '@/lib/notifications';
import { enableTripReminders, getReminderState } from '@/lib/notifications/push';
import { captureEvent } from '@/lib/posthog';
import type { Trip } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

/**
 * Prints the English fallback, so the card reads as it does in English, and
 * records the key it was asked for, so a test can tell which string was meant.
 */
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
  useTranslation: () => ({
    t: translate,
    i18n: { language: 'fr' },
  }),
}));

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/identity/trip-identity', () => ({ resolveTripIdentity: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/notifications/push', () => ({
  enableTripReminders: vi.fn(),
  getReminderState: vi.fn(),
}));
// One spy behind both shapes: the card captures through `captureEvent` and
// still reads the distinct id off the client.
// The client is a getter so a test can take it away: without a PostHog key
// the default export is undefined.
const { posthogState } = vi.hoisted(() => ({ posthogState: { configured: true } }));
vi.mock('@/lib/posthog', () => {
  const capture = vi.fn();
  const client = { capture, get_distinct_id: () => 'ph-device' };
  return {
    get default() {
      return posthogState.configured ? client : undefined;
    },
    captureEvent: capture,
  // Named export used by every catch block that reports; a mock
  // without it makes the reporter itself the error under test.
  reportError: vi.fn(),
  };
});
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(async () => ({}) as never),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedIdentity = vi.mocked(resolveTripIdentity);
const mockedEnable = vi.mocked(enableTripReminders);
const mockedState = vi.mocked(getReminderState);
const capture = vi.mocked(captureEvent);

const VIEWER_TRIP = {
  id: 'trip-1',
  name: 'Brittany',
  shareId: 'share-1',
  viewerToken: 'tokentokentoken1',
} as unknown as Trip;

const LOCAL_TRIP = { id: 'trip-3', name: 'Only here', shareId: 'share-3' } as unknown as Trip;

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
  posthogState.configured = true;
  mockedUseAuth.mockReturnValue({ user: null, isAvailable: true, isResolved: true } as never);
  mockedIdentity.mockResolvedValue({ personId: 'person-alice', source: 'shareLink' } as never);
  mockedState.mockReturnValue('off');
  mockedEnable.mockResolvedValue({ status: 'enabled' });
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
let ReminderCard: typeof import('../ReminderCard').ReminderCard;

beforeEach(async () => {
  ({ ReminderCard } = await import('../ReminderCard'));
});

describe('ReminderCard load-time constants', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps "Not now" under a key for the trip, for thirty days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 10, 12));
    const day = 24 * 60 * 60 * 1000;
    const key = 'kikouchou-reminder-card-dismissed:trip-1';

    const user = userEvent.setup();
    const { unmount } = render(<ReminderCard trip={VIEWER_TRIP} />);
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect([...stored.keys()]).toEqual([key]);
    unmount();

    stored.set(key, String(Date.now() - 29 * day));
    const hidden = render(<ReminderCard trip={VIEWER_TRIP} />);
    expect(hidden.container).toBeEmptyDOMElement();
    hidden.unmount();

    stored.set(key, String(Date.now() - 30 * day));
    expect(render(<ReminderCard trip={VIEWER_TRIP} />).container).not.toBeEmptyDOMElement();
  });
});

describe('ReminderCard', () => {
  it('offers reminders for a shared trip and says exactly what will be sent', () => {
    render(<ReminderCard trip={VIEWER_TRIP} />);

    expect(screen.getByTestId('reminder-card')).toBeInTheDocument();
    expect(screen.getByText(/Brittany: a nudge the evening before it starts/)).toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith('reminder_card_shown', { trip_access: 'viewer' });
    // Nothing asked until the click.
    expect(mockedEnable).not.toHaveBeenCalled();
  });

  it('has nothing to offer for a trip that lives on this device only', () => {
    const { container } = render(<ReminderCard trip={LOCAL_TRIP} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('stays away once reminders are on, and where a push cannot arrive', () => {
    mockedState.mockReturnValue('on');
    expect(render(<ReminderCard trip={VIEWER_TRIP} />).container).toBeEmptyDOMElement();

    mockedState.mockReturnValue('unsupported');
    expect(render(<ReminderCard trip={VIEWER_TRIP} />).container).toBeEmptyDOMElement();

    mockedState.mockReturnValue('blocked');
    // Settings explains a blocked permission; the nudge does not nag about it.
    expect(render(<ReminderCard trip={VIEWER_TRIP} />).container).toBeEmptyDOMElement();
  });

  it('turns reminders on from the click, as the guest this device is, in the UI language', async () => {
    const user = userEvent.setup();
    render(<ReminderCard trip={VIEWER_TRIP} />);

    mockedState.mockReturnValue('on');
    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));

    await waitFor(() => {
      expect(mockedEnable).toHaveBeenCalledWith(expect.anything(), VIEWER_TRIP, {
        personId: 'person-alice',
        locale: 'fr',
        analyticsId: 'ph-device',
      });
    });
    expect(notify.success).toHaveBeenCalledWith('Reminders are on for this trip');
    expect(capture).toHaveBeenCalledWith('reminders_enable_result', {
      outcome: 'enabled',
      trip_access: 'viewer',
      has_person: true,
    });
    // The card has said its piece.
    expect(screen.queryByTestId('reminder-card')).not.toBeInTheDocument();
  });

  it('explains a blocked permission in place', async () => {
    mockedEnable.mockResolvedValue({ status: 'blocked' });
    const user = userEvent.setup();
    render(<ReminderCard trip={VIEWER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent(/blocking notifications/);
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('explains a dead invite the way the join page does', async () => {
    mockedEnable.mockResolvedValue({ status: 'expired' });
    const user = userEvent.setup();
    render(<ReminderCard trip={VIEWER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent(/has expired/);
  });

  it('says nothing when the dialog was simply dismissed', async () => {
    mockedEnable.mockResolvedValue({ status: 'dismissed' });
    const user = userEvent.setup();
    render(<ReminderCard trip={VIEWER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));

    await waitFor(() => {
      expect(mockedEnable).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on reminders' })).toBeEnabled();
  });

  it('goes away for 30 days on "Not now", for this trip', async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(<ReminderCard trip={VIEWER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(container).toBeEmptyDOMElement();
    expect(capture).toHaveBeenCalledWith('reminder_card_dismissed');
    unmount();

    expect(render(<ReminderCard trip={VIEWER_TRIP} />).container).toBeEmptyDOMElement();
    // Another shared trip is a fresh offer.
    const other = { ...VIEWER_TRIP, id: 'trip-2', name: 'Alps' } as Trip;
    expect(render(<ReminderCard trip={other} />).container).not.toBeEmptyDOMElement();
  });
});

// ============================================================================
// More of the card
// ============================================================================

const MEMBER_TRIP = {
  id: 'trip-m',
  name: 'Lisbon',
  shareId: 'share-m',
  remoteTripId: 'remote-m',
} as unknown as Trip;

const DAY_MS = 24 * 60 * 60 * 1000;
const DISMISSAL_KEY = 'kikouchou-reminder-card-dismissed:trip-1';

/** Sets what `document.visibilityState` reads, for this test only. */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

describe('ReminderCard dismissal window', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores when "Not now" was pressed, under a key for the trip', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 10, 12));
    const user = userEvent.setup();
    render(<ReminderCard trip={VIEWER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(stored.get(DISMISSAL_KEY)).toBe(String(Date.now()));
  });

  it('stays hidden for 29 days and comes back on day 30', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 10, 12));

    stored.set(DISMISSAL_KEY, String(Date.now() - 29 * DAY_MS));
    expect(render(<ReminderCard trip={VIEWER_TRIP} />).container).toBeEmptyDOMElement();

    stored.set(DISMISSAL_KEY, String(Date.now() - 30 * DAY_MS));
    expect(render(<ReminderCard trip={VIEWER_TRIP} />).container).not.toBeEmptyDOMElement();

    stored.set(DISMISSAL_KEY, String(Date.now() - 31 * DAY_MS));
    expect(render(<ReminderCard trip={VIEWER_TRIP} />).container).not.toBeEmptyDOMElement();
  });

  it('treats an unreadable dismissal as none', () => {
    stored.set(DISMISSAL_KEY, 'not-a-time');

    expect(render(<ReminderCard trip={VIEWER_TRIP} />).container).not.toBeEmptyDOMElement();
  });

  it('still offers the card, and still hides it on "Not now", when storage refuses', async () => {
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const user = userEvent.setup();
    const { container } = render(<ReminderCard trip={VIEWER_TRIP} />);
    expect(container).not.toBeEmptyDOMElement();

    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(container).toBeEmptyDOMElement();
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('remembers "Not now" for the trip it is showing now', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReminderCard trip={VIEWER_TRIP} />);
    const other = { ...VIEWER_TRIP, id: 'trip-2' } as Trip;
    rerender(<ReminderCard trip={other} />);

    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(stored.has('kikouchou-reminder-card-dismissed:trip-2')).toBe(true);
    expect(stored.has(DISMISSAL_KEY)).toBe(false);
  });
});

describe('ReminderCard for a member trip', () => {
  it('offers reminders for a trip the account syncs, as a member', () => {
    render(<ReminderCard trip={MEMBER_TRIP} />);

    expect(screen.getByTestId('reminder-card')).toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith('reminder_card_shown', { trip_access: 'member' });
  });

  it('reports the outcome as a member, and whether a guest was found', async () => {
    mockedIdentity.mockResolvedValue({ personId: undefined, source: 'none' } as never);
    const user = userEvent.setup();
    render(<ReminderCard trip={MEMBER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));

    await waitFor(() => {
      expect(capture).toHaveBeenCalledWith('reminders_enable_result', {
        outcome: 'enabled',
        trip_access: 'member',
        has_person: false,
      });
    });
  });

  it('does not count a card it is not showing', () => {
    render(<ReminderCard trip={LOCAL_TRIP} />);

    expect(capture).not.toHaveBeenCalledWith('reminder_card_shown', expect.anything());
  });
});

describe('ReminderCard and the browser coming back', () => {
  afterEach(() => {
    // The stub is an own property shadowing jsdom's getter; removing it hands
    // the document back its real visibility.
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('re-reads the permission when the tab is shown again', () => {
    render(<ReminderCard trip={VIEWER_TRIP} />);
    expect(screen.getByTestId('reminder-card')).toBeInTheDocument();

    mockedState.mockReturnValue('on');
    setVisibility('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(screen.queryByTestId('reminder-card')).not.toBeInTheDocument();
  });

  it('does not re-read while the tab is hidden', () => {
    render(<ReminderCard trip={VIEWER_TRIP} />);
    mockedState.mockClear();

    setVisibility('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockedState).not.toHaveBeenCalled();
    expect(screen.getByTestId('reminder-card')).toBeInTheDocument();
  });

  it('re-reads for the trip it is showing now, and stops listening once gone', () => {
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const { rerender, unmount } = render(<ReminderCard trip={VIEWER_TRIP} />);
    const other = { ...VIEWER_TRIP, id: 'trip-2' } as Trip;
    rerender(<ReminderCard trip={other} />);
    mockedState.mockClear();

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mockedState).toHaveBeenCalledWith('trip-2');
    expect(mockedState).not.toHaveBeenCalledWith('trip-1');

    unmount();
    expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('counts the card when a permission change brings it back', () => {
    mockedState.mockReturnValue('on');
    render(<ReminderCard trip={VIEWER_TRIP} />);
    expect(capture).not.toHaveBeenCalledWith('reminder_card_shown', expect.anything());

    mockedState.mockReturnValue('off');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(capture).toHaveBeenCalledWith('reminder_card_shown', { trip_access: 'viewer' });
  });
});

describe('ReminderCard answers', () => {
  const ANSWERS = [
    ['not-found', 'sharing.join.notFound', "This invite link isn't valid."],
    ['revoked', 'sharing.join.revoked', 'This invite link has been withdrawn.'],
    ['expired', 'sharing.join.expired', 'This invite link has expired.'],
    ['exhausted', 'sharing.join.exhausted', 'This invite link has been used up.'],
    ['unauthenticated', 'reminders.signInFirst', 'Sign in first, then turn reminders on.'],
    ['not-a-member', 'reminders.signInFirst', 'Sign in first, then turn reminders on.'],
    ['unsupported', 'reminders.failed', 'Reminders could not be turned on. Try again in a moment.'],
    ['error', 'reminders.failed', 'Reminders could not be turned on. Try again in a moment.'],
    [
      'blocked',
      'reminders.blocked',
      'Your browser is blocking notifications for Kikouchou. Allow them in your browser or system settings, then try again.',
    ],
  ] as const;

  for (const [status, key, text] of ANSWERS) {
    it(`explains "${status}" in its own words`, async () => {
      mockedEnable.mockResolvedValue(
        (status === 'error' ? { status, message: 'boom' } : { status }) as never,
      );
      const user = userEvent.setup();
      render(<ReminderCard trip={VIEWER_TRIP} />);

      await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(text);
      expect(alert).toHaveClass('mt-2', 'flex', 'items-start', 'gap-2', 'text-sm', 'text-destructive');
      expect(alert.querySelector('svg')).toHaveClass('mt-0.5', 'size-4', 'shrink-0');
      expect(translate).toHaveBeenCalledWith(key, text);
    });
  }

  it('has nothing to explain once reminders are on', async () => {
    const user = userEvent.setup();
    render(<ReminderCard trip={VIEWER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));

    await waitFor(() => {
      expect(notify.success).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(translate).toHaveBeenCalledWith('reminders.enabled', 'Reminders are on for this trip');
  });

  it('says it is waiting while the browser asks, and clears the last problem', async () => {
    mockedEnable.mockResolvedValueOnce({ status: 'blocked' });
    const user = userEvent.setup();
    render(<ReminderCard trip={VIEWER_TRIP} />);
    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));
    await screen.findByRole('alert');

    let answer: (result: { status: 'dismissed' }) => void = () => undefined;
    mockedEnable.mockImplementationOnce(
      () => new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));

    const waiting = screen.getByRole('button', { name: 'Waiting for your answer…' });
    expect(waiting).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(translate).toHaveBeenCalledWith('reminders.enabling', 'Waiting for your answer…');

    await waitFor(() => {
      expect(mockedEnable).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      answer({ status: 'dismissed' });
    });
    expect(screen.getByRole('button', { name: 'Turn on reminders' })).toBeEnabled();
  });

  it('says reminders failed when there is no server to ask', async () => {
    const { getSupabaseClient } = await import('@/lib/supabase/client');
    vi.mocked(getSupabaseClient).mockResolvedValueOnce(null as never);
    const user = userEvent.setup();
    render(<ReminderCard trip={VIEWER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent(
      'Reminders could not be turned on. Try again in a moment.',
    );
    expect(mockedEnable).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Turn on reminders' })).toBeEnabled();
    expect(translate).toHaveBeenCalledWith('reminders.failed', expect.any(String));
  });

  it('says reminders failed, and logs why, when turning them on throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('push service down');
    mockedEnable.mockRejectedValueOnce(failure);
    const user = userEvent.setup();
    render(<ReminderCard trip={VIEWER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));

    await expect(screen.findByRole('alert')).resolves.toHaveTextContent(
      'Reminders could not be turned on. Try again in a moment.',
    );
    expect(consoleError).toHaveBeenCalledWith('Failed to turn on trip reminders:', failure);
    expect(translate).toHaveBeenCalledWith('reminders.failed', expect.any(String));
    consoleError.mockRestore();
  });

  it('reports nothing about an answer that arrives after the card is gone', async () => {
    let answer: (result: { status: 'enabled' }) => void = () => undefined;
    mockedEnable.mockImplementationOnce(
      () => new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const user = userEvent.setup();
    const { unmount } = render(<ReminderCard trip={VIEWER_TRIP} />);
    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));
    await waitFor(() => {
      expect(mockedEnable).toHaveBeenCalledTimes(1);
    });

    unmount();
    await act(async () => {
      answer({ status: 'enabled' });
    });

    expect(capture).not.toHaveBeenCalledWith('reminders_enable_result', expect.anything());
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('asks as the account signed in now', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ReminderCard trip={VIEWER_TRIP} />);
    mockedUseAuth.mockReturnValue({ user: { id: 'account-2' }, isAvailable: true, isResolved: true } as never);
    rerender(<ReminderCard trip={{ ...VIEWER_TRIP } as Trip} />);

    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));

    await waitFor(() => {
      expect(mockedIdentity).toHaveBeenCalledWith(expect.objectContaining({ id: 'trip-1' }), 'account-2');
    });
  });

  it('turns reminders on without an analytics id when PostHog is not configured', async () => {
    posthogState.configured = false;
    const user = userEvent.setup();
    render(<ReminderCard trip={VIEWER_TRIP} />);

    await user.click(screen.getByRole('button', { name: 'Turn on reminders' }));

    await waitFor(() => {
      expect(mockedEnable).toHaveBeenCalledWith(expect.anything(), VIEWER_TRIP, {
        personId: 'person-alice',
        locale: 'fr',
        analyticsId: undefined,
      });
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ReminderCard words and frame', () => {
  it('names its region and its parts', () => {
    render(<ReminderCard trip={VIEWER_TRIP} className="extra" />);

    const region = screen.getByRole('region', { name: 'Trip reminders' });
    expect(region).toHaveClass('border-primary/20', 'extra');
    expect(translate).toHaveBeenCalledWith('reminders.region', 'Trip reminders');
    expect(screen.getByText('Get a reminder before the trip')).toBeInTheDocument();
    expect(translate).toHaveBeenCalledWith('reminders.title', 'Get a reminder before the trip');
    expect(translate).toHaveBeenCalledWith(
      'reminders.description',
      expect.objectContaining({ tripName: 'Brittany' }),
    );
    expect(translate).toHaveBeenCalledWith('reminders.enable', 'Turn on reminders');
    expect(translate).toHaveBeenCalledWith('pwa.notNow', 'Not now');
  });
});
