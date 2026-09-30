/**
 * @fileoverview The pet: turned on from Settings, it lands on the page, answers
 * a tap, can be carried, and never leaves the screen or blocks the nav bar.
 *
 * jsdom has no layout, so this is where the walking-on-the-page part is
 * checked: the pet has to come to rest on a real surface, inside the
 * viewport, with its feet no lower than the bottom edge.
 *
 * @module e2e/pet
 */

import { test, expect, type Page } from '@playwright/test';

import { waitForRoute } from './support/routes';

// ============================================================================
// Fixtures
// ============================================================================

/** A phone, so the mobile nav bar is on screen too. */
test.use({ viewport: { width: 393, height: 852 } });

/** Labels in either language: the app may start in French or English. */
const SWITCH_LABEL = /show my pet|afficher mon compagnon/i,
  PET_LABEL = /your pet|votre compagnon/i,
  MOBILE_NAV_LABEL = /mobile navigation|navigation mobile/i;

interface PetBox {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly pose: string | undefined;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

async function petBox(page: Page): Promise<PetBox> {
  return await page.getByTestId('pet').evaluate((node: HTMLElement): PetBox => {
    const box = node.getBoundingClientRect();

    return {
      left: box.left,
      right: box.right,
      bottom: box.bottom,
      pose: node.dataset.petPose,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: window.innerHeight,
    };
  });
}

async function turnPetOn(page: Page): Promise<void> {
  await page.goto('/settings');
  await waitForRoute(page);

  const toggle = page.getByRole('switch', { name: SWITCH_LABEL });

  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.getByTestId('pet')).toBeVisible();
  // Settled: out of the air, on something.
  await expect.poll(async () => (await petBox(page)).pose, { timeout: 5_000 }).not.toBe('fall');
}

// ============================================================================
// Tests
// ============================================================================

test.describe('Pet', () => {
  test('is off until the user turns it on', async ({ page }) => {
    await page.goto('/settings');
    await waitForRoute(page);

    await expect(page.getByRole('switch', { name: SWITCH_LABEL })).toBeVisible();
    await expect(page.getByTestId('pet')).toHaveCount(0);
  });

  test('lands on the page and stays inside the screen while it wanders', async ({ page }) => {
    await turnPetOn(page);

    for (let sample = 0; sample < 8; sample++) {
      const box = await petBox(page);

      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(box.viewportWidth + 0.5);
      expect(box.bottom).toBeLessThanOrEqual(box.viewportHeight + 0.5);
      await page.waitForTimeout(400);
    }
  });

  test('answers a tap with a bubble', async ({ page }) => {
    await turnPetOn(page);

    await page.getByRole('button', { name: PET_LABEL }).click();

    await expect(page.locator('.pet-bubble')).toBeVisible();
    await expect(page.getByTestId('pet').locator('[aria-live="polite"]')).not.toHaveText('');
  });

  test('follows a drag, and lands when it is let go', async ({ page }) => {
    await turnPetOn(page);

    const pet = page.getByRole('button', { name: PET_LABEL }),
      start = await pet.boundingBox();

    expect(start).not.toBeNull();
    const from = { x: start!.x + start!.width / 2, y: start!.y + start!.height / 2 },
      to = { x: 120, y: 260 };

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });

    await expect(page.getByTestId('pet')).toHaveAttribute('data-pet-pose', 'held');
    const held = await pet.boundingBox();
    expect(Math.abs(held!.x + held!.width / 2 - to.x)).toBeLessThan(40);

    await page.mouse.up();

    // A drag is not a tap: no bubble.
    await expect(page.locator('.pet-bubble')).toHaveCount(0);
    await expect.poll(async () => (await petBox(page)).pose, { timeout: 5_000 }).not.toBe('fall');
    await expect.poll(async () => (await petBox(page)).pose).not.toBe('held');
  });

  test('never covers the centre of a nav bar link', async ({ page }) => {
    await turnPetOn(page);

    const links = page.getByRole('navigation', { name: MOBILE_NAV_LABEL }).locator('a, button');
    const count = await links.count();

    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index++) {
      const reachesSelf = await links.nth(index).evaluate((element: Element): boolean => {
        const box = element.getBoundingClientRect(),
          hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

        return hit !== null && element.contains(hit);
      });

      expect(reachesSelf).toBe(true);
    }
  });

  test('stands still for reduced motion, and still answers a tap', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await turnPetOn(page);

    const first = await petBox(page);
    await page.waitForTimeout(3_000);
    const later = await petBox(page);

    expect(later.left).toBe(first.left);
    expect(later.bottom).toBe(first.bottom);

    await page.getByRole('button', { name: PET_LABEL }).click();
    await expect(page.locator('.pet-bubble')).toBeVisible();
  });

  test('comes back on the next visit, in its outfit', async ({ page }) => {
    await turnPetOn(page);

    await page.getByRole('radio', { name: /^(beaver|castor)$/i }).click();
    await page.reload();
    await waitForRoute(page);

    await expect(page.getByTestId('pet')).toBeVisible();
    await expect(page.getByTestId('pet').locator('svg[data-pet-species="beaver"]')).toHaveCount(1);
  });
});
