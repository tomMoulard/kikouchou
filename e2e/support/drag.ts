/**
 * @fileoverview Driving a dnd-kit drag from Playwright.
 *
 * Extracted from `room-assignment.spec.ts`, which worked this out the hard
 * way, so the transport list's drag does not have to learn it again.
 *
 * @module e2e/support/drag
 */

import type { Locator, Page } from '@playwright/test';

/**
 * Drags one element onto another, the way a pointer really would.
 *
 * `locator.dragTo()` is not enough, and its failure mode is a silent no-op
 * rather than an error. The pages here configure dnd-kit's `MouseSensor` with
 * an 8px activation constraint and then track the pointer through `mousemove`
 * events on the document: the drag only begins on the first move past 8px, and
 * the drop target is resolved from the pointer delta accumulated by the moves
 * that follow. Playwright's built-in drag emits too few moves, and they jump
 * straight to the destination — so the sensor either never activates or
 * activates at the destination with nothing left to travel, and `onDragEnd`
 * fires with `over === null`.
 *
 * Nudging past the threshold first and then travelling in steps produces the
 * event stream a real pointer would.
 *
 * @param page - Playwright page object
 * @param source - The element to pick up
 * @param target - The element to drop it on
 * @throws When either element has no box to drag between
 */
export async function dragOnto(
  page: Page,
  source: Locator,
  target: Locator,
): Promise<void> {
  await target.scrollIntoViewIfNeeded();

  const from = await source.boundingBox();
  const to = await target.boundingBox();

  if (!from || !to) {
    throw new Error('Cannot drag: source or target has no bounding box');
  }

  // Both boxes have to be inside the viewport, because `page.mouse` works in
  // viewport coordinates and does not scroll: a press aimed below the fold
  // lands on `<html>`, no sensor ever activates, and the only symptom is a
  // drop that quietly did nothing. Worth an error rather than a mystery —
  // scrolling the target in can push the source out on a small screen, which
  // is exactly how this was found.
  const viewport = page.viewportSize();
  if (viewport) {
    for (const [name, box] of [
      ['source', from],
      ['target', to],
    ] as const) {
      if (box.y < 0 || box.y + box.height > viewport.height) {
        throw new Error(
          `Cannot drag: the ${name} is outside the ${viewport.width}x${viewport.height} ` +
            `viewport (y ${box.y} to ${box.y + box.height}). Both ends of a pointer ` +
            'drag have to be on screen at once.',
        );
      }
    }
  }

  const fromX = from.x + from.width / 2,
    fromY = from.y + from.height / 2,
    toX = to.x + to.width / 2,
    toY = to.y + to.height / 2;

  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  // Clear the 8px activation constraint before setting off.
  await page.mouse.move(fromX + 12, fromY, { steps: 5 });
  await page.mouse.move(toX, toY, { steps: 20 });
  // One more move at rest: dnd-kit resolves the collision on the last move it
  // saw, and a drop that lands exactly on the final step of a travel is worth
  // confirming rather than assuming.
  await page.mouse.move(toX, toY);
  await page.mouse.up();
}
