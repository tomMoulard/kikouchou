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
import { fixtureDate } from './support/fixture-dates';
import { clearTripOrganiser } from './support/trip-form';

// ============================================================================
// Fixtures
// ============================================================================

const OWNER: StubUser = { id: 'owner-1', email: 'owner@example.test' };
const GUEST: StubUser = { id: 'guest-1', email: 'guest@example.test' };

const TRIP = { name: 'Shared Brittany' } as const;

/**
 * The window the trips seeded straight into the stub sit in.
 *
 * Derived from today — see `support/fixture-dates`. These were pinned to July
 * 2026, which is behind us; a joined trip that has already happened is rendered
 * as a past trip, which is not the state any of these tests mean to assert.
 * Trips created through the form get their dates from `fillDates` instead.
 */
const SEEDED_TRIP_DATES = {
  startDate: fixtureDate(15),
  endDate: fixtureDate(22),
} as const;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Picks the 15th and 22nd in the trip form, as the offline spec does.
 *
 * Days of the month the picker opens on — always the current one — so there is
 * no fixture date here to go stale.
 */
async function fillDates(page: Page): Promise<void> {
  await page.locator('#trip-start-date').click();
  await page.getByRole('gridcell').filter({ hasText: /^15$/ }).first().click();
  await page.locator('#trip-end-date').click();
  await page.getByRole('gridcell').filter({ hasText: /^22$/ }).first().click();
}

/**
 * Creates a trip with nobody on its guest list.
 *
 * Unlike the rest of the suite these tests are signed in, so the create form
 * pre-fills its first guest row from the account — which would put a guest
 * named "owner" on every trip here, and leave the tests that add Alice and Bob
 * asserting against a roster they did not write. Each test says who is on its
 * trip, through `addGuest`.
 */
async function createTrip(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /new trip/i }).first().click();
  await page.getByLabel(/trip name/i).fill(name);
  await fillDates(page);
  await clearTripOrganiser(page);
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
 * Renames a trip through the edit form.
 *
 * Navigated to directly rather than through the card's overflow menu, which the
 * trip list does not render — it passes `onShare` and nothing else. The local
 * `TripId` travels to the server as `local_id`, so the stub's own row is where
 * the route parameter comes from, which also means the test cannot rename a
 * different trip than the one it is about to make assertions on.
 */
async function renameTrip(page: Page, localTripId: string, to: string): Promise<void> {
  await page.goto(`/trips/${localTripId}/edit`);
  const name = page.getByLabel(/trip name/i);
  await expect(name).toBeVisible({ timeout: 20_000 });
  await name.fill(to);
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText(to).first()).toBeVisible({ timeout: 20_000 });
}

