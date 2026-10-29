/**
 * @fileoverview The assistant on a cloud model, through the OpenRouter sign-in.
 *
 * Only a real page load proves the part that matters most: OpenRouter returns
 * to `/assistant?code=…`, and `lib/supabase/auth-callback` takes any `?code=`
 * it sees at import time as a Supabase sign-in. The OpenRouter capture has to
 * run first and claim it. A unit test of either module cannot see the order
 * `main.tsx` imports them in.
 *
 * openrouter.ai is stubbed end to end, so no key is minted and nothing is
 * billed: the sign-in page answers with the redirect a user's approval would
 * produce, the exchange answers with a fake key, and the chat endpoint streams
 * an answer that carries one action. That last part is also the first e2e
 * coverage of an assistant action at all, because every local preset needs a
 * WebGPU model the runner does not have.
 *
 * @module e2e/assistant-openrouter
 */

import { expect, test, type Page, type Route } from '@playwright/test';

import { stubExternalMapServices } from './support/external-services';
import { fixtureDate, fixtureDatetime } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedPerson, seedRoom, seedTransport, seedTrip } from './support/seed';
import { clearIndexedDB } from './support/storage';

const FAKE_KEY = 'sk-or-v1-e2e';
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
};

/** Answers a CORS preflight, so the stub works whatever the browser sends first. */
async function fulfillPreflight(route: Route): Promise<boolean> {
  if (route.request().method() !== 'OPTIONS') return false;
  await route.fulfill({ status: 204, headers: CORS_HEADERS });
  return true;
}

interface OpenRouterStub {
  /** Bodies posted to the key exchange. */
  readonly exchanges: Record<string, unknown>[];
  /** Bodies posted to the chat endpoint. */
  readonly chats: Record<string, unknown>[];
}

async function stubOpenRouter(page: Page, answer: string): Promise<OpenRouterStub> {
  const stub: OpenRouterStub = { exchanges: [], chats: [] };

  // The sign-in page: approve at once, the way a user clicking "Authorize"
  // would, by sending the browser back to the callback with a code.
  await page.route(/^https:\/\/openrouter\.ai\/auth(\?|$)/, async (route) => {
    const url = new URL(route.request().url());
    const callback = new URL(url.searchParams.get('callback_url')!);
    callback.searchParams.set('code', 'e2e-code');
    callback.searchParams.set('state', url.searchParams.get('state')!);
    await route.fulfill({ status: 302, headers: { location: callback.toString() } });
  });

  await page.route('https://openrouter.ai/api/v1/auth/keys', async (route) => {
    if (await fulfillPreflight(route)) return;
    stub.exchanges.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({ key: FAKE_KEY }),
    });
  });

  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    if (await fulfillPreflight(route)) return;
    stub.chats.push(route.request().postDataJSON() as Record<string, unknown>);
    const event = JSON.stringify({ choices: [{ delta: { content: answer } }] });
    await route.fulfill({
      status: 200,
      headers: { ...CORS_HEADERS, 'content-type': 'text/event-stream' },
      body: `: OPENROUTER PROCESSING\n\ndata: ${event}\n\ndata: [DONE]\n\n`,
    });
  });

  return stub;
}

/**
 * Opens the assistant on the current trip and signs in to the stubbed
 * OpenRouter, which is the one preset the runner can talk to.
 */
