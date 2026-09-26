/**
 * @fileoverview Confirmations in a store app: a short toast and a haptic tap,
 * never a system notification.
 *
 * @module lib/notifications/__tests__/notify-native.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ value: 'android' as string }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => platform.value, isPluginAvailable: () => true },
}));

const doubles = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  haptic: vi.fn(async () => undefined),
  showOsNotification: vi.fn(async () => true),
  announceStatus: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: doubles.toastSuccess, error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { notification: doubles.haptic },
  NotificationType: { Success: 'SUCCESS' },
}));
vi.mock('@/lib/notifications/os-notification', () => ({
  showOsNotification: doubles.showOsNotification,
}));
vi.mock('@/lib/notifications/announcer', () => ({ announceStatus: doubles.announceStatus }));

import { notify } from '@/lib/notifications/notify';

beforeEach(() => {
  vi.clearAllMocks();
  platform.value = 'android';
});

describe('notify in a store app', () => {
  it('confirms with a short toast and a haptic tap', () => {
    notify.success('Room created');

    expect(doubles.announceStatus).toHaveBeenCalledWith('Room created');
    expect(doubles.toastSuccess).toHaveBeenCalledWith('Room created', { duration: 2500 });
    expect(doubles.haptic).toHaveBeenCalledWith({ type: 'SUCCESS' });
    expect(doubles.showOsNotification).not.toHaveBeenCalled();
  });

  it('survives a device with no haptic engine', async () => {
    doubles.haptic.mockRejectedValueOnce(new Error('unavailable'));

    expect(() => notify.info('Trip switched')).not.toThrow();
    await Promise.resolve();
  });

  it('still sends a website confirmation to the operating system', () => {
    platform.value = 'web';

    notify.success('Room created');

    expect(doubles.showOsNotification).toHaveBeenCalledWith('Room created');
    expect(doubles.toastSuccess).not.toHaveBeenCalled();
  });
});