/** How many rows the outbox is holding for delivery, read from IndexedDB. */
async function outboxDepth(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const request = indexedDB.open('kikouchou');
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return await new Promise<number>((resolve) => {
      const count = database.transaction('yjsOutbox').objectStore('yjsOutbox').count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => resolve(0);
    });
  });
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

    // Scoped to Brittany's own card, and asserted to be exactly one: `.first()`
    // would be whichever card the list happens to order first, and sharing
    // Corsica instead would make the assertion below meaningless rather than
    // failing honestly.
    //
    // The list item, not the button. The card's activation target is now a real
    // button overlaying the card, sibling to the share button rather than parent
    // of it — the fix for `nested-interactive` — so `getByRole('button')` here
    // resolves to that overlay, which contains nothing to click.
    await page.goto('/');
    const brittanyCard = page.getByRole('listitem').filter({ hasText: 'Brittany' });
    await expect(brittanyCard).toHaveCount(1);
    await brittanyCard.getByRole('button', { name: /share trip/i }).click();
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

    // Claimed on the server, not merely in the UI — and in two steps, because
    // one is not enough to say *whose* claim it was.
    //
    // First: a claim landed on somebody's roster row.
    await expect
      .poll(() => stub.members.filter((m) => m.person_id !== null).length, {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    // Then: it landed on this account's row and on no other. `members claim
    // their own identity` is `using (user_id = auth.uid())`, so the subject of
    // the write is the bearer token, never the `?user_id=eq.` the client sent —
    // which the stub used to take at its word, obligingly writing a claim onto
    // another account's row when asked to. Asserting only that the guest's own
    // row is set cannot see that: it fails either way once the client names the
    // wrong account. This is the assertion that tells the two apart.
    expect(
      stub.members.filter((m) => m.user_id !== GUEST.id && m.person_id !== null),
    ).toHaveLength(0);
    expect(stub.members.find((m) => m.user_id === GUEST.id)?.person_id).toBeTruthy();

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
      start_date: SEEDED_TRIP_DATES.startDate,
      end_date: SEEDED_TRIP_DATES.endDate,
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
      start_date: SEEDED_TRIP_DATES.startDate,
      end_date: SEEDED_TRIP_DATES.endDate,
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
      start_date: SEEDED_TRIP_DATES.startDate,
      end_date: SEEDED_TRIP_DATES.endDate,
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

    const landed = stub.counts.updateInserts;
    const offered = stub.counts.updateAttempts;

    // The server goes away. The app must keep taking edits.
    stub.offline = true;
    await addGuest(ownerPage, 'Offline Dave');

    // Taken and kept. An offline-first app adding a guest with no server is
    // adding a guest, not failing.
    await expect(ownerPage.getByText('Offline Dave').first()).toBeVisible({
      timeout: 15_000,
    });

    // Offered, which is the half `stub.offline` alone can never show: the route
    // is aborted before any handler runs, so `updateInserts` cannot move
    // whatever the client does, and asserting it stayed put asserts the stub.
    // `updateAttempts` is counted on the way in, so this fails for a client that
    // queued nothing — the outcome the old assertion could not distinguish.
    await expect
      .poll(() => stub.counts.updateAttempts, { timeout: 20_000, intervals: [250] })
      .toBeGreaterThan(offered);

    // Held, not dropped: the edit is still in the queue, in the browser.
    expect(await outboxDepth(ownerPage)).toBeGreaterThan(0);

    // And nothing landed, because nothing could.
    expect(stub.counts.updateInserts).toBe(landed);

    // Measured, not asserted, and recorded because the number is a surprise: in
    // the six seconds after the edit the client makes *no* further push attempt
    // at all — not a bounded one. Neither `BACKOFF_MS` set to 1 ms nor
    // `noteFailure` calling `syncNow()` directly changes it, so the queued edit
    // waits for an external trigger (the `online` event below, or tab focus)
    // rather than for the retry schedule. A bound on retry storms is therefore
    // unexercisable from here today: any number it asserted would pass at zero.
    // Worth a look on its own — a device that never regains `online` holds the
    // edit indefinitely — but it is not this test's claim to make.

    // And send them when it comes back, with no user action.
    stub.offline = false;
    await ownerPage.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    await expect
      .poll(() => stub.counts.updateInserts, { timeout: 60_000, intervals: [2_000] })
      .toBeGreaterThan(landed);

    // Drained rather than merely overtaken: rows the server took are
    // acknowledged, so a reconnect does not leave the queue growing forever.
    await expect
      .poll(() => outboxDepth(ownerPage), { timeout: 30_000, intervals: [1_000] })
      .toBe(0);
  });
});

// ============================================================================
// One account, several devices
// ============================================================================

/**
 * The promise an account makes that a share link does not: sign in on the phone
 * and on the laptop, and the trips are the same on both.
 *
 * Everything above this point needs somebody to press *Share* and somebody else
 * to open a link. That is the right shape for handing a trip to a friend, and
 * the wrong shape for your own second device — which is what people assume
 * signing in is for. `lib/sync/AccountTripSync` is the sweep that closes it, and
 * these are the orders it has to work in: signed in before the trip existed,
 * signed in afterwards, and signed in again on a device it has already swept.
 *
 * Deliberately no invite anywhere in this block. A test that shared the trip
 * would pass with the sweep deleted.
 */
