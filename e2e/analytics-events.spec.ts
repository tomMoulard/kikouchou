/**
 * @fileoverview The events the app is supposed to capture, driven through the UI.
 *
 * Its companion `analytics-privacy.spec.ts` asserts that nothing reaches
 * PostHog from this suite. That guarantee is what makes this spec necessary:
 * with no client initialised there is no request to watch, so the only way to
 * know a click still produces its event is to read the capture where it is
 * decided. `support/analytics` explains the log this reads and its two rules —
 * a full page load empties it, a client-side navigation does not.
 *
 * What this spec is for: every event added when the app's analytics coverage
 * was closed up — the two analytics pages, the fridge sheet, the calendar view
 * switch, the transport map and run sheet, the deletions that make the `*_saved`
 * counts net rather than gross, the guest share wizard's four steps, and the two
 * preferences. Each test drives the real control and asserts both the name and
 * the properties, because a property nobody sends is the same as a missing
 * event to whoever is building the insight.
 *
 * Not covered here, and deliberately: `trip_sync_exported` / `trip_sync_imported`
 * need a camera scanning QR frames, the sign-in events need the stubbed backend
 * of the `sync` project, and the assistant's deletions need a WebGPU model. Those
 * three are the suite's existing boundaries, not new ones.
 *
 * @module e2e/analytics-events
 */

import { expect, test, type Page } from '@playwright/test';

import {
  capturedEventNames,
  clearCapturedEvents,
  stubPrintDialog,
  waitForCapturedProperties,
} from './support/analytics';
import { stubExternalMapServices } from './support/external-services';
import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import {
  seedExpense,
  seedPerson,
  seedRoom,
  seedTrip,
  seedVehicle,
} from './support/seed';
import { clearIndexedDB } from './support/storage';

// ============================================================================
// Constants
// ============================================================================

/**
 * Both locales, because the suite runs against whichever the browser asks for.
 *
 * Same convention as `vehicles.spec.ts`, which is where the delete flow below
 * comes from.
 */
const LABELS = {
  calendarView: /^calendar view$|^vue du calendrier$/i,
  timeline: /^timeline$|^chronologie$/i,
  print: /^print$|^imprimer$/i,
  delete: /^delete$|^supprimer$/i,
  deleteLine: /delete this line|supprimer cette ligne/i,
  deleteNamed: (name: string) => new RegExp(`(delete|supprimer) ${name}`, 'i'),
  theme: /^theme$|^thème$/i,
  dark: /^dark$|^sombre$/i,
  language: /^language$|^langue$/i,
  next: /^next$|^suivant$/i,
  skip: /skip for now|passer pour l'instant/i,
  letsGo: /let's go|c'est parti/i,
} as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Seeds one trip with a guest, a room and a line of spending.
 *
 * Everything is written **before** anything makes the trip current: `YjsTripSync`
 * projects its document over Dexie, and a raw write made afterwards races that
 * projection. Same rule every other spec here follows.
 *
 * @param page - Playwright page object
 * @returns The seeded trip's ids and its guest
 */
async function seedFurnishedTrip(page: Page): Promise<{
  readonly tripId: string;
  readonly shareId: string;
  readonly personId: string;
}> {
  await clearIndexedDB(page);

  const { tripId, shareId } = await seedTrip(page, {
    name: 'Analytics Events Trip',
    startDate: fixtureDate(20),
    endDate: fixtureDate(25),
  });
  const personId = await seedPerson(page, tripId, 'Alice', '#3b82f6');
  await seedRoom(page, { tripId, name: 'Blue Room', capacity: 2 });
  await seedExpense(page, {
    tripId,
    date: fixtureDate(21),
    title: 'Shopping',
    amount: 60,
    payerId: personId,
    splits: [{ personId, value: 1 }],
  });

  return { tripId, shareId, personId };
}

/**
 * Opens a route and waits for its lazy chunk and its live query to settle.
 *
 * @param page - Playwright page object
 * @param path - Path to open
 */
