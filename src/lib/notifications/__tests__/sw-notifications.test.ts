/**
 * @fileoverview Tests for the worker half of a notification click.
 *
 * `public/sw-notifications.js` is copied verbatim into `dist` and folded into
 * the generated Workbox worker, so nothing imports it and nothing type-checks
 * it — which is exactly why the click routing deserves a test rather than a
 * hand check in a browser. The file is read off disk and evaluated against a
 * fake `self`, the way the real worker would evaluate it.
 *
 * What is under test is the routing: where a click lands, and how the kind of
 * notification reaches a document that can capture it.
 *
 * @module lib/notifications/__tests__/sw-notifications.test
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// ============================================================================
// Fixtures
// ============================================================================

const SCOPE = 'https://app.kikouchou.test/app/';

const WORKER_SOURCE = readFileSync(
  resolve(process.cwd(), 'public/sw-notifications.js'),
  'utf8',
);

// ============================================================================
// Helpers
// ============================================================================

/** One open window, as `clients.matchAll()` reports it. */
interface FakeClient {
  url: string;
  focused: boolean;
  readonly focus: ReturnType<typeof vi.fn>;
  readonly navigate: ReturnType<typeof vi.fn>;
  readonly postMessage: ReturnType<typeof vi.fn>;
}

function fakeClient(url: string, focused = false): FakeClient {
  return {
    url,
    focused,
    focus: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    postMessage: vi.fn(),
  };
}

interface Worker {
  readonly dispatch: (type: string, event: unknown) => Promise<void>;
  readonly openWindow: ReturnType<typeof vi.fn>;
  readonly showNotification: ReturnType<typeof vi.fn>;
}

/**
 * Evaluates the worker file against a fake `self` holding `clients`.
 *
 * The handlers call `event.waitUntil()` with the promise that does the work, so
 * the fake collects it and `dispatch` awaits it — otherwise every assertion
 * would run before the click had gone anywhere.
 */
function loadWorker(clients: readonly FakeClient[]): Worker {
  const listeners = new Map<string, (event: unknown) => void>();
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const showNotification = vi.fn().mockResolvedValue(undefined);

  const self = {
    addEventListener: (type: string, listener: (event: unknown) => void): void => {
      listeners.set(type, listener);
    },
    registration: { scope: SCOPE, showNotification },
    clients: {
      matchAll: (): Promise<readonly FakeClient[]> => Promise.resolve(clients),
      openWindow,
    },
  };

  // The worker's own globals are the only ones it gets: `self` and `console`.
  const evaluate = new Function('self', 'console', WORKER_SOURCE) as (
    scope: unknown,
    log: unknown,
  ) => void;
  evaluate(self, console);

  return {
    dispatch: async (type, event): Promise<void> => {
      const pending: Promise<unknown>[] = [];
      const listener = listeners.get(type);

      if (!listener) {
        throw new Error(`the worker registered no ${type} listener`);
      }

      listener({
        ...(event as object),
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      });

      await Promise.all(pending);
    },
    openWindow,
    showNotification,
  };
}

/** The click event the browser delivers, for a notification with this data. */
function clickOn(data: unknown): Record<string, unknown> {
  return { notification: { data, close: vi.fn() } };
}

// ============================================================================
// Tests
// ============================================================================

describe('sw-notifications', () => {
  describe('a click with no window open', () => {
    it('opens the stored page, carrying the kind for the page to report', async () => {
      const worker = loadWorker([]);

      await worker.dispatch(
        'notificationclick',
        clickOn({ url: 'trips/t1/transports', kind: 'pickup' }),
      );

      expect(worker.openWindow).toHaveBeenCalledExactlyOnceWith(
        `${SCOPE}trips/t1/transports?from_notification=pickup`,
      );
    });

    it('reports a notification older than this build as unknown', async () => {
      const worker = loadWorker([]);

      await worker.dispatch('notificationclick', clickOn({ url: 'trips/t1' }));

      expect(worker.openWindow).toHaveBeenCalledExactlyOnceWith(
        `${SCOPE}trips/t1?from_notification=unknown`,
      );
    });

    it('still refuses a path that resolves outside the app', async () => {
      const worker = loadWorker([]);

      await worker.dispatch(
        'notificationclick',
        clickOn({ url: '../../evil', kind: 'pickup' }),
      );

      expect(worker.openWindow).toHaveBeenCalledExactlyOnceWith(
        `${SCOPE}?from_notification=pickup`,
      );
    });
  });

  describe('a click with the page already on screen', () => {
    it('focuses it and tells it, rather than reloading it for a parameter', async () => {
      const open = fakeClient(`${SCOPE}trips/t1/transports`, true);
      const worker = loadWorker([open]);

      await worker.dispatch(
        'notificationclick',
        clickOn({ url: 'trips/t1/transports', kind: 'leave' }),
      );

      expect(open.focus).toHaveBeenCalledOnce();
      expect(open.navigate).not.toHaveBeenCalled();
      expect(open.postMessage).toHaveBeenCalledExactlyOnceWith({
        type: 'notification-click',
        kind: 'leave',
      });
    });
  });

  describe('a click with another page open', () => {
    it('routes the focused window, which loads the kind with it', async () => {
      const background = fakeClient(`${SCOPE}trips/t2`);
      const focused = fakeClient(`${SCOPE}trips/t9`, true);
      const worker = loadWorker([background, focused]);

      await worker.dispatch(
        'notificationclick',
        clickOn({ url: 'trips/t1/transports', kind: 'own_arrival' }),
      );

      expect(focused.navigate).toHaveBeenCalledExactlyOnceWith(
        `${SCOPE}trips/t1/transports?from_notification=own_arrival`,
      );
      expect(background.navigate).not.toHaveBeenCalled();
      // The document about to be replaced is not worth a message it cannot read.
      expect(focused.postMessage).not.toHaveBeenCalled();
    });

    it('falls back to telling a window it was not allowed to route', async () => {
      const focused = fakeClient(`${SCOPE}trips/t9`, true);
      focused.navigate.mockRejectedValue(new Error('not controlled'));
      const worker = loadWorker([focused]);

      await worker.dispatch(
        'notificationclick',
        clickOn({ url: 'trips/t1/transports', kind: 'trip_start' }),
      );

      expect(focused.postMessage).toHaveBeenCalledExactlyOnceWith({
        type: 'notification-click',
        kind: 'trip_start',
      });
    });
  });

  describe('a pushed reminder', () => {
    it('stores the kind, so the click it leads to can say which one it was', async () => {
      const worker = loadWorker([]);

      await worker.dispatch('push', {
        data: {
          json: () => ({
            title: 'Time to leave',
            body: 'The ride leaves in 30 minutes',
            url: 'trips/t1/transports',
            tag: 'reminder:pickup:ride-1',
            kind: 'pickup',
          }),
        },
      });

      expect(worker.showNotification).toHaveBeenCalledOnce();
      const [, options] = worker.showNotification.mock.calls[0] as [
        string,
        { data: { url: string; kind: string } },
      ];
      expect(options.data).toStrictEqual({
        url: 'trips/t1/transports',
        kind: 'pickup',
      });
    });
  });
});
