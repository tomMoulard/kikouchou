/**
 * @fileoverview The trip description on the trip settings page: shown
 * formatted, edited in place with a Markdown editor, saved on its own.
 *
 * @module e2e/trip-description
 */

import { expect, test, type Locator, type Page } from '@playwright/test';
import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedTrip } from './support/seed';

/**
 * The description card. Its Save and Cancel share their names with the trip
 * form's own buttons further down the page, so every lookup starts here.
 */
function descriptionCard(page: Page): Locator {
  return page.locator('[data-slot="card"]').filter({
    has: page.locator('[data-slot="card-title"]', { hasText: /^description$/i }),
  });
}

test.describe('Trip description', () => {
  test('is edited in place and shown formatted after a reload', async ({ page }) => {
    const { tripId } = await seedTrip(page, {
      name: 'Cabin weekend',
      startDate: fixtureDate(5),
      endDate: fixtureDate(8),
    });

    await page.goto(`/trips/${tripId}/edit`);
    await waitForRoute(page);

    const card = descriptionCard(page);
    await card.getByRole('button', { name: /edit the description|modifier la description/i }).click();

    const editor = card.locator('#trip-description-editor');
    await expect(editor).toBeFocused();
    await editor.fill('Door code');
    await editor.selectText();
    // The toolbar types the Markdown: the user never has to know the syntax.
    await card.getByRole('button', { name: /^(bold|gras)$/i }).click();
    await expect(editor).toHaveValue('**Door code**');
    // And it leaves the words selected, so typing now would replace them.
    await expect
      .poll(() => editor.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]))
      .toEqual([2, 11]);
    // The caret to the end. `End` stays put on macOS, so set it directly.
    await editor.evaluate((el: HTMLTextAreaElement) => {
      el.setSelectionRange(el.value.length, el.value.length);
    });
    await editor.pressSequentially(' 1234\n\n- towels');
    // Enter inside a list starts the next item.
    await editor.press('Enter');
    await editor.pressSequentially('boots');
    await expect(editor).toHaveValue('**Door code** 1234\n\n- towels\n- boots');

    await card.getByRole('button', { name: /^(save|enregistrer)$/i }).click();

    await expect(editor).toHaveCount(0);
    await expect(card.locator('strong', { hasText: 'Door code' })).toBeVisible();
    await expect(card.getByRole('listitem')).toHaveText(['towels', 'boots']);

    // Stored, not merely shown: it survives a reload.
    await page.reload();
    await waitForRoute(page);
    await expect(card.locator('strong', { hasText: 'Door code' })).toBeVisible();
  });

  test('Cancel leaves the stored description alone', async ({ page }) => {
    const { tripId } = await seedTrip(page, {
      name: 'Cabin weekend',
      startDate: fixtureDate(5),
      endDate: fixtureDate(8),
    });

    await page.goto(`/trips/${tripId}/edit`);
    await waitForRoute(page);

    const card = descriptionCard(page);
    await card.getByRole('button', { name: /edit the description|modifier la description/i }).click();
    await card.locator('#trip-description-editor').fill('Not kept');
    await card.getByRole('button', { name: /^(cancel|annuler)$/i }).click();

    await expect(card.locator('#trip-description-editor')).toHaveCount(0);
    await expect(page.getByText('Not kept')).toHaveCount(0);
    await expect(card.getByText(/no description yet|pas encore de description/i)).toBeVisible();
  });
});
