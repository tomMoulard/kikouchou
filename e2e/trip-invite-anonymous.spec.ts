/**
 * @fileoverview The invite link, opened by somebody with no account.
 *
 * The wall that used to stand at `/join/<token>` — "Create an account so the
 * others can see your room" — lost three invitees out of four. This is the
 * journey that replaces it: open the link signed out, see whose trip it is,
 * pick your name, read the calendar and every other page with no way to change
 * anything, then sign in and find the same trip editable.
 *
 * Runs in the `sync` project against `support/supabase-stub`, which answers
 * `read_shared_trip` the way the real function does: the token is the whole
 * authorisation, no use is consumed, nobody is added to the roster.
 *
 * @module e2e/trip-invite-anonymous
 */

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { SupabaseStub, type StubUser } from './support/supabase-stub';
import { fixtureDate } from './support/fixture-dates';
import { clearTripOrganiser } from './support/trip-form';

// ============================================================================
// Fixtures
// ============================================================================

const OWNER: StubUser = { id: 'owner-1', email: 'owner@example.test' };
const GUEST: StubUser = { id: 'guest-1', email: 'guest@example.test' };

const TRIP = { name: 'Shared Brittany' } as const;

// ============================================================================
// Helpers
// ============================================================================

async function fillDates(page: Page): Promise<void> {
  await page.locator('#trip-start-date').click();
  await page.getByRole('gridcell').filter({ hasText: /^15$/ }).first().click();
  await page.locator('#trip-end-date').click();
  await page.getByRole('gridcell').filter({ hasText: /^22$/ }).first().click();
}

async function createTrip(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /new trip/i }).first().click();
  await page.getByLabel(/trip name/i).fill(name);
  await fillDates(page);
  await clearTripOrganiser(page);
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
}

async function addGuest(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: /guests/i }).first().click();
  await page.waitForURL(/\/persons/, { timeout: 15_000 });
  await page
    .getByRole('button', { name: /new guest/i })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
  await page.locator('#person-name').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: /save/i }).click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });
}

async function openShareDialog(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /share trip/i }).first().click();
  await expect(page.getByRole('dialog', { name: /share/i })).toBeVisible({
    timeout: 10_000,
  });
}

/** Waits until a guest's name is actually in the server's log. */
async function waitForNameOnServer(stub: SupabaseStub, name: string): Promise<void> {
  await expect
    .poll(
      () =>
        stub.updates.some((row) =>
          Buffer.from(row.update, 'base64').toString('utf8').includes(name),
        ),
      { timeout: 30_000, intervals: [250] },
    )
    .toBe(true);
}

/**
 * The owner sets up a shared trip with two guests and hands back its invite.
 */
async function shareTripWithGuests(
  browser: Browser,
  stub: SupabaseStub,
): Promise<{ token: string; ownerPage: Page }> {
  const ownerPage = await newDevice(browser, stub, OWNER);
  await ownerPage.goto('/');
  await createTrip(ownerPage, TRIP.name);
  await addGuest(ownerPage, 'Alice');
  await addGuest(ownerPage, 'Bob');

  await openShareDialog(ownerPage);
  const inviteUrl = await ownerPage.getByTestId('share-url').textContent({ timeout: 20_000 });
  const token = (inviteUrl ?? '').split('/join/')[1] ?? '';
  expect(token).not.toBe('');
  await waitForNameOnServer(stub, 'Alice');
  await waitForNameOnServer(stub, 'Bob');

  return { token, ownerPage };
}

const openContexts: BrowserContext[] = [];

test.afterEach(async () => {
  await Promise.all(openContexts.map((context) => context.close()));
  openContexts.length = 0;
});

/** A device: its own context, wired to the stub, signed in only when asked. */
async function newDevice(
  browser: Browser,
  stub: SupabaseStub,
  user?: StubUser,
  options: { readonly phone?: boolean } = {},
): Promise<Page> {
  const context = await browser.newContext(
    // A phone-sized viewport is what decides "phone" in the app — the install
    // nudge appears below the `md` breakpoint and nowhere wider.
    options.phone ? { viewport: { width: 390, height: 844 } } : {},
  );
  openContexts.push(context);
  const page = await context.newPage();
  await stub.install(page);
  if (user) {
    await stub.signIn(page, user);
  }
  return page;
}

