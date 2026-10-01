/**
 * @fileoverview Tests for OS notification delivery.
 *
 * Every test re-imports the module: `permissionRequest` is module state, and
 * "asks once" is one of the behaviours under test, so a shared instance would
 * let the first test answer the second one's question.
 *
 * @module lib/notifications/__tests__/os-notification.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockReportOpened = vi.fn();

// A confirmation delivered by the page never reaches the service worker, so its
// own `onclick` is the only thing that can report the click.
vi.mock('@/lib/notifications/opened', () => ({
  reportNotificationOpened: (kind: string) => mockReportOpened(kind),
}));

// ============================================================================
// Fixtures
// ============================================================================

/** A recorded `new Notification(...)`. */
interface FakeNotification {
  readonly title: string;
  readonly options: NotificationOptions | undefined;
  onclick: (() => void) | null;
  readonly close: () => void;
}

const constructed: FakeNotification[] = [];

/**
 * Installs a `window.Notification` whose permission and constructor behaviour
 * the test picks.
 *
 * @param permission - What `Notification.permission` reads back.
 * @param options - `granted` is the answer `requestPermission` moves it to;
 *   `constructorThrows` reproduces Android Chrome's `Illegal constructor`.
 */
function stubNotificationApi(
  permission: NotificationPermission,
  options: { granted?: NotificationPermission; constructorThrows?: boolean } = {},
): { requestPermission: ReturnType<typeof vi.fn> } {
  let current = permission;
  const requestPermission = vi.fn(async () => {
    current = options.granted ?? 'denied';
    return current;
  });

  class StubNotification {
    static get permission(): NotificationPermission {
      return current;
    }
    static requestPermission = requestPermission;

    onclick: (() => void) | null = null;
    close = vi.fn();
    title: string;
    options: NotificationOptions | undefined;

    constructor(title: string, options?: NotificationOptions) {
      this.title = title;
      this.options = options;
      constructed.push(this as unknown as FakeNotification);
    }
  }

  if (options.constructorThrows) {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: Object.assign(
        function ThrowingNotification(): never {
          throw new TypeError('Illegal constructor');
        },
        {
          get permission(): NotificationPermission {
            return current;
          },
          requestPermission,
        },
      ),
    });
  } else {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: StubNotification,
    });
  }

  return { requestPermission };
}

/** Installs a `navigator.serviceWorker` with one registration, or none. */
function stubServiceWorker(registration: unknown): {
  showNotification: ReturnType<typeof vi.fn>;
} {
  const showNotification = vi.fn(async () => undefined);
  const value =
    registration === null
      ? { getRegistration: async () => undefined }
      : {
          getRegistration: async () => ({
            showNotification,
            getNotifications: async () => [],
          }),
        };

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    writable: true,
    value,
  });

  return { showNotification };
}

/** A fresh copy of the module under test. */
async function loadModule(): Promise<
  typeof import('../os-notification')
> {
  vi.resetModules();
  return import('../os-notification');
}

// ============================================================================
// Tests
// ============================================================================

