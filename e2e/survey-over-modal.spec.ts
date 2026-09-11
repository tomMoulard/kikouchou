/**
 * @fileoverview A PostHog survey waits for the modal on top of it to close.
 *
 * The bug this pins: creating a room while PostHog asked for feedback
 * deadlocked the page. The survey popup was painted over the dialog, because
 * posthog-js gives it `z-index: 2147483645` against the app's `z-50` modal
 * layer, and yet nothing in it answered a click — a Radix modal sets
 * `pointer-events: none` on `body` and traps focus, and the popup is a
 * `div.PostHogSurvey-<id>` appended to `body`, outside the dialog on both
 * counts. The only way to dismiss the survey was to abandon the room form.
 *
 * `src/index.css` hides the popup while a modal overlay is in the DOM and
 * gives it back when the last one closes. That is a `:has()` selector, so only
 * a browser can say whether it holds — the rule is exercised here rather than
 * asserted as a class string, the way `dialog-narrow-gutters.spec.ts` measures
 * the geometry it pins.
 *
 * PostHog never initialises against localhost (see `lib/posthog`), so the
 * popup is stood in for by a div with the same class shape and the same inline
 * stacking, which is all the rule matches on.
 *
 * @module e2e/survey-over-modal
 */

import { test, expect, type Page } from '@playwright/test';

import { fixtureDate } from './support/fixture-dates';
import { waitForRoute } from './support/routes';
import { seedTrip } from './support/seed';
import { clearIndexedDB } from './support/storage';

// ============================================================================
// Constants
// ============================================================================

/** Both locales, because the suite runs against whichever the browser asks for. */
const LABELS = {
  newRoom: /^(new room|nouvelle chambre)$/iu,
  discard: /^(discard|abandonner)$/iu,
} as const;

/** The class posthog-js builds as `PostHogSurvey-${survey.id}`. */
const SURVEY_CLASS = 'PostHogSurvey-0199fake';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Appends a stand-in for the survey popup to `body`.
 *
 * Fixed, sized and at posthog-js's own `z-index`, so a rule that stops working
 * fails as a visible element rather than as a zero-sized one that was never on
 * screen anyway. The button inside stands for a survey answer, which is what
 * the reported bug could not reach.
 *
 * @param page - Playwright page object
 * @param className - Class the popup carries, matched by the CSS rule
 */
async function stubSurveyPopup(page: Page, className: string): Promise<void> {
  await page.evaluate((surveyClass) => {
    const popup = document.createElement('div');
    popup.className = surveyClass;
    popup.style.cssText =
      'position:fixed;right:30px;bottom:30px;width:320px;height:200px;' +
      'background:#fff;border:1px solid #000;z-index:2147483645;';

    const answer = document.createElement('button');
    answer.type = 'button';
    answer.textContent = 'Answer the survey';
    answer.addEventListener('click', () => {
      popup.dataset.answered = 'true';
    });
    popup.append(answer);

    document.body.append(popup);
  }, className);
}

/**
 * Seeds a trip and opens its rooms page in card view.
 *
 * @param page - Playwright page object
 */
async function openRooms(page: Page): Promise<void> {
  const { tripId } = await seedTrip(page, {
    name: 'Survey trip',
    startDate: fixtureDate(1),
    endDate: fixtureDate(8),
  });

  await page.goto(`/trips/${tripId}/rooms?view=card`);
  await waitForRoute(page);
}

/**
 * Opens the room creation dialog from the rooms page.
 *
 * @param page - Playwright page object
 */
async function openRoomDialog(page: Page): Promise<void> {
  const addButton = page
    .getByRole('button', { name: LABELS.newRoom })
    .filter({ visible: true });
  await expect(addButton).toHaveCount(1);
  await addButton.click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Survey over a modal', () => {
  test.beforeEach(async ({ page }) => {
    await clearIndexedDB(page);
  });

  test('steps aside while the room dialog is open, and comes back after it', async ({
    page,
  }) => {
    await openRooms(page);
    await stubSurveyPopup(page, SURVEY_CLASS);

    const popup = page.locator(`.${SURVEY_CLASS}`);
    await expect(popup).toBeVisible();

    await openRoomDialog(page);
    await expect(popup).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Visible again, and answerable: the click that the open dialog swallowed
    // now reaches the popup.
    await expect(popup).toBeVisible();
    await popup.getByRole('button', { name: /answer the survey/iu }).click();
    await expect(popup).toHaveAttribute('data-answered', 'true');
  });

  test('stays out of the way while one modal hands over to another', async ({
    page,
  }) => {
    await openRooms(page);
    await stubSurveyPopup(page, SURVEY_CLASS);

    const popup = page.locator(`.${SURVEY_CLASS}`);

    await openRoomDialog(page);
    await expect(popup).toBeHidden();

    // A dirty form turns Escape into the discard confirmation, an alert dialog
    // that is modal in its own right. The survey has to stay hidden across
    // that, and come back only when both are gone.
    await page.locator('#room-name').fill('Blue room');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(popup).toBeHidden();

    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: LABELS.discard })
      .click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(popup).toBeVisible();
  });
});