async function openRoute(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('load');
  await waitForRoute(page);
}

// ============================================================================
// Reading what the app worked out
// ============================================================================

test.describe('Analytics events: the pages that only ever read', () => {
  test('the trip analytics page reports the scope and what it had to show', async ({
    page,
  }) => {
    const { tripId } = await seedFurnishedTrip(page);

    await openRoute(page, `/trips/${tripId}/analytics`);

    expect(await waitForCapturedProperties(page, 'analytics_viewed')).toMatchObject({
      scope: 'trip',
      guest_count: 1,
      room_count: 1,
      expense_count: 1,
    });
  });

  test('the all-trips page reports the same event under the other scope', async ({
    page,
  }) => {
    await seedFurnishedTrip(page);

    await openRoute(page, '/analytics');

    expect(await waitForCapturedProperties(page, 'analytics_viewed')).toMatchObject({
      scope: 'all',
      trip_count: 1,
      guest_count: 1,
    });
  });

  test('the fridge sheet reports a print, with what was on the paper', async ({
    page,
  }) => {
    await stubPrintDialog(page);
    const { tripId } = await seedFurnishedTrip(page);

    await openRoute(page, `/trips/${tripId}/summary`);
    await page.getByRole('button', { name: LABELS.print }).click();

    expect(await waitForCapturedProperties(page, 'summary_printed')).toMatchObject({
      guest_count: 1,
      room_count: 1,
    });
  });

  test('switching the calendar view is captured, because navigation never happens', async ({
    page,
  }) => {
    const { tripId } = await seedFurnishedTrip(page);

    await openRoute(page, `/trips/${tripId}/calendar`);
    // The switch writes a query parameter and re-renders in place, so no
    // `$pageview` follows it — which is the whole reason this event exists.
    await clearCapturedEvents(page);
    await page
      .getByRole('radiogroup', { name: LABELS.calendarView })
      .getByRole('radio', { name: LABELS.timeline })
      .click();

    expect(await waitForCapturedProperties(page, 'calendar_view_changed')).toEqual({
      view: 'timeline',
    });
  });

  test('the run sheet and the map each say which view was opened', async ({ page }) => {
    await stubExternalMapServices(page);
    const { tripId } = await seedFurnishedTrip(page);

    await openRoute(page, `/trips/${tripId}/transports/runsheet`);
    expect(
      await waitForCapturedProperties(page, 'transports_view_opened'),
    ).toMatchObject({ view: 'runsheet', filter: 'all' });

    // A full load, so the log starts empty for the second half — see
    // `support/analytics`.
    await openRoute(page, `/trips/${tripId}/transports/map`);
    expect(
      await waitForCapturedProperties(page, 'transports_view_opened'),
    ).toMatchObject({ view: 'map' });
  });
});

// ============================================================================
// Deletions
// ============================================================================

test.describe('Analytics events: what is removed, not only what is added', () => {
  test('deleting a car is captured, so the saved count is not gross', async ({
    page,
  }) => {
    const { tripId } = await seedFurnishedTrip(page);
    await seedVehicle(page, { tripId, name: 'Espace de location' });

    await openRoute(page, `/trips/${tripId}/transports/vehicles`);
    await clearCapturedEvents(page);

    await page
      .getByRole('button', { name: LABELS.deleteNamed('Espace de location') })
      .click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: LABELS.delete }).click();

    expect(await waitForCapturedProperties(page, 'vehicle_deleted')).toEqual({
      remaining_count: 0,
    });
  });

  test('a deleted line reports the same shape a saved one does', async ({ page }) => {
    const { tripId } = await seedFurnishedTrip(page);

    await openRoute(page, `/trips/${tripId}/money?view=expenses`);
    await clearCapturedEvents(page);

    // The line's own dialog owns the delete, as `money-expenses.spec.ts` has
    // it: open the card, then delete from inside.
    await page.getByRole('button').filter({ hasText: 'Shopping' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: LABELS.deleteLine })
      .click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: LABELS.delete })
      .click();

    // The properties `expense_saved` carries, minus the operation — which is
    // what lets one breakdown subtract from the other.
    expect(await waitForCapturedProperties(page, 'expense_deleted')).toEqual({
      kind: 'expense',
      category: 'other',
      split_mode: 'equal',
      beneficiary_count: 1,
    });

    // Cleanup is not use: `app_used` shadows the saves, and counting a tidy-up
    // as engagement is exactly the reading `lib/posthog` refuses to produce.
    expect(await capturedEventNames(page)).not.toContain('app_used');
    expect(await capturedEventNames(page)).not.toContain('expense_saved');
  });
});