async function connectCloudModel(page: Page): Promise<void> {
  await page.goto('/assistant');
  await waitForRoute(page);
  await page.getByRole('combobox', { name: /assistant model|modèle de l'assistant/i }).click();
  await page.getByRole('option', { name: /^Claude Haiku/ }).click();
  await page.getByRole('button', { name: /connect with openrouter|se connecter avec openrouter/i }).click();
  await expect(
    page.getByRole('button', { name: /disconnect openrouter|déconnecter openrouter/i }),
  ).toBeVisible();
}

test.describe('Assistant on a cloud model', () => {
  test.beforeEach(async ({ page }) => {
    await stubExternalMapServices(page);
    await page.goto('/');
    await clearIndexedDB(page);
  });

  test('connects through OpenRouter and applies the action in the answer', async ({ page }) => {
    const stub = await stubOpenRouter(
      page,
      'Adding Zoé.\n```action\n{"action":"addGuest","data":{"name":"Zoé"}}\n```',
    );
    const { tripId } = await seedTrip(page, {
      name: 'Cloud Assistant Trip',
      startDate: fixtureDate(14),
      endDate: fixtureDate(17),
    });

    // Opening a trip page makes it the current trip, which the assistant acts on.
    await page.goto(`/trips/${tripId}/persons`);
    await waitForRoute(page);
    await page.goto('/assistant');
    await waitForRoute(page);

    await page.getByRole('combobox', { name: /assistant model|modèle de l'assistant/i }).click();
    await page.getByRole('option', { name: /^Claude Haiku/ }).click();

    await page.getByRole('button', { name: /connect with openrouter|se connecter avec openrouter/i }).click();

    // Back on the assistant, connected: the exchange carried the verifier, and
    // the code never reached the Supabase capture, which would have shown a
    // sign-in error for a sign-in nobody started.
    await expect(
      page.getByRole('button', { name: /disconnect openrouter|déconnecter openrouter/i }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.has('code')).toBe(false);
    expect(stub.exchanges).toHaveLength(1);
    expect(stub.exchanges[0]).toMatchObject({ code: 'e2e-code', code_challenge_method: 'S256' });
    expect(typeof stub.exchanges[0]!.code_verifier).toBe('string');
    await expect(page.getByText(/sign-in failed|connexion a échoué/i)).toHaveCount(0);

    await page.getByRole('textbox').fill('Add a guest named Zoé');
    await page.keyboard.press('Enter');

    await expect(page.getByText('Adding Zoé.')).toBeVisible();
    expect(stub.chats).toHaveLength(1);
    expect(stub.chats[0]).toMatchObject({ model: 'anthropic/claude-haiku-4.5', stream: true });
    const messages = stub.chats[0]!.messages as { role: string; content: string }[];
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('Cloud Assistant Trip');

    await page.goto(`/trips/${tripId}/persons`);
    await waitForRoute(page);
    await expect(page.getByText('Zoé').first()).toBeVisible();
  });

  test('shows the planning the answer asks for, and links to the calendar', async ({ page }) => {
    const stub = await stubOpenRouter(
      page,
      'Here is the week.\n```action\n{"action":"showView","data":{"view":"planning"}}\n```',
    );
    const { tripId } = await seedTrip(page, {
      name: 'Planning Trip',
      startDate: fixtureDate(14),
      endDate: fixtureDate(17),
    });
    // Seeded before the trip is current, as `seedPerson` asks.
    const personId = await seedPerson(page, tripId, 'Inès');
    await seedTransport(page, {
      tripId,
      personId,
      type: 'arrival',
      datetime: fixtureDatetime(14, '15:00:00.000Z'),
      mode: 'train',
      location: 'Gare de Lyon',
    });

    await page.goto(`/trips/${tripId}/persons`);
    await waitForRoute(page);
    await connectCloudModel(page);

    await page.getByRole('textbox').fill('Show me the planning');
    await page.keyboard.press('Enter');

    await expect(page.getByText('Here is the week.')).toBeVisible();
    const planning = page.getByRole('region', { name: /^planning$/i });
    await expect(planning).toBeVisible();
    await expect(planning.getByText('Inès')).toBeVisible();
    // The block is drawn, never shown as text.
    await expect(page.getByText('showView')).toHaveCount(0);
    expect(stub.chats).toHaveLength(1);

    await planning.getByRole('link', { name: /^(open|ouvrir)$/i }).click();
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/calendar`));
  });

  test('opens a view from a shortcut without asking the model', async ({ page }) => {
    const stub = await stubOpenRouter(page, 'Hello.');
    const { tripId } = await seedTrip(page, {
      name: 'Shortcut Trip',
      startDate: fixtureDate(14),
      endDate: fixtureDate(17),
    });
    await seedRoom(page, { tripId, name: 'Grenier', capacity: 2 });

    await page.goto(`/trips/${tripId}/rooms`);
    await waitForRoute(page);
    await connectCloudModel(page);

    await page
      .getByRole('group', { name: /show in the chat|afficher dans la discussion/i })
      .getByRole('button', { name: /^(rooms|chambres)$/i })
      .click();

    const rooms = page.getByRole('region', { name: /who sleeps where|qui dort où/i });
    await expect(rooms).toBeVisible();
    await expect(rooms.getByText('Grenier')).toBeVisible();
    expect(stub.chats).toHaveLength(0);
  });

  test('stays connected across a reload, and forgets the key on disconnect', async ({ page }) => {
    await stubOpenRouter(page, 'Hello.');
    await page.goto('/assistant');
    await waitForRoute(page);

    await page.getByRole('combobox', { name: /assistant model|modèle de l'assistant/i }).click();
    await page.getByRole('option', { name: /^Claude Haiku/ }).click();
    await page.getByRole('button', { name: /connect with openrouter|se connecter avec openrouter/i }).click();

    const disconnect = page.getByRole('button', { name: /disconnect openrouter|déconnecter openrouter/i });
    await expect(disconnect).toBeVisible();

    await page.reload();
    await waitForRoute(page);
    await expect(disconnect).toBeVisible();

    await disconnect.click();
    await expect(
      page.getByRole('button', { name: /connect with openrouter|se connecter avec openrouter/i }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => localStorage.getItem('kikouchou-openrouter-key')),
    ).toBeNull();
  });
});

test.describe('Assistant on a cloud model, on a small phone', () => {
  // An iPhone SE's screen. The model card fills most of it, so the connect
  // button starts below the fold and the user has to scroll to it.
  test.use({ viewport: { width: 375, height: 667 } });

  test.beforeEach(async ({ page }) => {
    await stubExternalMapServices(page);
    await page.goto('/');
    await clearIndexedDB(page);
  });

  test('a scroll over the model card brings the connect button on screen', async ({ page }) => {
    await page.goto('/assistant');
    await waitForRoute(page);

    const picker = page.getByRole('combobox', { name: /assistant model|modèle de l'assistant/i });
    await picker.click();
    await page.getByRole('option', { name: /^Claude Haiku/ }).click();

    // The user scrolls where their thumb is, which is on the model card. Only
    // the strip under it used to scroll, so the button never came up, and
    // Playwright's own click would have scrolled that strip for us.
    const box = await picker.boundingBox();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, 2000);

    const connect = page.getByRole('button', {
      name: /connect with openrouter|se connecter avec openrouter/i,
    });
    await expect(connect).toBeInViewport({ ratio: 1 });
    // And nothing anchored to the bottom edge, the nav bar first, covers it.
    await expect
      .poll(() =>
        connect.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return hit !== null && element.contains(hit);
        }),
      )
      .toBe(true);
  });
});