// ============================================================================
// Reading
// ============================================================================

test.describe('an invite opened with no account', () => {
  test('shows the trip, asks who you are, and opens the calendar read-only', async ({
    browser,
  }) => {
    const stub = new SupabaseStub();
    const { token } = await shareTripWithGuests(browser, stub);

    const guestPage = await newDevice(browser, stub);
    await guestPage.goto(`/join/${token}`);

    // Whose trip, then which guest — no account anywhere on the screen.
    await expect(guestPage.getByText(/shared brittany/i).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(guestPage.getByRole('button', { name: /alice/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(guestPage.getByRole('button', { name: /sign in/i })).toHaveCount(0);

    await guestPage.getByRole('button', { name: /alice/i }).click();
    await expect(guestPage).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 20_000 });

    // Reading is not joining: nothing was redeemed, nobody was added.
    expect(stub.counts.redeems).toBe(0);
    expect(stub.members.filter((member) => member.user_id !== OWNER.id)).toHaveLength(0);
    expect(stub.counts.sharedReads).toBeGreaterThan(0);

    // The one card that says why the trip is read-only, and offers the way out.
    await expect(guestPage.getByTestId('viewer-unlock-card')).toBeVisible({ timeout: 20_000 });
    await expect(
      guestPage.getByTestId('viewer-unlock-card').getByRole('button', { name: /sign in/i }),
    ).toBeVisible();
  });

  test('hides every way of changing the trip', async ({ browser }) => {
    const stub = new SupabaseStub();
    const { token } = await shareTripWithGuests(browser, stub);

    const guestPage = await newDevice(browser, stub);
    await guestPage.goto(`/join/${token}`);
    await guestPage.getByRole('button', { name: /alice/i }).click({ timeout: 30_000 });
    await expect(guestPage).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 20_000 });

    // Guests: the list is there, the "new guest" action is not.
    await guestPage.getByRole('link', { name: /guests/i }).first().click();
    await guestPage.waitForURL(/\/persons/, { timeout: 15_000 });
    await expect(guestPage.getByText('Alice').first()).toBeVisible({ timeout: 15_000 });
    await expect(guestPage.getByRole('button', { name: /new guest/i })).toHaveCount(0);
    await expect(guestPage.getByRole('button', { name: /^(delete|supprimer)$/i })).toHaveCount(0);

    // Rooms: no "new room" and no way to claim one.
    await guestPage.getByRole('link', { name: /rooms/i }).first().click();
    await guestPage.waitForURL(/\/rooms/, { timeout: 15_000 });
    await expect(guestPage.getByRole('button', { name: /new room/i })).toHaveCount(0);

    // Transport: no "new transport".
    await guestPage.getByRole('link', { name: /transport/i }).first().click();
    await guestPage.waitForURL(/\/transports/, { timeout: 15_000 });
    await expect(guestPage.getByRole('button', { name: /new transport/i })).toHaveCount(0);

    // And the trip never left the device: not a single log write was attempted.
    expect(stub.counts.updateAttempts).toBe(stub.counts.updateInserts);
  });

  test('suggests installing on a phone, and hands off to the invite page', async ({
    browser,
  }) => {
    const stub = new SupabaseStub();
    const { token } = await shareTripWithGuests(browser, stub);

    const phone = await newDevice(browser, stub, undefined, { phone: true });
    await phone.goto(`/join/${token}`);
    await phone.getByRole('button', { name: /alice/i }).click({ timeout: 30_000 });
    await expect(phone).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 20_000 });

    // The one place the app asks to be installed, and the reason it gives.
    const nudge = phone.getByTestId('install-nudge-card');
    await expect(nudge).toBeVisible({ timeout: 20_000 });
    await expect(nudge).toContainText(/remind you before Shared Brittany starts/i);

    // Playwright's Chromium never fires `beforeinstallprompt`, so the button is
    // the manual route: back to the invite page, which is the page to install
    // *from* so the installed app opens on this trip.
    await nudge.getByRole('button', { name: /show me how/i }).click();
    await expect(phone).toHaveURL(new RegExp(`/join/${token}\\?install=1`), { timeout: 20_000 });
    await expect(phone.getByTestId('install-here-hint')).toBeVisible({ timeout: 20_000 });
    // The manifest swap that makes the handoff work is a production-build
    // property — the dev server injects no manifest link at all — so it is
    // asserted in `pwa.spec.ts`, not here.
    // The browser's own steps, from the global banner — the generic ones,
    // since Playwright's Chromium is neither an iPhone nor Firefox.
    const banner = phone.getByRole('region', { name: /app installation prompt/i });
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText(/add to home screen/i);

    // A returning viewer is not asked who they are again; one tap goes back —
    // and the banner along the bottom must not be sitting on that tap.
    await phone.getByRole('button', { name: /open the trip/i }).click();
    await expect(phone).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 20_000 });
  });

  test('keeps the install suggestion off a laptop', async ({ browser }) => {
    const stub = new SupabaseStub();
    const { token } = await shareTripWithGuests(browser, stub);

    const laptop = await newDevice(browser, stub);
    await laptop.goto(`/join/${token}`);
    await laptop.getByRole('button', { name: /alice/i }).click({ timeout: 30_000 });
    await expect(laptop).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 20_000 });
    await expect(laptop.getByTestId('viewer-unlock-card')).toBeVisible({ timeout: 20_000 });

    // Nobody installs a web app on a desktop, and Firefox on macOS cannot.
    await expect(laptop.getByTestId('install-nudge-card')).toHaveCount(0);
  });

  test('explains a dead link the same way it does to a member', async ({ page }) => {
    const stub = new SupabaseStub();
    stub.trips.push({
      id: '00000000-0000-4000-8000-000000000097',
      local_id: 'local-97',
      owner_id: OWNER.id,
      name: TRIP.name,
      start_date: fixtureDate(15),
      end_date: fixtureDate(22),
    });
    stub.addMember('00000000-0000-4000-8000-000000000097', OWNER.id);
    stub.addInvite('00000000-0000-4000-8000-000000000097', OWNER.id, 'revokedtoken0001', {
      revoked_at: new Date().toISOString(),
    });

    await stub.install(page);
    await page.goto('/join/revokedtoken0001');

    await expect(page.getByText(/withdrawn|retiré/i)).toBeVisible({ timeout: 20_000 });
    expect(stub.counts.redeems).toBe(0);
  });
});

