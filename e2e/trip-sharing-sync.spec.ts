/**
 * @fileoverview E2E tests for the server-backed sharing journey.
 *
 * This is the flow the sync migration was for, and the one with no browser
 * coverage until now: create a trip with no account, share it, hand the link
 * over, join from a second device, pick an identity, and edit from both sides.
 *
 * Every bug that actually reached a user during this work was integration
 * shaped — boot ordering, an RLS-and-`RETURNING` interaction, a stale effect
 * dependency that reset a dialog forever. None of them were visible to the 3,000
 * unit tests, and all of them were visible the moment a real browser drove the
 * real flow. That is what this file is.
 *
 * The backend is `support/supabase-stub`, which implements the REST surface in
 * the Node process. Two browser contexts pointed at one stub are two devices
 * talking to one server. It deliberately does not enforce RLS — `supabase/tests`
 * does that against a real Postgres — and it refuses the Realtime socket, so
 * what is exercised here is the provider's pull path, which has to work anyway.
 *
 * @module e2e/trip-sharing-sync
 */

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { SupabaseStub, type StubUser } from './support/supabase-stub';

// ============================================================================
// Fixtures
// ============================================================================

const OWNER: StubUser = { id: 'owner-1', email: 'owner@example.test' };
const GUEST: StubUser = { id: 'guest-1', email: 'guest@example.test' };

const TRIP = { name: 'Shared Brittany' } as const;

// ============================================================================
// Helpers
// ============================================================================

/** Picks the 15th and 22nd in the trip form, as the offline spec does. */
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
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Adds a guest, which is what the identity step later offers to claim.
 *
 * Waits for the persons route before reaching for the add button, and matches it
 * on "new guest" rather than `/new|add/i`. The loose pattern also matches "New
 * trip" on the trip list, so whenever this ran before the navigation had settled
 * it opened the trip-creation form instead and then timed out waiting for a
 * dialog that was never going to appear.
 */
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

/**
 * Opens the share dialog from the trip card.
 *
 * Matched on `/share trip/i`, not `/share/i`: the trip list also carries an
 * "Import a shared trip using a QR code" button, and the looser pattern opened
 * that instead — which looks like a share dialog failing to render.
 */
async function openShareDialog(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /share trip/i }).first().click();
  await expect(page.getByRole('dialog', { name: /share/i })).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Waits until a name the invitee will need is actually in the server's log.
 *
 * The guests were added before the trip was shared, so they exist only on the
 * owner's device until the provider mounts and reconciles — the first-upload
 * path. Opening the join page before that lands leaves the invitee on "Getting
 * the trip…", and with Realtime refused here nothing prompts another pull, so
 * the wait has to happen on this side.
 *
 * Gated on the *content*, not on `updates.length`: the first row to arrive is
 * usually the trip's own metadata, so a row count is satisfied well before the
 * guests are up, which made this race rather than fixing it. Yjs writes string
 * values as plain UTF-8 inside the update, so the name is findable in the
 * decoded bytes.
 *
 * Worth recording as a product gap rather than a test artefact: in production
 * Realtime is what rescues that ordering, so a device joining during the window
 * with a blocked WebSocket sits there until something reloads it.
 */
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
 * Contexts opened by the current test, closed whatever the outcome.
 *
 * Closing only on the happy path meant a failing test leaked two contexts into
 * the next one, and the run degraded from there: the two tests at the tail of a
 * full run timed out while passing in isolation.
 */
const openContexts: BrowserContext[] = [];

test.afterEach(async () => {
  await Promise.all(openContexts.map((context) => context.close()));
  openContexts.length = 0;
});

/** A second device: its own context, wired to the stub and optionally signed in. */
async function newDevice(
  browser: Browser,
  stub: SupabaseStub,
  user?: StubUser,
): Promise<Page> {
  const context = await browser.newContext();
  openContexts.push(context);
  const page = await context.newPage();
  await stub.install(page);
  if (user) {
    await stub.signIn(page, user);
  }
  return page;
}

// ============================================================================
// Sharing — what the owner sees
// ============================================================================

