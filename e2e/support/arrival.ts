/**
 * @fileoverview The "When do you arrive?" step of an invite link.
 *
 * Picking a name on `/join/:token` no longer opens the calendar: the page asks
 * the guest's arrival day first. A spec about something else answers "not
 * decided yet", which opens the calendar as picking a name used to, and writes
 * nothing.
 *
 * @module e2e/support/arrival
 */

import { expect, type Page } from '@playwright/test';

/**
 * Answers the arrival question with "not decided yet".
 *
 * @param page - The guest's page, just after a name was picked
 */
export async function skipArrivalQuestion(page: Page): Promise<void> {
  const notDecided = page.getByRole('button', { name: /^(not decided yet|pas encore décidé)$/i });
  await expect(notDecided).toBeVisible({ timeout: 30_000 });
  await notDecided.click();
}
