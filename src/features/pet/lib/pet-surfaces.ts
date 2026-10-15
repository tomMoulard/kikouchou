/**
 * @fileoverview Finds what the pet can stand on, on the page as it is now.
 *
 * The one part of the pet's physics that reads the DOM. `pet-physics` turns
 * each box into a surface, or rejects it.
 *
 * @module features/pet/lib/pet-surfaces
 */

import { type Surface, type Viewport, surfaceFromBox } from './pet-physics';

// ============================================================================
// Constants
// ============================================================================

/**
 * What the pet can stand on. Layout `div`s are left out on purpose: most of
 * them draw nothing, and a pet standing on an invisible edge looks like it is
 * floating. Anything with a visible top edge is listed, plus
 * `[data-pet-surface]` for a page that wants to offer one.
 */
export const PET_SURFACE_SELECTOR = [
  '[data-slot="card"]',
  '[data-slot="badge"]',
  '[data-slot="tabs-list"]',
  '[data-pet-surface]',
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'img',
  'h1',
  'h2',
  'h3',
  'nav',
].join(',');

/** How many surfaces one scan keeps, so a long list page stays cheap. */
const MAX_SURFACES = 300;

// ============================================================================
// Functions
// ============================================================================

/**
 * Measures every surface on screen, except the pet itself.
 *
 * @param exclude - The pet's own element
 * @param viewport - The viewport
 * @returns The surfaces
 */
export function collectSurfaces(exclude: Element | null, viewport: Viewport): Surface<Element>[] {
  const surfaces: Surface<Element>[] = [];

  for (const element of document.querySelectorAll(PET_SURFACE_SELECTOR)) {
    if (surfaces.length >= MAX_SURFACES) {
      break;
    }
    if (exclude?.contains(element)) {
      continue;
    }

    const surface = surfaceFromBox(element.getBoundingClientRect(), viewport, element);

    if (surface !== null) {
      surfaces.push(surface);
    }
  }

  return surfaces;
}