test.describe('sharing a trip', () => {
  test('asks for an account rather than handing over a link that syncs with nobody', async ({
    page,
  }) => {
    const stub = new SupabaseStub();
    await stub.install(page);

    await page.goto('/');
    await createTrip(page, TRIP.name);
    await openShareDialog(page);

    await expect(
      page.getByRole('dialog').getByRole('button', { name: /sign in/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('share-url')).toHaveCount(0);
    // Nothing was uploaded: a trip nobody has shared must not touch the network.
    expect(stub.counts.tripInserts).toBe(0);
  });

  test('produces an invite link and its QR once signed in', async ({ page }) => {
    const stub = new SupabaseStub();
    await stub.install(page);
    await stub.signIn(page, OWNER);

    await page.goto('/');
    await createTrip(page, TRIP.name);
    await openShareDialog(page);

    const url = page.getByTestId('share-url');
    await expect(url).toBeVisible({ timeout: 20_000 });
    await expect(url).toContainText('/join/');

    // The QR encodes the same link, which is the whole point of showing both.
    await expect(page.getByRole('dialog').locator('svg').first()).toBeVisible();

    expect(stub.counts.tripInserts).toBe(1);
    expect(stub.counts.inviteInserts).toBe(1);
  });

  test('settles on the link instead of spinning while sync is active', async ({ page }) => {
    const stub = new SupabaseStub();
    await stub.install(page);
    await stub.signIn(page, OWNER);

    await page.goto('/');
    await createTrip(page, TRIP.name);
    await openShareDialog(page);

    const url = page.getByTestId('share-url');
    await expect(url).toBeVisible({ timeout: 20_000 });
    const first = await url.textContent();

    // The trip is now syncing, so the provider is writing to the `trips` table
    // as it projects. Keyed on the trip object, the dialog's effect restarted on
    // every one of those writes and dropped back to a spinner for good.
    await page.waitForTimeout(3_000);

    await expect(url).toBeVisible();
    expect(await url.textContent()).toBe(first);
    // And each restart repeated the server work, littering the trip with links.
    expect(stub.counts.inviteInserts).toBe(1);
  });

  test('uploads the document of a trip that is not the one currently open', async ({
    page,
  }) => {
    const stub = new SupabaseStub();
    await stub.install(page);
    await stub.signIn(page, OWNER);

    await page.goto('/');
    await createTrip(page, 'Brittany');
    await addGuest(page, 'Alice');

    // A second trip, which becomes the open one. Now the trip about to be
    // shared is not the current trip — the ordinary case when someone shares
    // from the list rather than from inside the trip.
    await page.goto('/');
    await createTrip(page, 'Corsica');

    // Scoped to Brittany's own card. `.first()` would be whichever card the list
    // happens to order first, and sharing Corsica instead would make the
    // assertion below meaningless rather than failing honestly.
    await page.goto('/');
    const brittanyCard = page
      .getByRole('button')
      .filter({ hasText: 'Brittany' })
      .first();
    await brittanyCard
      .getByRole('button', { name: /share trip/i })
      .click();
    await expect(page.getByTestId('share-url')).toBeVisible({ timeout: 20_000 });

    // Whichever of the two was shared, its contents have to reach the server:
    // handing over an invite whose document is empty leaves the invitee on
    // "Getting the trip…" forever, with only the name and dates showing because
    // those come from the preview row rather than from the document.
    await expect
      .poll(
        () =>
          stub.updates.some((row) =>
            Buffer.from(row.update, 'base64').toString('utf8').includes('Alice'),
          ),
        { timeout: 20_000, intervals: [500] },
      )
      .toBe(true);
  });

  test('reuses the live invite when the dialog is reopened', async ({ page }) => {
    const stub = new SupabaseStub();
    await stub.install(page);
    await stub.signIn(page, OWNER);

    await page.goto('/');
    await createTrip(page, TRIP.name);

    await openShareDialog(page);
    const firstUrl = await page.getByTestId('share-url').textContent({ timeout: 20_000 });

    await page.keyboard.press('Escape');
    await openShareDialog(page);
    const secondUrl = await page.getByTestId('share-url').textContent({ timeout: 20_000 });

    // A link already handed out has to keep working, and three opens must not
    // leave three live links on the trip.
    expect(secondUrl).toBe(firstUrl);
    expect(stub.counts.inviteInserts).toBe(1);
  });

  test('explains itself when the build has no backend at all', async ({ page }) => {
    // No stub installed and no session: `isSupabaseConfigured()` is still true
    // for this project, so the request fails rather than being absent. Either
    // way the dialog must say something instead of loading forever.
    await page.goto('/');
    await createTrip(page, TRIP.name);
    await openShareDialog(page);

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('alert').or(dialog.getByRole('button', { name: /sign in/i })),
    ).toBeVisible({ timeout: 20_000 });
  });
});

// ============================================================================
// Joining — what the invitee sees
// ============================================================================

test.describe('joining a trip', () => {
  test('redeems the invite, offers the participants, and opens the trip', async ({
    browser,
  }) => {
    const stub = new SupabaseStub();
    const ownerPage = await newDevice(browser, stub, OWNER);

    await ownerPage.goto('/');
    await createTrip(ownerPage, TRIP.name);
    await addGuest(ownerPage, 'Alice');
    await addGuest(ownerPage, 'Bob');

    await openShareDialog(ownerPage);
    const inviteUrl = await ownerPage
      .getByTestId('share-url')
      .textContent({ timeout: 20_000 });
    expect(inviteUrl).toBeTruthy();
    const token = (inviteUrl ?? '').split('/join/')[1] ?? '';
    expect(token).not.toBe('');
    await waitForNameOnServer(stub, 'Alice');
    await waitForNameOnServer(stub, 'Bob');

    // A second device, a second account, the same server.
    const guestPage = await newDevice(browser, stub, GUEST);
    await guestPage.goto(`/join/${token}`);

    // Redemption put the account on the roster.
    await expect
      .poll(() => stub.members.filter((m) => m.user_id === GUEST.id).length, {
        timeout: 20_000,
      })
      .toBe(1);

    // The identity step can only offer names the document brought down, so this
    // also proves the trip's contents synced to a device that never had them.
    await expect(guestPage.getByText(/which one are you/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(guestPage.getByRole('button', { name: /alice/i })).toBeVisible({
      timeout: 30_000,
    });

    await guestPage.getByRole('button', { name: /alice/i }).click();

    // Claimed on the server, not merely in the UI.
    await expect
      .poll(
        () =>
          stub.members.find((m) => m.user_id === GUEST.id)?.person_id ?? null,
        { timeout: 20_000 },
      )
      .not.toBeNull();

    await expect(guestPage).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 20_000 });

  });

  test('lets an invitee into a trip that has no participants', async ({ browser }) => {
    const stub = new SupabaseStub();
    const ownerPage = await newDevice(browser, stub, OWNER);

    // No guests at all. The reported case: the owner shares a trip before adding
    // anyone, which is the natural order — you share it *so that* people get
    // added.
    await ownerPage.goto('/');
    await createTrip(ownerPage, TRIP.name);

    await openShareDialog(ownerPage);
    const inviteUrl = await ownerPage
      .getByTestId('share-url')
      .textContent({ timeout: 20_000 });
    const token = (inviteUrl ?? '').split('/join/')[1] ?? '';
    expect(token).not.toBe('');

    const guestPage = await newDevice(browser, stub, GUEST);
    await guestPage.goto(`/join/${token}`);

    // The identity step has nobody to offer, and used to spin on "Getting the
    // trip…" indefinitely waiting for participants that did not exist. It has to
    // reach an end and let them in.
    await expect(
      guestPage.getByRole('button', { name: /open the trip/i }),
    ).toBeVisible({ timeout: 30_000 });

    await guestPage.getByRole('button', { name: /open the trip/i }).click();
    await expect(guestPage).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 20_000 });
  });

  test('does not offer a participant another account has claimed', async ({ browser }) => {
    const stub = new SupabaseStub();
    const ownerPage = await newDevice(browser, stub, OWNER);

    await ownerPage.goto('/');
    await createTrip(ownerPage, TRIP.name);
    await addGuest(ownerPage, 'Alice');
    await addGuest(ownerPage, 'Bob');

    await openShareDialog(ownerPage);
    const inviteUrl = await ownerPage
      .getByTestId('share-url')
      .textContent({ timeout: 20_000 });
    const token = (inviteUrl ?? '').split('/join/')[1] ?? '';
    await waitForNameOnServer(stub, 'Alice');
    await waitForNameOnServer(stub, 'Bob');

    const guestPage = await newDevice(browser, stub, GUEST);
    await guestPage.goto(`/join/${token}`);
    await expect(guestPage.getByText(/which one are you/i)).toBeVisible({
      timeout: 30_000,
    });

    // Somebody else takes Alice while this page is open. Offering her anyway
    // means the claim fails at the last moment with nothing useful to say.
    const alicePersonId = await guestPage.evaluate(async () => {
      const request = indexedDB.open('kikouchou');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows = await new Promise<{ id: string; name: string }[]>((resolve) => {
        const all = database.transaction('persons').objectStore('persons').getAll();
        all.onsuccess = () => resolve(all.result as { id: string; name: string }[]);
      });
      return rows.find((row) => row.name === 'Alice')?.id ?? null;
    });
    expect(alicePersonId).not.toBeNull();

    stub.addMember(stub.trips[0]!.id, 'someone-else', alicePersonId);
    await guestPage.reload();

    await expect(guestPage.getByRole('button', { name: /bob/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(guestPage.getByRole('button', { name: /^alice$/i })).toHaveCount(0);

  });

  test('rejects a token that does not exist', async ({ page }) => {
    const stub = new SupabaseStub();
    await stub.install(page);
    await stub.signIn(page, GUEST);

    await page.goto('/join/doesnotexist12');

    await expect(page.getByText(/link|invite|not/i).first()).toBeVisible({
      timeout: 20_000,
    });
    // Nothing was created for a token the server never issued.
    expect(stub.members.filter((m) => m.user_id === GUEST.id)).toHaveLength(0);
  });

  test('rejects a revoked token', async ({ page }) => {
    const stub = new SupabaseStub();
    stub.trips.push({
      id: '00000000-0000-4000-8000-000000000099',
      local_id: 'local-99',
      owner_id: OWNER.id,
      name: TRIP.name,
      start_date: '2026-07-15',
      end_date: '2026-07-22',
    });
    stub.addMember('00000000-0000-4000-8000-000000000099', OWNER.id);
    stub.addInvite('00000000-0000-4000-8000-000000000099', OWNER.id, 'revokedtoken1', {
      revoked_at: new Date().toISOString(),
    });

    await stub.install(page);
    await stub.signIn(page, GUEST);
    await page.goto('/join/revokedtoken1');

    // The app's own words, not a loose alternation: "withdrawn" is the copy, and
    // a pattern broad enough to miss it is a pattern broad enough to pass on the
    // wrong screen.
    await expect(page.getByText(/withdrawn/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/fresh link/i).first()).toBeVisible();
    expect(stub.members.filter((m) => m.user_id === GUEST.id)).toHaveLength(0);
  });

  test('asks an unsigned-in invitee to register first', async ({ page }) => {
    const stub = new SupabaseStub();
    stub.trips.push({
      id: '00000000-0000-4000-8000-000000000098',
      local_id: 'local-98',
      owner_id: OWNER.id,
      name: TRIP.name,
      start_date: '2026-07-15',
      end_date: '2026-07-22',
    });
    stub.addMember('00000000-0000-4000-8000-000000000098', OWNER.id);
    stub.addInvite('00000000-0000-4000-8000-000000000098', OWNER.id, 'needsaccount1');

    await stub.install(page);
    await page.goto('/join/needsaccount1');

    // Joining is one of the two operations allowed to require an account.
    await expect(page.getByRole('button', { name: /sign in|continue with google/i }).first()).toBeVisible({
      timeout: 20_000,
    });
    expect(stub.counts.redeems).toBe(0);
  });

  test('opening the same invite twice does not create a second trip', async ({ page }) => {
    const stub = new SupabaseStub();
    stub.trips.push({
      id: '00000000-0000-4000-8000-000000000097',
      local_id: 'local-97',
      owner_id: OWNER.id,
      name: TRIP.name,
      start_date: '2026-07-15',
      end_date: '2026-07-22',
    });
    stub.addMember('00000000-0000-4000-8000-000000000097', OWNER.id);
    stub.addInvite('00000000-0000-4000-8000-000000000097', OWNER.id, 'twicetoken12', {
      max_uses: 1,
    });

    await stub.install(page);
    await stub.signIn(page, GUEST);

    await page.goto('/join/twicetoken12');
    await expect
      .poll(() => stub.members.filter((m) => m.user_id === GUEST.id).length, {
        timeout: 20_000,
      })
      .toBe(1);

    await page.goto('/join/twicetoken12');
    await page.waitForTimeout(2_000);

    // Idempotent for an existing member, and the single use is not burned twice.
    expect(stub.members.filter((m) => m.user_id === GUEST.id)).toHaveLength(1);
    expect(stub.invites[0]?.uses).toBe(1);

    const localTrips = await page.evaluate(async () => {
      const request = indexedDB.open('kikouchou');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return await new Promise<number>((resolve) => {
        const count = database.transaction('trips').objectStore('trips').count();
        count.onsuccess = () => resolve(count.result);
      });
    });
    expect(localTrips).toBe(1);
  });
});

// ============================================================================
// Two devices
// ============================================================================

test.describe('two devices on one trip', () => {
  test('an edit made on one reaches the other', async ({ browser }) => {
    const stub = new SupabaseStub();
    const ownerPage = await newDevice(browser, stub, OWNER);

    await ownerPage.goto('/');
    await createTrip(ownerPage, TRIP.name);
    await addGuest(ownerPage, 'Alice');

    await openShareDialog(ownerPage);
    const inviteUrl = await ownerPage
      .getByTestId('share-url')
      .textContent({ timeout: 20_000 });
    const token = (inviteUrl ?? '').split('/join/')[1] ?? '';
    await waitForNameOnServer(stub, 'Alice');

    const guestPage = await newDevice(browser, stub, GUEST);
    await guestPage.goto(`/join/${token}`);
    await expect(guestPage.getByText(/which one are you/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(guestPage.getByRole('button', { name: /alice/i })).toBeVisible({
      timeout: 30_000,
    });
    await guestPage.getByRole('button', { name: /alice/i }).click();
    await expect(guestPage).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 20_000 });

    // A new guest on the owner's device, after the invitee is already in.
    await ownerPage.keyboard.press('Escape');
    await addGuest(ownerPage, 'Carol');

    // On the server before the invitee is asked to see it, so a failure below is
    // about delivery rather than about the owner not having pushed yet.
    await waitForNameOnServer(stub, 'Carol');

    // Nudge the invitee instead of reloading it. Realtime is refused by the stub
    // on purpose, so what has to work here is the pull path — and `online` is
    // exactly what triggers it in production when connectivity returns. The
    // earlier version reloaded the whole app on every poll attempt, which boots
    // the bundle each time: it passed alone in 22 s and timed out inside a full
    // run, which is a property of the harness rather than of the app.
    await guestPage.getByRole('link', { name: /guests/i }).first().click();
    await guestPage.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    await expect(guestPage.getByText('Carol').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('edits made while the server is unreachable arrive once it is back', async ({
    browser,
  }) => {
    const stub = new SupabaseStub();
    const ownerPage = await newDevice(browser, stub, OWNER);

    await ownerPage.goto('/');
    await createTrip(ownerPage, TRIP.name);
    await openShareDialog(ownerPage);
    await expect(ownerPage.getByTestId('share-url')).toBeVisible({ timeout: 20_000 });
    await ownerPage.keyboard.press('Escape');

    const before = stub.counts.updateInserts;

    // The server goes away. The app must keep taking edits.
    stub.offline = true;
    await addGuest(ownerPage, 'Offline Dave');
    await ownerPage.waitForTimeout(2_000);
    expect(stub.counts.updateInserts).toBe(before);

    // And send them when it comes back, with no user action.
    stub.offline = false;
    await ownerPage.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    await expect
      .poll(() => stub.counts.updateInserts, { timeout: 60_000, intervals: [2_000] })
      .toBeGreaterThan(before);

  });
});
