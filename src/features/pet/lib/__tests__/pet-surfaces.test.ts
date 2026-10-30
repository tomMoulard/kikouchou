/**
 * @fileoverview Tests for finding what the pet can stand on.
 *
 * jsdom has no layout, so each element is given its box by hand.
 *
 * @module features/pet/lib/__tests__/pet-surfaces.test
 */

import { afterEach, describe, expect, it } from 'vitest';

import { collectSurfaces } from '../pet-surfaces';

function place(element: Element, left: number, top: number, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top }) as DOMRect;
}

describe('collectSurfaces', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps buttons and cards on screen, and leaves out plain divs and the pet', () => {
    document.body.innerHTML = `
      <div id="layout"></div>
      <div data-slot="card" id="card"></div>
      <button id="button"></button>
      <button id="tiny"></button>
      <div id="pet"><button id="own"></button></div>
    `;
    const byId = (id: string): Element => document.getElementById(id)!;

    place(byId('layout'), 0, 300, 400, 100);
    place(byId('card'), 0, 200, 400, 100);
    place(byId('button'), 20, 500, 120, 40);
    place(byId('tiny'), 20, 600, 10, 10);
    place(byId('own'), 0, 400, 60, 60);

    const surfaces = collectSurfaces(byId('pet'), { width: 400, height: 800 });

    expect(surfaces.map((surface) => (surface.ref as Element).id)).toEqual(['card', 'button']);
  });
});
