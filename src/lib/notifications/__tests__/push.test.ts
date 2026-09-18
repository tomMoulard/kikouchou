/**
 * @fileoverview Turning trip reminders on and off, against a stand-in browser.
 *
 * @module lib/notifications/__tests__/push.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  disableTripReminders,
  enableTripReminders,
  getReminderState,
  isPushSupported,
  readReminderSubscription,
  urlBase64ToUint8Array,
} from '@/lib/notifications/push';
import type { NotificationState } from '@/lib/notifications/permission';
import type { Trip } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

const permission = {
  request: vi.fn(async (): Promise<NotificationState> => 'granted'),
  state: 'default' as NotificationState,
};
vi.mock('@/lib/notifications/permission', () => ({
  getNotificationState: () => permission.state,
  requestNotificationPermission: () => permission.request(),
}));

const PUBLIC_KEY = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';

const stored = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    get length(): number {
      return stored.size;
    },
    clear: (): void => stored.clear(),
    getItem: (key: string): string | null => stored.get(key) ?? null,
    key: (index: number): string | null => [...stored.keys()][index] ?? null,
    removeItem: (key: string): void => {
      stored.delete(key);
    },
    setItem: (key: string, value: string): void => {
      stored.set(key, value);
    },
  },
});

const browserSubscription = {
  endpoint: 'https://push.example.test/send/abc',
  toJSON: () => ({
    endpoint: 'https://push.example.test/send/abc',
    expirationTime: null,
    keys: { p256dh: PUBLIC_KEY, auth: 'tBHItJI5svbpez7KI4CCXg' },
  }),
  unsubscribe: vi.fn(async () => true),
};

const pushManager = {
  getSubscription: vi.fn(async (): Promise<typeof browserSubscription | null> => null),
  subscribe: vi.fn(async () => browserSubscription),
};

const registration = { pushManager };

function installBrowser(): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      getRegistration: async () => registration,
    },
  });
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission: 'default' },
  });
}

function uninstallBrowser(): void {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(window, 'PushManager');
}

const rpc = vi.fn();
const client = { rpc } as never;

const VIEWER_TRIP = {
  id: 'trip-1',
  name: 'Brittany',
  viewerToken: 'tokentokentoken1',
} as unknown as Trip;

const MEMBER_TRIP = {
  id: 'trip-2',
  name: 'Alps',
  remoteTripId: 'aaaaaaaa-0000-0000-0000-000000000001',
} as unknown as Trip;

const LOCAL_TRIP = { id: 'trip-3', name: 'Only here' } as unknown as Trip;

beforeEach(() => {
  stored.clear();
  vi.clearAllMocks();
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', PUBLIC_KEY);
  permission.state = 'default';
  permission.request.mockResolvedValue('granted');
  pushManager.getSubscription.mockResolvedValue(null);
  rpc.mockResolvedValue({ data: '00000000-0000-4000-8000-000000000001', error: null });
  installBrowser();
});

afterEach(() => {
  vi.unstubAllEnvs();
  uninstallBrowser();
});

// ============================================================================
// Tests
// ============================================================================

describe('isPushSupported', () => {
  it('needs a worker, a PushManager, notifications and a VAPID key', () => {
    expect(isPushSupported()).toBe(true);

    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');
    expect(isPushSupported()).toBe(false);
  });

  it("is false in an iPhone's Safari tab, which has no PushManager", () => {
    Reflect.deleteProperty(window, 'PushManager');

    expect(isPushSupported()).toBe(false);
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes the key the way applicationServerKey wants it', () => {
    const bytes = urlBase64ToUint8Array(PUBLIC_KEY);

    // An uncompressed P-256 point: 65 bytes starting with 0x04.
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });
});

describe('enableTripReminders', () => {
  it('asks once, subscribes the browser, and registers a viewer through its token', async () => {
    const result = await enableTripReminders(client, VIEWER_TRIP, {
      personId: 'person-alice',
      locale: 'en-GB',
      analyticsId: 'ph-1',
    });

    expect(result).toEqual({ status: 'enabled' });
    expect(permission.request).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(rpc).toHaveBeenCalledWith('subscribe_trip_reminders', {
      invite_token: 'tokentokentoken1',
      subscription: browserSubscription.toJSON(),
      person_id: 'person-alice',
      locale: 'en',
      analytics_id: 'ph-1',
    });
    expect(readReminderSubscription('trip-1')).toMatchObject({
      endpoint: 'https://push.example.test/send/abc',
      subscriptionId: '00000000-0000-4000-8000-000000000001',
    });
    expect(getReminderState('trip-1')).toBe('on');
  });

  it('registers a member through the trip id, in French', async () => {
    await enableTripReminders(client, MEMBER_TRIP, { locale: 'fr' });

    expect(rpc).toHaveBeenCalledWith('subscribe_member_reminders', {
      trip: 'aaaaaaaa-0000-0000-0000-000000000001',
      subscription: browserSubscription.toJSON(),
      locale: 'fr',
    });
  });

  it('reuses the subscription the browser already holds', async () => {
    pushManager.getSubscription.mockResolvedValue(browserSubscription);

    await enableTripReminders(client, MEMBER_TRIP, { locale: 'fr' });

    // One browser has one subscription; a second trip shares it.
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('has nothing to offer for a trip that lives on this device only', async () => {
    const result = await enableTripReminders(client, LOCAL_TRIP, { locale: 'en' });

    expect(result).toEqual({ status: 'unsupported' });
    expect(permission.request).not.toHaveBeenCalled();
  });

  it('reports a denied permission without touching the server', async () => {
    permission.request.mockResolvedValue('denied');

    const result = await enableTripReminders(client, VIEWER_TRIP, { locale: 'en' });

    expect(result).toEqual({ status: 'blocked' });
    expect(rpc).not.toHaveBeenCalled();
    expect(getReminderState('trip-1')).toBe('off');
  });

  it('reports a dismissed dialog as such', async () => {
    permission.request.mockResolvedValue('default');

    expect(await enableTripReminders(client, VIEWER_TRIP, { locale: 'en' })).toEqual({
      status: 'dismissed',
    });
  });

  it('says why the server refused, with the invite hints', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'invite expired', hint: 'invite_expired', code: 'P0001' },
    });

    expect(await enableTripReminders(client, VIEWER_TRIP, { locale: 'en' })).toEqual({
      status: 'expired',
    });

    rpc.mockResolvedValue({
      data: null,
      error: { message: 'not a member', hint: 'not_a_member', code: '42501' },
    });

    expect(await enableTripReminders(client, MEMBER_TRIP, { locale: 'en' })).toEqual({
      status: 'not-a-member',
    });
    expect(readReminderSubscription('trip-2')).toBeUndefined();
  });

  it('gives up quietly when the page has no service worker', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: new Promise(() => {}), getRegistration: async () => undefined },
    });
    vi.useFakeTimers();

    const pending = enableTripReminders(client, VIEWER_TRIP, { locale: 'en' });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await pending).toEqual({ status: 'unsupported' });
    vi.useRealTimers();
  });
});

describe('disableTripReminders', () => {
  it('tells the server, forgets the trip, and drops the browser subscription when nothing else uses it', async () => {
    await enableTripReminders(client, VIEWER_TRIP, { locale: 'en' });
    pushManager.getSubscription.mockResolvedValue(browserSubscription);
    rpc.mockResolvedValue({ data: 1, error: null });

    expect(await disableTripReminders(client, 'trip-1')).toBe(true);

    expect(rpc).toHaveBeenLastCalledWith('unsubscribe_reminders', {
      endpoint: 'https://push.example.test/send/abc',
    });
    expect(getReminderState('trip-1')).toBe('off');
    expect(browserSubscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('keeps the browser subscription while another trip still wants it', async () => {
    await enableTripReminders(client, VIEWER_TRIP, { locale: 'en' });
    await enableTripReminders(client, MEMBER_TRIP, { locale: 'en' });
    pushManager.getSubscription.mockResolvedValue(browserSubscription);
    rpc.mockResolvedValue({ data: 1, error: null });

    await disableTripReminders(client, 'trip-1');

    expect(browserSubscription.unsubscribe).not.toHaveBeenCalled();
    expect(getReminderState('trip-2')).toBe('on');
  });

  it('is a no-op for a trip that was never on', async () => {
    expect(await disableTripReminders(client, 'trip-9')).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('getReminderState', () => {
  it('reads blocked from the permission before anything else', () => {
    permission.state = 'denied';

    expect(getReminderState('trip-1')).toBe('blocked');
  });

  it('reads unsupported without a VAPID key', () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');

    expect(getReminderState('trip-1')).toBe('unsupported');
  });
});
