/**
 * @fileoverview Tests for the ride-alert settings card.
 *
 * The card exists so that `Notification.requestPermission()` is never called on
 * load, and so that the one state the app cannot undo is explained rather than
 * retried. Both are asserted here; jsdom ships no `Notification`, so each test
 * installs the browser it wants to describe.
 *
 * @module features/settings/components/__tests__/NotificationSettings.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act, render, screen, userEvent, waitFor } from '@/test/utils';

import { NotificationSettings } from '../NotificationSettings';
import { useTripContext } from '@/contexts/TripContext';
import { disableTripReminders, getReminderState } from '@/lib/notifications/push';

// The card now also reports the server-sent reminders for the trip on screen.
vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('@/lib/notifications/push', () => ({
  getReminderState: vi.fn(() => 'unsupported'),
  disableTripReminders: vi.fn(async () => true),
}));
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(async () => ({}) as never),
}));

const mockedUseTripContext = vi.mocked(useTripContext);
const mockedReminderState = vi.mocked(getReminderState);
const mockedDisable = vi.mocked(disableTripReminders);

const SHARED_TRIP = { id: 'trip-1', name: 'Brittany', viewerToken: 'tokentokentoken1' };

// ============================================================================
// Helpers
// ============================================================================

interface NotificationStub {
  permission: unknown;
  requestPermission?: () => unknown;
}

function installNotification(stub: NotificationStub): NotificationStub {
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    writable: true,
    value: stub,
  });

  return stub;
}

// ============================================================================
// Tests
// ============================================================================

describe('NotificationSettings', () => {
  beforeEach(() => {
    mockedUseTripContext.mockReturnValue({ currentTrip: null } as never);
    mockedReminderState.mockReturnValue('unsupported');
    mockedDisable.mockClear();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'Notification');
    vi.restoreAllMocks();
  });

  it('never asks for permission just by rendering', () => {
    const stub = installNotification({
      permission: 'default',
      requestPermission: vi.fn(() => Promise.resolve('granted')),
    });

    render(<NotificationSettings />, { withProviders: false });

    // The whole reason this card exists: an unprompted dialog is how a PWA
    // gets its notifications denied forever.
    expect(stub.requestPermission).not.toHaveBeenCalled();
  });

  it('states what will be sent, and that only the driver hears it', () => {
    installNotification({ permission: 'default' });

    render(<NotificationSettings />, { withProviders: false });

    expect(screen.getByText('notifications.leaveItem')).toBeInTheDocument();
    expect(screen.getByText('notifications.movedItem')).toBeInTheDocument();
    expect(screen.getByText('notifications.onlyDriver')).toBeInTheDocument();
  });

  it('offers the opt-in and asks once it is clicked', async () => {
    const user = userEvent.setup(),
      stub = installNotification({
        permission: 'default',
        requestPermission: vi.fn(() => {
          stub.permission = 'granted';

          return Promise.resolve('granted');
        }),
      });

    render(<NotificationSettings />, { withProviders: false });

    expect(screen.getByText('notifications.states.default')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /notifications\.enable/ }));

    expect(stub.requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText('notifications.states.granted')).toBeInTheDocument();
    });
  });

  it('explains a denial instead of offering a retry', async () => {
    const stub = installNotification({
      permission: 'denied',
      requestPermission: vi.fn(() => Promise.resolve('denied')),
    });

    render(<NotificationSettings />, { withProviders: false });

    expect(screen.getByText('notifications.states.denied')).toBeInTheDocument();
    expect(screen.getByText('notifications.deniedHint')).toBeInTheDocument();
    // A retry button would look broken: browsers reject a request made after a
    // denial immediately and silently. There must not be one.
    expect(
      screen.queryByRole('button', { name: /notifications\.enable/ }),
    ).not.toBeInTheDocument();
    expect(stub.requestPermission).not.toHaveBeenCalled();
  });

  it('says so, without a button, on a browser that cannot notify', () => {
    // No stub installed: jsdom is the browser here, and so is iOS Safari
    // outside a Home Screen install.
    render(<NotificationSettings />, { withProviders: false });

    expect(
      screen.getByText('notifications.states.unsupported'),
    ).toBeInTheDocument();
    expect(screen.getByText('notifications.unsupportedHint')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /notifications\.enable/ }),
    ).not.toBeInTheDocument();
  });

  it('admits the best-effort delivery once alerts are on', () => {
    installNotification({ permission: 'granted' });

    render(<NotificationSettings />, { withProviders: false });

    expect(screen.getByText('notifications.states.granted')).toBeInTheDocument();
    expect(screen.getByText('notifications.bestEffort')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /notifications\.enable/ }),
    ).not.toBeInTheDocument();
  });

  it('says nothing about trip reminders when no trip is on screen', () => {
    installNotification({ permission: 'granted' });

    render(<NotificationSettings />, { withProviders: false });

    expect(screen.queryByTestId('trip-reminders-settings')).not.toBeInTheDocument();
  });

  it('reports the reminders as on for the trip on screen, and turns them off', async () => {
    installNotification({ permission: 'granted' });
    mockedUseTripContext.mockReturnValue({ currentTrip: SHARED_TRIP } as never);
    mockedReminderState.mockReturnValue('on');
    const user = userEvent.setup();

    render(<NotificationSettings />, { withProviders: false });

    const block = screen.getByTestId('trip-reminders-settings');
    expect(block).toHaveTextContent('reminders.settingsOn');

    await user.click(screen.getByRole('button', { name: /reminders\.turnOff/ }));

    await waitFor(() => {
      expect(mockedDisable).toHaveBeenCalledWith(expect.anything(), 'trip-1');
    });
    // The storage record is gone; the block reads back as off without a reload.
    expect(block).toHaveTextContent('reminders.settingsOff');
    expect(screen.queryByRole('button', { name: /reminders\.turnOff/ })).not.toBeInTheDocument();
  });

  it('points an unsupported browser at the Home Screen for reminders', () => {
    mockedUseTripContext.mockReturnValue({ currentTrip: SHARED_TRIP } as never);
    mockedReminderState.mockReturnValue('unsupported');

    render(<NotificationSettings />, { withProviders: false });

    expect(screen.getByTestId('trip-reminders-settings')).toHaveTextContent(
      'reminders.settingsUnsupported',
    );
    expect(screen.queryByRole('button', { name: /reminders\.turnOff/ })).not.toBeInTheDocument();
  });

  it('re-reads the permission when the tab comes back', async () => {
    // Turning notifications back on happens in the browser's own site
    // settings, and nothing in the page is told when it does — so a card that
    // only read on mount would keep claiming "Blocked" afterwards.
    const stub = installNotification({ permission: 'denied' });

    render(<NotificationSettings />, { withProviders: false });
    expect(screen.getByText('notifications.states.denied')).toBeInTheDocument();

    stub.permission = 'granted';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(screen.getByText('notifications.states.granted')).toBeInTheDocument();
    });
  });
});