describe('os-notification', () => {
  beforeEach(() => {
    constructed.length = 0;
    mockReportOpened.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'Notification');
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  // --------------------------------------------------------------------------
  // Capability
  // --------------------------------------------------------------------------

  describe('when the browser has no Notification API', () => {
    it('reports no support and delivers nothing', async () => {
      const { isOsNotificationSupported, showOsNotification } = await loadModule();

      expect(isOsNotificationSupported()).toBe(false);
      await expect(showOsNotification('Room created')).resolves.toBe(false);
      expect(constructed).toHaveLength(0);
    });

    it('reports the permission as denied rather than throwing', async () => {
      const { osNotificationPermission } = await loadModule();

      expect(osNotificationPermission()).toBe('denied');
    });
  });

  // --------------------------------------------------------------------------
  // Permission
  // --------------------------------------------------------------------------

  describe('permission', () => {
    it('asks the user the first time a confirmation is shown', async () => {
      const { requestPermission } = stubNotificationApi('default', {
        granted: 'granted',
      });
      const { showOsNotification } = await loadModule();

      await expect(showOsNotification('Room created')).resolves.toBe(true);
      expect(requestPermission).toHaveBeenCalledTimes(1);
    });

    it('opens one prompt for two confirmations in the same tick', async () => {
      // Two saves in a row — a room and its first assignment — must not stack
      // two permission dialogs on top of each other.
      const { requestPermission } = stubNotificationApi('default', {
        granted: 'granted',
      });
      const { showOsNotification } = await loadModule();

      await Promise.all([
        showOsNotification('Room created'),
        showOsNotification('Assignment created'),
      ]);

      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(constructed).toHaveLength(2);
    });

    it('never asks again once the user has answered', async () => {
      const { requestPermission } = stubNotificationApi('granted');
      const { showOsNotification } = await loadModule();

      await showOsNotification('Room created');

      expect(requestPermission).not.toHaveBeenCalled();
    });

    it('delivers nothing when the user refuses', async () => {
      stubNotificationApi('default', { granted: 'denied' });
      const { showOsNotification } = await loadModule();

      await expect(showOsNotification('Room created')).resolves.toBe(false);
      expect(constructed).toHaveLength(0);
    });

    it('delivers nothing when permission was already denied', async () => {
      const { requestPermission } = stubNotificationApi('denied');
      const { showOsNotification } = await loadModule();

      await expect(showOsNotification('Room created')).resolves.toBe(false);
      // Asking again would be a prompt the browser refuses anyway.
      expect(requestPermission).not.toHaveBeenCalled();
    });

    it('survives a browser that throws on the request', async () => {
      // Safari with no user activation left does exactly this.
      stubNotificationApi('default');
      const notification = window.Notification as unknown as {
        requestPermission: ReturnType<typeof vi.fn>;
      };
      notification.requestPermission.mockRejectedValue(
        new Error('no user activation'),
      );
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const { showOsNotification } = await loadModule();

      await expect(showOsNotification('Room created')).resolves.toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Delivery
  // --------------------------------------------------------------------------

  describe('delivery', () => {
    it('sends the message as the body under the app name', async () => {
      stubNotificationApi('granted');
      const { showOsNotification } = await loadModule();

      await showOsNotification('Room created successfully');

      const [notification] = constructed;
      expect(notification?.title).toBe('Kikouchou');
      expect(notification?.options?.body).toBe('Room created successfully');
    });

    it('gives every confirmation the same tag, so a new one replaces the last', async () => {
      // This is the stacking fix. Three room creations must leave one card in
      // the shade, not three.
      stubNotificationApi('granted');
      const { showOsNotification } = await loadModule();

      await showOsNotification('Room created successfully');
      await showOsNotification('Room created successfully');

      const tags = constructed.map((notification) => notification.options?.tag);
      expect(tags).toEqual(['kikouchou-status', 'kikouchou-status']);
    });

    it('makes no sound', async () => {
      stubNotificationApi('granted');
      const { showOsNotification } = await loadModule();

      await showOsNotification('Room created successfully');

      expect(constructed[0]?.options?.silent).toBe(true);
    });

    it('withdraws the confirmation rather than leaving it in the shade', async () => {
      stubNotificationApi('granted');
      const { showOsNotification } = await loadModule();

      await showOsNotification('Room created successfully');
      const notification = constructed[0];
      expect(notification?.close).not.toHaveBeenCalled();

      vi.advanceTimersByTime(6_000);

      expect(notification?.close).toHaveBeenCalledTimes(1);
    });

    it('focuses the tab when the user clicks it', async () => {
      stubNotificationApi('granted');
      const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
      const { showOsNotification } = await loadModule();

      await showOsNotification('Room created successfully');
      constructed[0]?.onclick?.();

      expect(focus).toHaveBeenCalledTimes(1);
    });

    it('reports the click it just handled, as a status notification', async () => {
      stubNotificationApi('granted');
      vi.spyOn(window, 'focus').mockImplementation(() => undefined);
      const { showOsNotification } = await loadModule();

      await showOsNotification('Room created successfully');
      constructed[0]?.onclick?.();

      expect(mockReportOpened).toHaveBeenCalledExactlyOnceWith('status');
    });

    it('tags the worker copy so the worker can report a click on it', async () => {
      stubNotificationApi('granted', { constructorThrows: true });
      const { showNotification } = stubServiceWorker({});
      const { showOsNotification } = await loadModule();

      await showOsNotification('Room created successfully');

      expect(showNotification).toHaveBeenCalledWith(
        'Kikouchou',
        expect.objectContaining({ data: { kind: 'status' } }),
      );
    });

    it('falls back to the service worker where the constructor is illegal', async () => {
      // Android Chrome: `new Notification()` throws, and only the worker may
      // show one.
      stubNotificationApi('granted', { constructorThrows: true });
      const { showNotification } = stubServiceWorker({});
      const { showOsNotification } = await loadModule();

      await expect(showOsNotification('Room created successfully')).resolves.toBe(
        true,
      );
      expect(showNotification).toHaveBeenCalledWith(
        'Kikouchou',
        expect.objectContaining({ body: 'Room created successfully' }),
      );
    });

    it('reports failure when neither route is available', async () => {
      stubNotificationApi('granted', { constructorThrows: true });
      stubServiceWorker(null);
      const { showOsNotification } = await loadModule();

      await expect(showOsNotification('Room created successfully')).resolves.toBe(
        false,
      );
    });
  });
});
