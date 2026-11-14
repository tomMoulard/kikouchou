/**
 * @fileoverview The onboarding experiment's assistant arm, and the account
 * the assistant answers for.
 *
 * A first open whose one trip is the sample goes from `/` to the assistant,
 * which offers starter questions. Signed out, a starter
 * asks for an account and keeps the question; signed in, the kept question is
 * sent to api.kikouchou.app with the session token.
 *
 * Runs in the `sync` project, the one whose build has a Supabase project (the
 * stub): a build without accounts shows no chat at all.
 * api.kikouchou.app is routed to a canned answer; the server itself is tested
 * in `server/api`.
 *
 * @module e2e/assistant-account
 */

import { expect, test, type Page } from '@playwright/test';

import { SupabaseStub, type StubUser } from './support/supabase-stub';

// ============================================================================
// Helpers
// ============================================================================

const VISITOR: StubUser = { id: 'visitor-1', email: 'visitor@example.test' };

const API_URL = 'https://api.kikouchou.app/v1/chat/completions';

const STARTER = 'Plan a weekend at the seaside with 6 friends next month';

/**
 * A first open, in English, in the assistant arm.
 *
 * @param page - Playwright page object
 */
async function firstOpenInAssistantArm(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('kikouchou-sample-trip', 'on');
    localStorage.setItem('i18nextLng', 'en');
    localStorage.setItem('kikouchou-flag:onboarding-planning-view', 'assistant');
  });
}

function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Assistant arm', () => {
  test('a signed-out visitor lands on the starters, and a tap asks for an account', async ({ page }) => {
    const stub = new SupabaseStub();
    await stub.install(page);
    await firstOpenInAssistantArm(page);
    let apiCalls = 0;
    await page.route(API_URL, async (route) => {
      apiCalls += 1;
      await route.fulfill({ status: 401, body: '{}' });
    });

    await page.goto('/');

    await expect(page).toHaveURL(/\/assistant$/);
    await expect(page.getByText('Plan your trip by asking')).toBeVisible({ timeout: 15_000 });
    const starters = page.getByRole('group', { name: 'Questions to start with' });
    await expect(starters.getByRole('button')).toHaveCount(4);

    await starters.getByRole('button', { name: STARTER }).click();

    await expect(page.getByRole('dialog', { name: 'Sign in to ask the assistant' })).toBeVisible();
    const pending = await page.evaluate(() =>
      localStorage.getItem('kikouchou-assistant-pending-prompt'),
    );
    expect(JSON.parse(pending ?? '{}')).toMatchObject({ text: STARTER, kind: 'create' });
    expect(apiCalls).toBe(0);
  });

  test('back from signing in, the kept question goes to the API with the session', async ({ page }) => {
    const stub = new SupabaseStub();
    await stub.install(page);
    await stub.signIn(page, VISITOR);
    await firstOpenInAssistantArm(page);
    // What the starter tap stored before the sign-in left the page.
    await page.addInitScript((text) => {
      localStorage.setItem(
        'kikouchou-assistant-pending-prompt',
        JSON.stringify({ text, kind: 'create', at: Date.now() }),
      );
    }, STARTER);

    const authorizations: (string | undefined)[] = [];
    await page.route(API_URL, async (route) => {
      authorizations.push(route.request().headers().authorization);
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: `${delta('A seaside weekend ')}${delta('sounds lovely.')}data: [DONE]\n\n`,
      });
    });

    await page.goto('/');

    await expect(page).toHaveURL(/\/assistant$/);
    await expect(page.getByText('A seaside weekend sounds lovely.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(STARTER)).toBeVisible();
    expect(authorizations).toEqual([`Bearer stub-access-${VISITOR.id}`]);
    // Sent once: the reload of a later visit has nothing left to send.
    expect(
      await page.evaluate(() => localStorage.getItem('kikouchou-assistant-pending-prompt')),
    ).toBeNull();
  });

  // A phone under 360px wide trades the bottom bar for the menu button, and
  // the chat still kept room for the bar and for the add button's band: a
  // wide empty strip under the input, the messages squeezed above it.
  for (const width of [355, 393]) {
    test(`the chat fills a ${width}px phone, its input on the bottom edge`, async ({ page }) => {
      await page.setViewportSize({ width, height: 770 });
      const stub = new SupabaseStub();
      await stub.install(page);
      await stub.signIn(page, VISITOR);
      await page.addInitScript(() => {
        localStorage.setItem('kikouchou-sample-trip', 'on');
        localStorage.setItem('i18nextLng', 'en');
      });
      await page.route(API_URL, (route) =>
        route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
          body: `${delta('Six people.')}data: [DONE]\n\n`,
        }),
      );

      await page.goto('/assistant');
      const input = page.getByRole('textbox');
      await input.fill('How many people are coming?');
      await input.press('Enter');
      await expect(page.getByText('Six people.')).toBeVisible({ timeout: 15_000 });

      const layout = await page.evaluate(() => {
        const box = document.querySelector('textarea')?.getBoundingClientRect();
        const bar = document.querySelector('.fixed.bottom-0')?.getBoundingClientRect();
        return {
          window: window.innerHeight,
          page: document.documentElement.scrollHeight,
          inputBottom: box?.bottom ?? 0,
          inputHeight: box?.height ?? 0,
          barTop: bar && bar.height > 0 ? bar.top : window.innerHeight,
        };
      });
      // Nothing to scroll: the messages are the only thing that does.
      expect(layout.page).toBeLessThanOrEqual(layout.window);
      // The input sits within a row's padding of the bar, or of the bottom
      // edge when the bar is off, rather than 90px above either.
      expect(layout.barTop - layout.inputBottom).toBeLessThanOrEqual(16);
      // One line: the placeholder fits, and does not grow the field.
      expect(layout.inputHeight).toBeLessThanOrEqual(44);
    });
  }
});