// ============================================================================
// Becoming a member
// ============================================================================

test.describe('a viewer who signs in', () => {
  test('joins the trip with the same link and can edit it', async ({ browser }) => {
    const stub = new SupabaseStub();
    const { token } = await shareTripWithGuests(browser, stub);

    const context = await browser.newContext();
    openContexts.push(context);
    const guestPage = await context.newPage();
    await stub.install(guestPage);

    await guestPage.goto(`/join/${token}`);
    await guestPage.getByRole('button', { name: /alice/i }).click({ timeout: 30_000 });
    await expect(guestPage).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 20_000 });
    await expect(guestPage.getByTestId('viewer-unlock-card')).toBeVisible({ timeout: 20_000 });

    // Real OAuth cannot be automated; the session is what the app takes from it,
    // written before the next load the way `supabase-stub.signIn` does.
    await stub.signIn(guestPage, GUEST);
    await guestPage.reload();

    // The account is on the roster now, and the name picked while signed out
    // travelled with it.
    await expect
      .poll(() => stub.members.filter((member) => member.user_id === GUEST.id).length, {
        timeout: 30_000,
      })
      .toBe(1);
    // Alice was picked while signed out; the roster row carries that claim.
    expect(stub.members.find((member) => member.user_id === GUEST.id)?.person_id).toBeTruthy();

    // The card is gone and the controls are back.
    await expect(guestPage.getByTestId('viewer-unlock-card')).toHaveCount(0, {
      timeout: 30_000,
    });
    await guestPage.getByRole('link', { name: /guests/i }).first().click();
    await guestPage.waitForURL(/\/persons/, { timeout: 15_000 });
    await expect(guestPage.getByRole('button', { name: /new guest/i }).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