test.describe('one account, two devices', () => {
  test('a trip made on one device turns up on the other, with its contents', async ({
    browser,
  }) => {
    const stub = new SupabaseStub();

    // The phone: signed in, makes a trip, never opens the share dialog.
    const phone = await newDevice(browser, stub, OWNER);
    await phone.goto('/');
    await createTrip(phone, TRIP.name);
    await addGuest(phone, 'Alice');
    await waitForNameOnServer(stub, 'Alice');

    // The laptop: same account, nothing local, no link to follow.
    const laptop = await newDevice(browser, stub, OWNER);
    await laptop.goto('/');

    await expect(laptop.getByText(TRIP.name).first()).toBeVisible({ timeout: 30_000 });

    // The row alone would satisfy the assertion above while leaving the trip
    // empty — a name and two dates from the preview, and nothing behind them.
    // The guest is what proves the document came too.
    //
    // Opened through the card's overlay button rather than its text: the card
    // lays a full-bleed button over everything it renders, so a click on the
    // name is intercepted by it and retries until the test times out.
    await laptop
      .getByRole('button', { name: new RegExp(TRIP.name, 'i') })
      .first()
      .click();
    await expect(laptop).toHaveURL(/\/trips\/[^/]+\/calendar/, { timeout: 20_000 });
    await laptop.getByRole('link', { name: /guests/i }).first().click();
    await expect(laptop.getByText('Alice').first()).toBeVisible({ timeout: 30_000 });
  });

  test('a trip that predates the account goes up when its owner signs in', async ({
    browser,
  }) => {
    const stub = new SupabaseStub();

    // The order the app is actually used in: trips first, an account later. The
    // trip is created with no session at all, which is the local-only mode the
    // whole app is built around.
    const phone = await newDevice(browser, stub);
    await phone.goto('/');
    await createTrip(phone, TRIP.name);
    expect(stub.trips).toHaveLength(0);

    // Signing in. The stub writes the session as an init script, so the reload
    // is what a redirect back from the provider would have been.
    await stub.signIn(phone, OWNER);
    await phone.reload();

    await expect
      .poll(() => stub.trips.length, { timeout: 30_000, intervals: [250] })
      .toBe(1);

    const laptop = await newDevice(browser, stub, OWNER);
    await laptop.goto('/');
    await expect(laptop.getByText(TRIP.name).first()).toBeVisible({ timeout: 30_000 });
  });

  test('signing in does not fork a trip that is already on the server', async ({
    browser,
  }) => {
    const stub = new SupabaseStub();

    const phone = await newDevice(browser, stub, OWNER);
    await phone.goto('/');
    await createTrip(phone, TRIP.name);
    await expect
      .poll(() => stub.trips.length, { timeout: 30_000, intervals: [250] })
      .toBe(1);

    // Relaunching sweeps again, and the sweep must recognise its own work. The
    // failure this guards is a second row per launch — `unique (owner_id,
    // local_id)` refuses it on the server, but a sweep that kept trying would
    // spend a request per trip per launch discovering that.
    const inserts = stub.counts.tripInserts;
    await phone.reload();
    await expect(phone.getByText(TRIP.name).first()).toBeVisible({ timeout: 20_000 });

    // A fixed wait, which is right for once: the assertion is that something
    // never happens, and there is no event to poll for the absence of an insert.
    // The trip list rendering above already proves the app has booted and the
    // sweep has had its chance.
    await phone.waitForTimeout(2_000);
    expect(stub.trips).toHaveLength(1);
    expect(stub.counts.tripInserts).toBe(inserts);
  });
});

// ============================================================================
// The denormalised preview
// ============================================================================

/**
 * The `trips` row's name and dates — a cache, and the only thing a device has
 * for a trip it is a member of but has never downloaded.
 *
 * None of this was testable until the stub stopped answering `200 []` to every
 * `PATCH trips`. That answer told the client a write it had never made had
 * succeeded, which is precisely the bug it was hiding: `owners update their
 * trips` narrows the UPDATE to rows this account owns, so on a guest's device it
 * matched nothing — and an UPDATE matching nothing succeeds, with no error and
 * no rows.
 */
