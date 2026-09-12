/**
 * @fileoverview Tests for the notification permission gate.
 *
 * jsdom ships no `Notification`, which is itself one of the cases under test:
 * the module must report `unsupported` and never throw rather than assume the
 * API is there. Every other case installs a stub for the length of one test.
 *
 * @module lib/notifications/__tests__/permission.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getNotificationState,
  isNotificationSupported,
  requestNotificationPermission,
} from '../permission';

// ============================================================================
// Helpers
// ============================================================================

/** Whatever a browser puts on `globalThis.Notification`, for one test. */
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

function removeNotification(): void {
  Reflect.deleteProperty(globalThis, 'Notification');
}

// ============================================================================
// Tests
// ============================================================================

describe('notification permission', () => {
  afterEach(() => {
    removeNotification();
    vi.restoreAllMocks();
  });

  describe('with no Notification API', () => {
    it('reports the API as absent', () => {
      expect(isNotificationSupported()).toBe(false);
    });

    it('reads as unsupported rather than throwing', () => {
      expect(getNotificationState()).toBe('unsupported');
    });

    it('resolves to unsupported without asking anything', async () => {
      await expect(requestNotificationPermission()).resolves.toBe('unsupported');
    });
  });

  describe('getNotificationState', () => {
    it('reports granted', () => {
      installNotification({ permission: 'granted' });

      expect(getNotificationState()).toBe('granted');
    });

    it('reports denied', () => {
      installNotification({ permission: 'denied' });

      expect(getNotificationState()).toBe('denied');
    });

    it('reports default', () => {
      installNotification({ permission: 'default' });

      expect(getNotificationState()).toBe('default');
    });

    it('treats an unrecognised value as default', () => {
      // Some in-app webviews ship a stub `Notification` whose static getter
      // returns something outside the spec's three values. "Nobody has decided
      // yet" is the only safe reading — reporting it as granted would make
      // `notify` post into the void.
      installNotification({ permission: undefined });

      expect(getNotificationState()).toBe('default');
    });
  });

  describe('requestNotificationPermission', () => {
    it('asks once and reports what the browser then says', async () => {
      const stub = installNotification({
        permission: 'default',
        requestPermission: vi.fn(() => {
          stub.permission = 'granted';

          return Promise.resolve('granted');
        }),
      });

      await expect(requestNotificationPermission()).resolves.toBe('granted');
      expect(stub.requestPermission).toHaveBeenCalledTimes(1);
    });

    it('explains rather than retries once denied', async () => {
      // The load-bearing case. A browser rejects a request made after a denial
      // immediately and silently, so a retry button would look broken; the card
      // sends people to their site settings instead, and this is what stops the
      // ask ever being made.
      const stub = installNotification({
        permission: 'denied',
        requestPermission: vi.fn(() => Promise.resolve('denied')),
      });

      await expect(requestNotificationPermission()).resolves.toBe('denied');
      expect(stub.requestPermission).not.toHaveBeenCalled();
    });

    it('does not ask again once granted', async () => {
      const stub = installNotification({
        permission: 'granted',
        requestPermission: vi.fn(() => Promise.resolve('granted')),
      });

      await expect(requestNotificationPermission()).resolves.toBe('granted');
      expect(stub.requestPermission).not.toHaveBeenCalled();
    });

    it('reads the state back when the browser only has the callback form', async () => {
      // Safari shipped `requestPermission(callback)` for years and returned
      // `undefined`. Taking the state from the return value would have reported
      // `default` forever on exactly those devices.
      const stub = installNotification({
        permission: 'default',
        requestPermission: vi.fn(() => {
          stub.permission = 'granted';

          return undefined;
        }),
      });

      await expect(requestNotificationPermission()).resolves.toBe('granted');
    });

    it('survives a browser that refuses the request', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      installNotification({
        permission: 'default',
        requestPermission: vi.fn(() => Promise.reject(new Error('no gesture'))),
      });

      await expect(requestNotificationPermission()).resolves.toBe('default');
      expect(warn).toHaveBeenCalled();
    });
  });
});