// ============================================================================
// The invitee funnel
// ============================================================================

test.describe('Analytics events: the guest share wizard', () => {
  test('every step reports itself, skips included', async ({ page }) => {
    const { shareId } = await seedFurnishedTrip(page);

    // One document for the whole wizard: each step navigates client-side, so
    // the four captures accumulate in one log and the funnel is assertable as
    // a sequence rather than as four separate readings.
    await openRoute(page, `/share/${shareId}/identity`);

    // Each step is waited for by its own capture rather than by the route: a
    // step page swaps in while the one before it is still unmounting, and a
    // click sent on that boundary lands on a button that is on its way out.
    // The capture is the one signal that the step actually advanced.
    const stepsReported = async (): Promise<number> =>
      (await capturedEventNames(page)).filter((name) => name === 'share_wizard_step')
        .length;

    await page.getByText('Alice').first().click();
    await page.getByRole('button', { name: LABELS.next }).click();
    await expect.poll(stepsReported).toBe(1);

    // Skipped rather than claimed, which is the outcome this step exists to
    // report: the room is the ask an invitee is least able to answer.
    await page.getByRole('button', { name: LABELS.skip }).click();
    await expect.poll(stepsReported).toBe(2);

    await page.getByRole('button', { name: LABELS.skip }).click();
    await expect.poll(stepsReported).toBe(3);

    await page.getByRole('button', { name: LABELS.letsGo }).click();

    await expect.poll(stepsReported).toBe(4);

    const steps = (await page.evaluate(
      () =>
        (
          window as Window & {
            __kikouchouAnalytics?: {
              event: string;
              properties?: Record<string, unknown>;
            }[];
          }
        ).__kikouchouAnalytics ?? [],
    ))
      .filter((entry) => entry.event === 'share_wizard_step')
      .map((entry) => ({
        step: entry.properties?.['step'],
        outcome: entry.properties?.['outcome'],
      }));

    expect(steps).toEqual([
      { step: 'identity', outcome: 'next' },
      { step: 'room', outcome: 'skip' },
      { step: 'transport', outcome: 'skip' },
      { step: 'summary', outcome: 'complete' },
    ]);
  });
});

// ============================================================================
// Preferences
// ============================================================================

test.describe('Analytics events: the two preferences', () => {
  test('changing the theme and the language is captured', async ({ page }) => {
    await clearIndexedDB(page);
    await openRoute(page, '/settings');
    await clearCapturedEvents(page);

    await page
      .getByRole('radiogroup', { name: LABELS.theme })
      .getByRole('radio', { name: LABELS.dark })
      .click();

    expect(await waitForCapturedProperties(page, 'theme_changed')).toEqual({
      theme: 'dark',
    });

    // Whichever language the browser asked for, pick the other one: a Radix
    // select fires no change for the value already selected, so hard-coding
    // one here would pass or fail by the runner's locale.
    const languageSelect = page.getByRole('combobox', { name: LABELS.language });
    const wasFrench = /français/i.test((await languageSelect.textContent()) ?? '');
    await languageSelect.click();
    await page
      .getByRole('option', { name: wasFrench ? /english/i : /français/i })
      .click();

    expect(await waitForCapturedProperties(page, 'language_changed')).toEqual({
      language: wasFrench ? 'en' : 'fr',
    });
  });
});
