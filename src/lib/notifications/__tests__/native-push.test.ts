/**
 * @fileoverview Trip reminders in the store apps: a device token from the
 * operating system in place of a browser subscription.
 *
 * @module lib/notifications/__tests__/native-push.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installTestLocalStorage } from '@/test/utils';
import type { Trip } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

const platform = vi.hoisted(() => ({ value: 'ios' as 'web' | 'ios' | 'android', plugin: true }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platform.value,
    isPluginAvailable: () => platform.plugin,
  },
}));

type Listener = (payload: unknown) => void;

const plugin = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>();
  return {
    listeners,
    emit(event: string, payload: unknown): void {
      for (const listener of listeners.get(event) ?? []) {
        listener(payload);
      }
    },
    checkPermissions: vi.fn(async () => ({ receive: 'prompt' as string })),
    requestPermissions: vi.fn(async () => ({ receive: 'granted' as string })),
    createChannel: vi.fn(async () => undefined),
    register: vi.fn(async () => undefined),
    unregister: vi.fn(async () => undefined),
    addListener: vi.fn(async (event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return {
        remove: async () => {
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((candidate) => candidate !== listener),
          );
        },
      };
    }),
  };
});

vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }));

import {
  REMINDER_CHANNEL_ID,
  isNativePushAvailable,
  nativePushTransport,
  onNativeNotificationOpened,
  registerNativePush,
} from '@/lib/notifications/native-push';
import {
  disableTripReminders,
  enableTripReminders,
  getReminderState,
  isPushSupported,
  readReminderSubscription,
} from '@/lib/notifications/push';

const APNS_TOKEN = 'a1'.repeat(32);

/** The operating system answers `register()` with a token, as it does. */
function answerWithToken(token: string): void {
  plugin.register.mockImplementation(async () => {
    queueMicrotask(() => plugin.emit('registration', { value: token }));
  });
}

const rpc = vi.fn();
const client = { rpc } as never;

const MEMBER_TRIP = {
  id: 'trip-2',
  name: 'Alps',
  remoteTripId: 'aaaaaaaa-0000-0000-0000-000000000001',
} as unknown as Trip;

beforeEach(() => {
  vi.clearAllMocks();
  plugin.listeners.clear();
  platform.value = 'ios';
  platform.plugin = true;
  plugin.checkPermissions.mockResolvedValue({ receive: 'prompt' });
  plugin.requestPermissions.mockResolvedValue({ receive: 'granted' });
  answerWithToken(APNS_TOKEN);
  rpc.mockResolvedValue({ data: '00000000-0000-4000-8000-000000000009', error: null });
  installTestLocalStorage();
});

// ============================================================================
// Tests
// ============================================================================

describe('native push capability', () => {
  it('is there in a store app with the plugin, and nowhere else', () => {
    expect(isNativePushAvailable()).toBe(true);
    expect(isPushSupported()).toBe(true);

    // The F-Droid build carries no Firebase, and so no plugin.
    platform.plugin = false;
    expect(isNativePushAvailable()).toBe(false);
    expect(isPushSupported()).toBe(false);
    expect(getReminderState('trip-2')).toBe('unsupported');
  });

  it('names the push service each platform uses', () => {
    expect(nativePushTransport()).toBe('apns');
    platform.value = 'android';
    expect(nativePushTransport()).toBe('fcm');
  });
});

