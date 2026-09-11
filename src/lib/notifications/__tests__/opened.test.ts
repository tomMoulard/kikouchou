/**
 * @fileoverview Tests for reporting a notification click from the page.
 *
 * The module under test does its work at import time, the way
 * `lib/supabase/auth-callback` does, so every test sets the URL and the service
 * worker *first* and imports it afterwards through `vi.resetModules()`. An
 * import hoisted to the top of the file would run against the wrong URL.
 *
 * @module lib/notifications/__tests__/opened.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCapture = vi.fn();

// The real module exports `undefined` without env config, which is the case in
// tests, so nothing here could observe a capture without this.
vi.mock('@/lib/posthog', () => ({
  // Named export used by every catch block that reports; a mock
  // without it makes the reporter itself the error under test.
  reportError: vi.fn(),
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
  captureEvent: (...args: unknown[]) => mockCapture(...args),
}));

// ============================================================================
// Helpers
// ============================================================================

/** Listeners the fake service worker container collected, by event name. */
type MessageListener = (event: MessageEvent) => void;

let workerListeners: MessageListener[] = [];

/**
 * Installs a `navigator.serviceWorker` that only collects message listeners.
 *
 * jsdom has no service worker at all, and its absence is itself a case under
 * test — a desktop browser on a first load has none either.
 */
function installServiceWorker(): void {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      addEventListener: (type: string, listener: MessageListener): void => {
        if (type === 'message') {
          workerListeners.push(listener);
        }
      },
    },
  });
}

function removeServiceWorker(): void {
  Reflect.deleteProperty(navigator, 'serviceWorker');
}

/** Sends what the worker's `postMessage` would send. */
function postFromWorker(data: unknown): void {
  for (const listener of workerListeners) {
    listener({ data } as MessageEvent);
  }
}

/**
 * Loads the module fresh, against whatever URL and worker the test just set.
 *
 * @param url - The document URL to load it at
 */
async function importAt(url: string): Promise<void> {
  window.history.replaceState(null, '', url);
  vi.resetModules();
  await import('../opened');
}

// ============================================================================
// Tests
// ============================================================================

describe('notification click reporting', () => {
  beforeEach(() => {
    workerListeners = [];
    mockCapture.mockClear();
    installServiceWorker();
  });

  afterEach(() => {
    removeServiceWorker();
    window.history.replaceState(null, '', '/');
  });

  describe('from the URL', () => {
    it('reports the kind the worker put on the URL', async () => {
      await importAt('/trips/t1/transports?from_notification=pickup');

      expect(mockCapture).toHaveBeenCalledExactlyOnceWith('notification_opened', {
        kind: 'pickup',
      });
    });

    it('removes the parameter once it has been read', async () => {
      await importAt('/trips/t1/transports?from_notification=pickup');

      expect(window.location.search).toBe('');
      expect(window.location.pathname).toBe('/trips/t1/transports');
    });

    it('keeps the rest of the query string, which belongs to the page', async () => {
      await importAt('/trips/t1/transports?from_notification=leave&day=2#meet');

      expect(window.location.search).toBe('?day=2');
      expect(window.location.hash).toBe('#meet');
    });

    it('says nothing about a load that did not come from a notification', async () => {
      await importAt('/trips/t1/transports?day=2');

      expect(mockCapture).not.toHaveBeenCalled();
      expect(window.location.search).toBe('?day=2');
    });

    it('reports an empty kind as unknown rather than dropping the click', async () => {
      await importAt('/?from_notification=');

      expect(mockCapture).toHaveBeenCalledExactlyOnceWith('notification_opened', {
        kind: 'unknown',
      });
    });

    it('refuses a kind long enough to be somebody else writing the schema', async () => {
      await importAt(`/?from_notification=${'x'.repeat(200)}`);

      expect(mockCapture).toHaveBeenCalledExactlyOnceWith('notification_opened', {
        kind: 'unknown',
      });
    });
  });

  describe('from a worker message', () => {
    it('reports a click on a page that was already open', async () => {
      await importAt('/trips/t1/transports');

      postFromWorker({ type: 'notification-click', kind: 'trip_start' });

      expect(mockCapture).toHaveBeenCalledExactlyOnceWith('notification_opened', {
        kind: 'trip_start',
      });
    });

    it('ignores every other message the worker sends', async () => {
      await importAt('/');

      postFromWorker({ type: 'workbox-waiting' });
      postFromWorker('a string');
      postFromWorker(null);

      expect(mockCapture).not.toHaveBeenCalled();
    });

    it('listens even where there is no service worker to listen to', async () => {
      removeServiceWorker();

      await expect(importAt('/')).resolves.toBeUndefined();
    });
  });

  describe('reportNotificationOpened', () => {
    it('captures one event per call', async () => {
      await importAt('/');
      const { reportNotificationOpened } = await import('../opened');

      reportNotificationOpened('status');

      expect(mockCapture).toHaveBeenCalledExactlyOnceWith('notification_opened', {
        kind: 'status',
      });
    });

    it('never throws, whatever PostHog does', async () => {
      await importAt('/');
      const { reportNotificationOpened } = await import('../opened');
      mockCapture.mockImplementationOnce(() => {
        throw new Error('network');
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      expect(() => {
        reportNotificationOpened('pickup');
      }).not.toThrow();

      warn.mockRestore();
    });
  });
});
