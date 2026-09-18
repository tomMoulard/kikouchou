/**
 * @fileoverview A trip template link, opened by somebody with no account.
 *
 * This is the enterprise story end to end, in a real browser: a hotel publishes
 * one trip, puts the link in its own web page, and a customer who has never
 * heard of this app clicks it and ends up with their own trip. The place, the
 * map pin, the currency and the rooms arrive with the template; the customer
 * answers three questions.
 *
 * The unit tests prove each piece. What only a browser proves is that the three
 * pieces meet: a route outside the app chrome, an anonymous RPC, and a wizard
 * whose flow changes shape when it is handed a prefill.
 *
 * Runs in the `sync` project against `support/supabase-stub`, which answers
 * `read_trip_template` the way the real function does — five fields, and one
 * hint for every dead end.
 *
 * @module e2e/trip-template-link
 */

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { SupabaseStub, type TemplatePayload } from './support/supabase-stub';

// ============================================================================
// Fixtures
// ============================================================================

const TOKEN = 'templatetoken001';

const TEMPLATE: TemplatePayload = {
  name: 'Chalet Marmotte',
  description: 'Check-in after 3pm. Bring indoor shoes.',
  location: 'Chamonix',
  coordinates: { lat: 45.9237, lon: 6.8694 },
  currency: 'EUR',
  rooms: [
    { name: 'Attic', capacity: 4, icon: 'bunk-bed' },
    { name: 'Suite', capacity: 2 },
  ],
};

const openContexts: BrowserContext[] = [];

test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((context) => context.close()));
});

// ============================================================================
// Helpers
// ============================================================================

/** A browser with the stub installed and nobody signed in. */
async function newVisitor(browser: Browser, stub: SupabaseStub): Promise<Page> {
  const context = await browser.newContext();
  openContexts.push(context);
  const page = await context.newPage();
  await stub.install(page);
  return page;
}

/** Picks the 15th and the 22nd of whatever month the picker opens on. */
async function fillDates(page: Page): Promise<void> {
  await page.getByRole('button', { name: /trip dates/i }).click();
  await page.getByRole('gridcell').filter({ hasText: /^15$/ }).first().click();
  await page.getByRole('gridcell').filter({ hasText: /^22$/ }).first().click();
}

// ============================================================================
// Tests
// ============================================================================

test.describe('a trip template link opened with no account', () => {
  test('asks three questions and makes the customer their own trip', async ({ browser }) => {
    const stub = new SupabaseStub();
    stub.templates.set(TOKEN, TEMPLATE);

    const page = await newVisitor(browser, stub);
    await page.goto(`/template/${TOKEN}`);

    // What the enterprise published, including the description that tells the
    // customer which dates and which guests to put in.
    await expect(page.getByText('Chalet Marmotte').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/bring indoor shoes/i)).toBeVisible();
    await expect(page.getByText('Chamonix').first()).toBeVisible();

    // No account is asked for anywhere on this screen.
    await expect(page.getByRole('button', { name: /^sign in$/i })).toHaveCount(0);

    // Three questions, not five: the place and the rooms came with the link.
    await expect(page.getByText('What is the trip called?')).toBeVisible();
    await page.getByLabel('Trip name').fill('Ski week');
    await page.getByRole('button', { name: /^next$/i }).click();

    await expect(page.getByText('When is it?')).toBeVisible();
    await fillDates(page);
    await page.getByRole('button', { name: /^next$/i }).click();

    await expect(page.getByText('Who is coming?')).toBeVisible();
    await expect(page.getByText('Where is the house?')).toHaveCount(0);
    await expect(page.getByText('Which rooms are there?')).toHaveCount(0);

    await page.getByLabel('Guest name').fill('Alice');
    await page.getByLabel('Guest name').press('Enter');
    await page.getByRole('button', { name: /create the trip/i }).click();

    await expect(page.getByTestId('trip-wizard-done')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/ski week is ready/i)).toBeVisible();

    await page.getByRole('button', { name: /open the calendar/i }).click();
    await expect(page).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 30_000 });

    // The template's rooms came with it, under the names the enterprise gave.
    await page.getByRole('link', { name: /^(rooms|chambres)$/i }).first().click();
    await page.waitForURL(/\/rooms/, { timeout: 20_000 });
    await expect(page.getByText('Attic').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Suite').first()).toBeVisible();

    // Local, and only local: the enterprise never sees this trip.
    expect(stub.counts.templateReads).toBeGreaterThan(0);
    expect(stub.counts.tripInserts).toBe(0);
    expect(stub.trips).toHaveLength(0);
  });

  test('says so, and offers a trip of their own, when the template is gone', async ({
    browser,
  }) => {
    const stub = new SupabaseStub();
    // Nothing published under this token: unpublished, deleted, or never real.
    const page = await newVisitor(browser, stub);

    await page.goto(`/template/${TOKEN}`);

    await expect(page.getByText(/isn't available/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /new trip/i })).toBeVisible();
    await expect(page.getByText('Chalet Marmotte')).toHaveCount(0);
  });

  test('refuses a path that is not shaped like a token, without asking the server', async ({
    browser,
  }) => {
    const stub = new SupabaseStub();
    stub.templates.set(TOKEN, TEMPLATE);

    const page = await newVisitor(browser, stub);
    await page.goto('/template/short');

    await expect(page.getByText(/isn't available/i)).toBeVisible({ timeout: 30_000 });
    expect(stub.counts.templateReads).toBe(0);
  });
});