describe('registerNativePush', () => {
  it('asks, then registers, and hands back the token', async () => {
    const result = await registerNativePush('Trip reminders');

    expect(plugin.requestPermissions).toHaveBeenCalled();
    expect(result).toEqual({
      status: 'registered',
      subscription: { transport: 'apns', token: APNS_TOKEN },
    });
    // The channel is Android's alone.
    expect(plugin.createChannel).not.toHaveBeenCalled();
  });

  it('creates the reminder channel on Android, in the given language', async () => {
    platform.value = 'android';

    await registerNativePush('Rappels de voyage');

    expect(plugin.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: REMINDER_CHANNEL_ID, name: 'Rappels de voyage' }),
    );
  });

  it('does not ask twice once the permission is granted', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });

    await registerNativePush('Trip reminders');

    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it('reports a refusal as blocked and a dismissal as dismissed', async () => {
    plugin.requestPermissions.mockResolvedValue({ receive: 'denied' });
    expect(await registerNativePush('x')).toEqual({ status: 'blocked' });

    plugin.requestPermissions.mockResolvedValue({ receive: 'prompt' });
    expect(await registerNativePush('x')).toEqual({ status: 'dismissed' });
  });

  it('reports a registration error rather than throwing', async () => {
    plugin.register.mockImplementation(async () => {
      queueMicrotask(() => plugin.emit('registrationError', { error: 'no aps-environment' }));
    });

    expect(await registerNativePush('x')).toEqual({
      status: 'error',
      message: 'no aps-environment',
    });
  });

  it('is unsupported without the plugin', async () => {
    platform.plugin = false;

    expect(await registerNativePush('x')).toEqual({ status: 'unsupported' });
  });
});

describe('enableTripReminders in a store app', () => {
  it('sends the device token to the same RPC a browser uses, and remembers it', async () => {
    const result = await enableTripReminders(client, MEMBER_TRIP, {
      locale: 'fr-FR',
      channelName: 'Rappels de voyage',
    });

    expect(result).toEqual({ status: 'enabled' });
    expect(rpc).toHaveBeenCalledWith('subscribe_member_reminders', {
      trip: MEMBER_TRIP.remoteTripId,
      subscription: { transport: 'apns', token: APNS_TOKEN },
      locale: 'fr',
    });
    expect(readReminderSubscription('trip-2')?.endpoint).toBe(APNS_TOKEN);
    expect(getReminderState('trip-2')).toBe('on');
  });

  it('passes the refusal through as the card expects it', async () => {
    plugin.requestPermissions.mockResolvedValue({ receive: 'denied' });

    expect(await enableTripReminders(client, MEMBER_TRIP, { locale: 'en' })).toEqual({
      status: 'blocked',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('unregisters from the push service once no trip wants reminders', async () => {
    await enableTripReminders(client, MEMBER_TRIP, { locale: 'en' });
    rpc.mockResolvedValue({ data: 1, error: null });

    expect(await disableTripReminders(client, 'trip-2')).toBe(true);

    // Named with the trip: the token is shared by every trip on the device.
    expect(rpc).toHaveBeenLastCalledWith('unsubscribe_reminders', {
      endpoint: APNS_TOKEN,
      trip: MEMBER_TRIP.remoteTripId,
    });
    expect(plugin.unregister).toHaveBeenCalled();
  });
});

describe('onNativeNotificationOpened', () => {
  it('hands over the kind and the path the reminder carried', async () => {
    const listener = vi.fn();
    const unsubscribe = onNativeNotificationOpened(listener);
    await Promise.resolve();

    plugin.emit('pushNotificationActionPerformed', {
      notification: { data: { kind: 'pickup', url: '/trips/t1/transports' } },
    });

    expect(listener).toHaveBeenCalledWith({ kind: 'pickup', url: '/trips/t1/transports' });
    unsubscribe();
  });

  it('reads a reminder with no data as unknown', async () => {
    const listener = vi.fn();
    onNativeNotificationOpened(listener);
    await Promise.resolve();

    plugin.emit('pushNotificationActionPerformed', { notification: { data: null } });

    expect(listener).toHaveBeenCalledWith({ kind: 'unknown', url: '' });
  });

  it('subscribes to nothing without the plugin', () => {
    platform.plugin = false;

    onNativeNotificationOpened(vi.fn())();

    expect(plugin.addListener).not.toHaveBeenCalled();
  });
});
