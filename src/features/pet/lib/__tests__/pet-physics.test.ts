/**
 * @fileoverview Tests for the pet's physics.
 *
 * @module features/pet/lib/__tests__/pet-physics.test
 */

import { describe, expect, it } from 'vitest';

import {
  GRAVITY,
  MAX_FALL_SPEED,
  PET_SIZE,
  ceilingOf,
  clampX,
  clampY,
  fall,
  findLanding,
  isOnSurface,
  jumpVelocity,
  pickJumpTarget,
  restingPlace,
  surfaceFromBox,
  type Surface,
} from '../pet-physics';

const viewport = { width: 400, height: 800 };

function surface(left: number, right: number, top: number, ref?: string): Surface<string> {
  return { left, right, top, ref };
}

describe('surfaceFromBox', () => {
  it('keeps the top edge of a visible box, cut to the viewport', () => {
    expect(surfaceFromBox({ left: -20, right: 200, top: 300, bottom: 340 }, viewport, 'card')).toEqual({
      left: 0,
      right: 200,
      top: 300,
      ref: 'card',
    });
  });

  it('refuses a box too narrow to stand on', () => {
    expect(surfaceFromBox({ left: 10, right: 30, top: 300, bottom: 320 }, viewport)).toBeNull();
  });

  it('refuses a box so high the pet would lose its head, or below the screen', () => {
    expect(surfaceFromBox({ left: 0, right: 200, top: PET_SIZE - 1, bottom: 200 }, viewport)).toBeNull();
    expect(surfaceFromBox({ left: 0, right: 200, top: 800, bottom: 900 }, viewport)).toBeNull();
  });

  it('refuses a box with no height', () => {
    expect(surfaceFromBox({ left: 0, right: 200, top: 300, bottom: 300 }, viewport)).toBeNull();
  });
});

describe('findLanding', () => {
  const surfaces = [surface(0, 200, 300, 'high'), surface(0, 200, 500, 'low'), surface(250, 400, 400, 'right')];

  it('lands on the first surface crossed on the way down', () => {
    expect(findLanding(surfaces, 100, 250, 600, viewport)?.surface?.ref).toBe('high');
    expect(findLanding(surfaces, 100, 310, 600, viewport)?.surface?.ref).toBe('low');
  });

  it('does not snag on a surface while going up', () => {
    expect(findLanding(surfaces, 100, 600, 250, viewport)).toBeNull();
  });

  it('ignores a surface the pet is not over', () => {
    expect(findLanding(surfaces, 225, 250, 600, viewport)).toBeNull();
  });

  it('stops at the bottom of the screen, which is a hard floor', () => {
    expect(findLanding(surfaces, 225, 700, 900, viewport)).toEqual({ top: 800 });
  });

  it('comes to rest at once for reduced motion', () => {
    expect(restingPlace(surfaces, 300, 100, viewport).surface?.ref).toBe('right');
    expect(restingPlace([], 300, 100, viewport)).toEqual({ top: 800 });
  });
});

describe('isOnSurface', () => {
  it('wants the feet a little inside both ends', () => {
    expect(isOnSurface({ left: 0, right: 100 }, 50)).toBe(true);
    expect(isOnSurface({ left: 0, right: 100 }, 2)).toBe(false);
    expect(isOnSurface({ left: 0, right: 100 }, 98)).toBe(false);
  });
});

describe('clamping', () => {
  it('keeps the pet inside the walls, the ceiling and the floor', () => {
    expect(clampX(-50, viewport)).toBe(PET_SIZE / 2);
    expect(clampX(999, viewport)).toBe(400 - PET_SIZE / 2);
    expect(clampY(0, viewport)).toBe(ceilingOf());
    expect(clampY(2000, viewport)).toBe(800);
  });

  it('caps the fall speed', () => {
    expect(fall(0, 0.01)).toBeCloseTo(GRAVITY * 0.01);
    expect(fall(MAX_FALL_SPEED, 1)).toBe(MAX_FALL_SPEED);
  });
});

describe('jumping', () => {
  it('launches on an arc that lands on the target', () => {
    const from = { x: 100, y: 800 },
      to = { x: 220, y: 680 },
      { vx, vy } = jumpVelocity(from.x, from.y, to.x, to.y),
      target = [surface(150, 300, to.y)];

    let x = from.x,
      y = from.y,
      speed = vy,
      landing = null;

    for (let frame = 0; frame < 600 && landing === null; frame++) {
      const dt = 1 / 240,
        nextY = y + speed * dt;

      x += vx * dt;
      landing = findLanding(target, x, y, nextY, viewport);
      y = nextY;
      speed += GRAVITY * dt;
    }

    expect(landing?.top).toBe(to.y);
    expect(x).toBeCloseTo(to.x, -1);
  });

  it('only picks a surface above the feet and within reach', () => {
    const surfaces = [
      surface(0, 400, 790, 'too-low'),
      surface(0, 400, 500, 'too-high'),
      surface(300, 400, 700, 'in-reach'),
    ];

    expect(pickJumpTarget(surfaces, 200, 800, () => 0)?.surface.ref).toBe('in-reach');
    expect(pickJumpTarget(surfaces.slice(0, 2), 200, 800, () => 0)).toBeNull();
  });

  it('aims inside the nearer end of the surface', () => {
    const target = pickJumpTarget([surface(300, 400, 700)], 200, 800, () => 0);

    expect(target?.x).toBeGreaterThan(300);
    expect(isOnSurface(surface(300, 400, 700), target?.x ?? 0)).toBe(true);
  });
});
