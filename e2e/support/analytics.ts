/**
 * @fileoverview Reads the events the app captured, without a PostHog client.
 *
 * The suite cannot watch the wire. `lib/posthog` refuses to initialise on a
 * loopback hostname and every Playwright server here blanks `VITE_POSTHOG_KEY`,
 * both deliberately — `analytics-privacy.spec.ts` holds the nineteen phantom
 * people that bought those guards, and `src/test/e2e-env-isolation.test.ts`
 * fails the build if a server stops blanking them.
 *
 * So the observation point is inside the app instead: `captureEvent` pushes
 * every capture onto `window.__kikouchouAnalytics` on a dev build, one step
 * before a client that is not there would have sent it. That is what these
 * helpers read.
 *
 * Two consequences worth knowing before writing a spec against them:
 *
 *   - the log lives on `window`, so a full document load (`page.goto`, a
 *     reload) empties it. A client-side navigation — every link and every
 *     `navigate()` in the app — does not, which is what makes a multi-step
 *     funnel assertable in one go;
 *   - `import.meta.env.DEV` is a build-time literal, so the `production`
 *     Playwright project has no log at all. Specs using this belong to the
 *     dev-server projects.
 *
 * @module e2e/support/analytics
 */

import { expect, type Page } from '@playwright/test';

// ============================================================================
// Types
// ============================================================================

/** One capture, as `lib/posthog` records it. */
export interface CapturedEvent {
  readonly event: string;
  readonly properties?: Record<string, unknown>;
}

// ============================================================================
// Reading
// ============================================================================

/**
 * Every event captured in this document so far, oldest first.
 *
 * @param page - Playwright page object
 * @returns The captured events, or an empty list if nothing has been captured
 */
export async function readCapturedEvents(page: Page): Promise<CapturedEvent[]> {
  return await page.evaluate(
    () =>
      (window as Window & { __kikouchouAnalytics?: CapturedEvent[] })
        .__kikouchouAnalytics ?? [],
  );
}

/**
 * Waits for one named event and returns it.
 *
 * Polls rather than reads once: a capture can trail the click that caused it by
 * an await — a delete is reported after the write resolves — and asserting
 * immediately would be asserting on a race. `expect.poll` is safe here in a way
 * it is not in `analytics-privacy.spec.ts`: this expectation is that something
 * *arrives*, so an empty log fails and keeps polling rather than passing
 * instantly.
 *
 * @param page - Playwright page object
 * @param event - The event name to wait for
 * @returns The most recent capture of that event
 */
export async function waitForCapturedEvent(
  page: Page,
  event: string,
): Promise<CapturedEvent> {
  await expect
    .poll(
      async () => (await readCapturedEvents(page)).some((entry) => entry.event === event),
      { message: `waiting for the "${event}" capture` },
    )
    .toBe(true);

  const captured = (await readCapturedEvents(page)).filter(
    (entry) => entry.event === event,
  );
  // Non-null: the poll above only returns once this list is non-empty.
  return captured[captured.length - 1] as CapturedEvent;
}

/**
 * The properties of one named event, or `undefined` if it was captured bare.
 *
 * A convenience over {@link waitForCapturedEvent} for the common assertion,
 * which is about what an event carries rather than about the event object.
 *
 * @param page - Playwright page object
 * @param event - The event name to wait for
 * @returns That event's properties
 */
export async function waitForCapturedProperties(
  page: Page,
  event: string,
): Promise<Record<string, unknown> | undefined> {
  return (await waitForCapturedEvent(page, event)).properties;
}

/**
 * The names of every event captured so far, in order, duplicates included.
 *
 * For asserting a sequence — a wizard's four steps, a delete that must not also
 * report a save.
 *
 * @param page - Playwright page object
 * @returns The event names
 */
export async function capturedEventNames(page: Page): Promise<string[]> {
  return (await readCapturedEvents(page)).map((entry) => entry.event);
}

/**
 * Empties the log, so a later assertion cannot match an earlier action.
 *
 * Needed because one test often drives two things — open a page, then delete a
 * row — and `$pageview`-adjacent captures from the first would otherwise still
 * be sitting there.
 *
 * @param page - Playwright page object
 */
export async function clearCapturedEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as Window & { __kikouchouAnalytics?: CapturedEvent[] }).__kikouchouAnalytics =
      [];
  });
}

// ============================================================================
// Stubs
// ============================================================================

/**
 * Makes `window.print()` return instead of opening the browser's print dialog.
 *
 * The summary sheet's whole feature is that dialog, and it is modal: headless
 * Chromium blocks the page on it, so a spec that clicks Print without this
 * hangs until its timeout. Installed as an init script so it is in place before
 * the app's own bundle runs.
 *
 * @param page - Playwright page object
 */
export async function stubPrintDialog(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.print = (): void => {
      // Deliberately empty: the assertion is about the capture beside the call.
    };
  });
}
