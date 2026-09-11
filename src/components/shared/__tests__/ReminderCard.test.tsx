/**
 * @fileoverview The reminder card: the offer, the click, and what it says back.
 *
 * @module components/shared/__tests__/ReminderCard.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ReminderCard } from '../ReminderCard';
import { useAuth } from '@/features/auth/AuthContext';
import { resolveTripIdentity } from '@/lib/identity/trip-identity';
import { notify } from '@/lib/notifications';
import { enableTripReminders, getReminderState } from '@/lib/notifications/push';
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
vi.mock('@/lib/posthog', () => {
  const capture = vi.fn();
  return {
    default: { capture, get_distinct_id: () => 'ph-device' },
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
  mockedUseAuth.mockReturnValue({ user: null, isAvailable: true, isResolved: true } as never);
  mockedIdentity.mockResolvedValue({ personId: 'person-alice', source: 'shareLink' } as never);
  mockedState.mockReturnValue('off');
  mockedEnable.mockResolvedValue({ status: 'enabled' });
});

// ============================================================================
// Tests
// ============================================================================

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