test.describe('the trip preview on the server', () => {
  test("follows the owner's rename", async ({ page }) => {
    const stub = new SupabaseStub();
    await stub.install(page);
    await stub.signIn(page, OWNER);

    await page.goto('/');
    await createTrip(page, TRIP.name);
    await openShareDialog(page);
    await expect(page.getByTestId('share-url')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');

    const row = stub.trips[0];
    expect(row?.name).toBe(TRIP.name);

    await renameTrip(page, row!.local_id, 'Renamed Brittany');

    // The row itself, not the absence of an error. Another device's trip list
    // renders this before it has hydrated anything, so a preview left behind is
    // a wrong name on somebody else's screen for as long as they never open it.
    await expect
      .poll(() => stub.trips[0]?.name, { timeout: 30_000, intervals: [500] })
      .toBe('Renamed Brittany');
  });

  test('is republished when the row has drifted from the trip', async ({ page }) => {
    const stub = new SupabaseStub();
    await stub.install(page);
    await stub.signIn(page, OWNER);

    await page.goto('/');
    await createTrip(page, TRIP.name);
    await openShareDialog(page);
    await expect(page.getByTestId('share-url')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');

    // The row now says something the trip does not — a rename this device made
    // while the write was refused, a restore from an older backup. The preview
    // is allowed to lag; it is not allowed to lag for good.
    stub.trips[0]!.name = 'A name this trip has not had for months';

    // Re-shared without reloading, deliberately. A reload would remount
    // `SupabaseTripSync`, whose own effect republishes the preview on mount, and
    // this test would then pass with `ensureRemoteTrip`'s reconciliation removed
    // entirely. Sharing is the moment the preview is about to become somebody
    // else's only source, so it is where it has to be put right.
    await page.getByRole('button', { name: /share trip/i }).first().click();
    await expect(page.getByTestId('share-url')).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(() => stub.trips[0]?.name, { timeout: 30_000, intervals: [500] })
      .toBe(TRIP.name);
  });

  test("says so out loud when a guest's device cannot maintain it", async ({
    browser,
  }) => {
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

    // Collected before the join, because the preview write happens as soon as
    // the guest's device settles on the trip.
    const notApplied: string[] = [];
    guestPage.on('console', (message) => {
      if (message.text().includes('trip preview')) {
        notApplied.push(message.text());
      }
    });

    await guestPage.goto(`/join/${token}`);
    await expect(guestPage.getByRole('button', { name: /alice/i })).toBeVisible({
      timeout: 30_000,
    });
    await guestPage.getByRole('button', { name: /alice/i }).click();
    await expect(guestPage).toHaveURL(/\/trips\/([^/]+)\/calendar/, { timeout: 20_000 });
    const guestTripId = (/\/trips\/([^/]+)\//.exec(guestPage.url()) ?? [])[1] ?? '';
    expect(guestTripId).not.toBe('');

    // The owner stops here, so nothing else can republish the preview and make
    // the assertion below true for the wrong reason.
    await ownerPage.close();

    await renameTrip(guestPage, guestTripId, 'Renamed By A Guest');

    // The rename is a real edit and converges through the document like any
    // other — being unable to write the preview is not being unable to edit.
    await waitForNameOnServer(stub, 'Renamed By A Guest');

    // But the preview row is untouched: `owners update their trips` matches
    // nothing here, and matching nothing is not an error.
    expect(stub.trips[0]?.name).toBe(TRIP.name);

    // And the device did not take that silence for success. This is the whole
    // finding: with the stub answering `200 []` the client saw the same bytes it
    // sees on a write that worked, so there was nothing to notice and nothing to
    // report — and every guest device stopped maintaining the preview from the
    // day the feature shipped.
    await expect
      .poll(() => notApplied.filter((line) => line.includes('was not updated')).length, {
        timeout: 30_000,
        intervals: [500],
      })
      .toBeGreaterThan(0);
  });

  test('is re-created, not written into the void, when the trip is deleted on the server', async ({
    page,
  }) => {
    const stub = new SupabaseStub();
    await stub.install(page);
    await stub.signIn(page, OWNER);

    await page.goto('/');
    await createTrip(page, TRIP.name);
    await addGuest(page, 'Alice');
    await openShareDialog(page);
    await expect(page.getByTestId('share-url')).toBeVisible({ timeout: 20_000 });
    await waitForNameOnServer(stub, 'Alice');
    await page.keyboard.press('Escape');

    const deadId = stub.trips[0]!.id;

    // Deleted from the dashboard, a project reset, a restore from a backup taken
    // before the trip existed. The roster cascades with the row, so this account
    // is no longer a member and `members append to the trip log` now refuses its
    // writes outright — reported from the share dialog as a permissions error,
    // which is what made this read as a permissions bug rather than a gone trip.
    stub.deleteTrip(deadId);

    await openShareDialog(page);
    await expect(page.getByTestId('share-url')).toBeVisible({ timeout: 20_000 });

    // A new row, not the dead pointer the device was still holding.
    await expect
      .poll(() => stub.trips[0]?.id, { timeout: 30_000, intervals: [500] })
      .not.toBe(deadId);
    expect(stub.trips[0]?.name).toBe(TRIP.name);

    // And the document reaches it. Without the re-creation every write is a 403
    // against a trip this account is not on, forever, with the share dialog
    // handing out a link to nothing.
    await waitForNameOnServer(stub, 'Alice');
  });
});

// ============================================================================
// Guest groups — the account's own rows, not a trip's
// ============================================================================

/**
 * Guest groups are the one thing here that syncs per **account** rather than per
 * trip: no document, no log, no membership — a plain table upserted on
 * `(owner_id, local_id)` and reconciled last-write-wins.
 *
 * The unit suite covers reconciliation against a double. What only a browser can
 * show is the wiring: that the client actually issues the upsert, sends the
 * local nanoid as `local_id`, and records the server id it gets back — the three
 * things a wrong column name or a mistyped filter would break silently, because
 * the feature keeps working offline either way.
 */
test.describe('guest groups on the server', () => {
  /** Builds a group through the UI. */
  async function createGroup(page: Page, name: string, member: string): Promise<void> {
    await page.goto('/groups');
    await page.getByRole('button', { name: /new group/i }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByLabel(/group name/i).fill(name);
    await dialog.getByRole('button', { name: /add a person/i }).click();
    await dialog.getByPlaceholder(/^name$/i).first().fill(member);
    await dialog.getByRole('button', { name: /^save$/i }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }

  test('uploads a group the signed-in owner creates', async ({ page }) => {
    const stub = new SupabaseStub();
    await stub.install(page);
    await stub.signIn(page, OWNER);

    await createGroup(page, 'Family', 'Tom + Léa');

    await expect
      .poll(() => stub.guestGroups.length, { timeout: 30_000, intervals: [500] })
      .toBe(1);

    const row = stub.guestGroups[0]!;
    expect(row.owner_id).toBe(OWNER.id);
    expect(row.name).toBe('Family');
    // The client nanoid travels as `local_id`; that is what makes the upsert
    // idempotent across a retry, a second tab and a reinstall.
    expect(row.local_id).toMatch(/^.{10,}$/);
  });

  test('a second device signed into the same account downloads it', async ({
    browser,
    page,
  }) => {
    const stub = new SupabaseStub();
    await stub.install(page);
    await stub.signIn(page, OWNER);

    await createGroup(page, 'Family', 'Tom + Léa');
    await expect
      .poll(() => stub.guestGroups.length, { timeout: 30_000, intervals: [500] })
      .toBe(1);

    const second = await newDevice(browser, stub, OWNER);
    await second.goto('/groups');

    await expect(second.getByText('Family', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(second.getByText('Tom + Léa', { exact: true })).toBeVisible();
  });

  test('another account sees nothing of it', async ({ browser, page }) => {
    const stub = new SupabaseStub();
    await stub.install(page);
    await stub.signIn(page, OWNER);

    await createGroup(page, 'Family', 'Tom + Léa');
    await expect
      .poll(() => stub.guestGroups.length, { timeout: 30_000, intervals: [500] })
      .toBe(1);

    // A group is private to its owner and has no sharing path at all — the
    // policy `owners read their guest groups` is the whole access model.
    const stranger = await newDevice(browser, stub, GUEST);
    await stranger.goto('/groups');

    await expect(
      stranger.getByText(/no groups yet/i).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(stranger.getByText('Family', { exact: true })).toHaveCount(0);
  });

  test('a group created signed out is uploaded on the next sign-in', async ({ page }) => {
    const stub = new SupabaseStub();
    await stub.install(page);

    // The whole app works signed out, groups included. Nothing may leave the
    // device until there is an account to attach it to.
    await createGroup(page, 'Family', 'Tom + Léa');
    expect(stub.guestGroups).toHaveLength(0);

    await stub.signIn(page, OWNER);
    await page.goto('/groups');

    await expect
      .poll(() => stub.guestGroups.length, { timeout: 30_000, intervals: [500] })
      .toBe(1);
    expect(stub.guestGroups[0]?.name).toBe('Family');
  });
});
