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
import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedTrip } from './support/seed';
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
    await page.getByRole('option', { name: /cloud-claude-haiku/ }).click();

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

  test('stays connected across a reload, and forgets the key on disconnect', async ({ page }) => {
    await stubOpenRouter(page, 'Hello.');
    await page.goto('/assistant');
    await waitForRoute(page);

    await page.getByRole('combobox', { name: /assistant model|modèle de l'assistant/i }).click();
    await page.getByRole('option', { name: /cloud-claude-haiku/ }).click();
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
