/**
 * @fileoverview Shared helpers for asserting the app's OS notifications.
 *
 * Success confirmations are operating system notifications rather than in-page
 * toasts (`src/lib/notifications/notify.ts`), and an OS notification is not in
 * the DOM: `page.getByText(/trip created/i)` can never see one. Nor can
 * Playwright read the real notification shade.
 *
 * So the page gets a recording `window.Notification` before any app code runs,
 * and a test asserts against what the app tried to show. That is the whole
 * contract the app owns — the shade beyond it belongs to the operating system.
 *
 * @module e2e/support/os-notifications
 */

import { expect, type Page } from '@playwright/test';

// ============================================================================
// Type Definitions
// ============================================================================

/** One notification the app asked for. */
export interface RecordedNotification {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Where the stub keeps what it recorded, on `window`. */
const RECORD_KEY = '__osNotifications';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Installs a granted, recording `Notification` for the rest of the page's life.
 *
 * Must be called before the navigation under test: `addInitScript` runs on
 * every document, ahead of the app's own modules, which is the only point at
 * which `window.Notification` can still be replaced.
 *
 * The stub reports itself as already granted, so the app never reaches
 * `requestPermission` and the run does not depend on Chromium's permission
 * state.
 *
 * @param page - The page to record on.
 *
 * @example
 * ```ts
 * await recordOsNotifications(page);
 * await page.goto('/trips/new');
 * ```
 */
export async function recordOsNotifications(page: Page): Promise<void> {
  await page.addInitScript((key: string) => {
    const recorded: unknown[] = [];
    (window as unknown as Record<string, unknown>)[key] = recorded;

    class RecordingNotification {
      static permission = 'granted';
      static requestPermission = async (): Promise<string> => 'granted';

      onclick: unknown = null;

      constructor(title: string, options?: { body?: string; tag?: string }) {
        recorded.push({
          title,
          body: options?.body ?? '',
          tag: options?.tag ?? '',
        });
      }

      close(): void {
        // The app withdraws its own confirmations on a timer. Nothing to do:
        // the record is what the test reads, and it keeps every entry.
      }
    }

    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: RecordingNotification,
    });
  }, RECORD_KEY);
}

/**
 * Everything the app has asked to notify so far, oldest first.
 *
 * @param page - The page {@link recordOsNotifications} was installed on.
 * @returns The recorded notifications.
 */
export async function osNotifications(
  page: Page,
): Promise<readonly RecordedNotification[]> {
  return page.evaluate(
    (key: string) =>
      ((window as unknown as Record<string, RecordedNotification[]>)[key] ??
        []) as RecordedNotification[],
    RECORD_KEY,
  );
}

/**
 * Waits until the app has notified something matching `pattern`.
 *
 * Polls rather than reads once, because delivery is a promise the save does
 * not await — the confirmation lands a tick or two after the navigation the
 * test just saw.
 *
 * @param page - The page {@link recordOsNotifications} was installed on.
 * @param pattern - Matched against each notification body.
 */
export async function expectOsNotification(
  page: Page,
  pattern: RegExp,
): Promise<void> {
  await expect
    .poll(async () => (await osNotifications(page)).map((one) => one.body), {
      message: `expected an OS notification matching ${String(pattern)}`,
    })
    .toEqual(expect.arrayContaining([expect.stringMatching(pattern)]));
}
