/**
 * @fileoverview How the pet moves: gravity, landing on the page, jumping.
 *
 * Pure functions over plain numbers, so the rules can be tested without a
 * layout engine. The component measures the page and hands the numbers in.
 *
 * Coordinates are viewport pixels. The pet is described by its **feet**: `x`
 * is the centre of its box and `y` is its bottom edge, which is where it
 * stands.
 *
 * @module features/pet/lib/pet-physics
 */

// ============================================================================
// Constants
// ============================================================================

/** The pet's box, square, in CSS pixels. */
export const PET_SIZE = 60;

/** Pixels per second squared. Snappy rather than realistic. */
export const GRAVITY = 2200;

/** The fastest the pet falls, so a long drop does not tunnel through a card. */
export const MAX_FALL_SPEED = 1400;

/** Walking speed, pixels per second. */
export const WALK_SPEED = 48;

/** The highest surface the pet jumps to, measured from its feet. */
export const MAX_JUMP_HEIGHT = 180;

/** The farthest surface the pet jumps to, sideways. */
export const MAX_JUMP_REACH = 180;

/** How far above a surface the arc of a jump peaks. */
const JUMP_CLEARANCE = 28;

/** A surface narrower than this is not somewhere to stand. */
const MIN_SURFACE_WIDTH = 32;

/**
 * How far in from a surface's end the pet's feet must stay. A pet standing on
 * the last pixel of a button looks like it is floating.
 */
const FOOTING = 8;

// ============================================================================
// Type Definitions
// ============================================================================

/** The part of a `DOMRect` the physics reads. */
export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The visible viewport. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** The top edge of something the pet can stand on. */
export interface Surface<T = unknown> {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  /** What the edge belongs to, so the pet can ride it while the page scrolls. */
  readonly ref?: T;
}

/** Where a fall ends. */
export interface Landing<T = unknown> {
  readonly top: number;
  /** The surface, or `undefined` for the bottom of the screen. */
  readonly surface?: Surface<T>;
}

// ============================================================================
// Surfaces
// ============================================================================

/**
 * The lowest the pet's feet can go: the bottom of the screen, which is a hard
 * floor so the pet never leaves the page.
 *
 * @param viewport - The viewport
 * @returns The floor's `y`
 */
export function floorOf(viewport: Viewport): number {
  return viewport.height;
}

/**
 * The highest the pet's feet can go while it stands, so its head stays on
 * screen.
 *
 * @returns The ceiling's `y`
 */
export function ceilingOf(): number {
  return PET_SIZE + 4;
}

/**
 * Turns an element's box into a surface, or `null` when the pet cannot stand
 * on it: too narrow, off screen, or so high that its head would be cut off.
 *
 * @param box - The element's bounding box
 * @param viewport - The viewport
 * @param ref - What to remember the surface by
 * @returns The surface, or `null`
 */
export function surfaceFromBox<T>(box: Box, viewport: Viewport, ref?: T): Surface<T> | null {
  const left = Math.max(box.left, 0),
    right = Math.min(box.right, viewport.width);

  if (right - left < MIN_SURFACE_WIDTH) {
    return null;
  }

  if (box.top < ceilingOf() || box.top >= floorOf(viewport) || box.bottom <= box.top) {
    return null;
  }

  return { left, right, top: box.top, ref };
}

/**
 * Whether feet at `x` rest on a surface spanning `left` to `right`.
 *
 * @param surface - The surface
 * @param x - The pet's centre
 * @returns `true` when the pet is standing on it
 */
export function isOnSurface(surface: Pick<Surface, 'left' | 'right'>, x: number): boolean {
  return x >= surface.left + FOOTING && x <= surface.right - FOOTING;
}

/**
 * Finds the first thing a falling pet lands on between two frames.
 *
 * Only a surface the feet cross on the way **down** counts: a pet jumping up
 * through a card does not snag on it, which is what lets it jump from the
 * floor onto a button above.
 *
 * @param surfaces - What the pet can land on
 * @param x - The pet's centre
 * @param fromY - The feet before the frame
 * @param toY - The feet after the frame
 * @param viewport - The viewport, for the floor
 * @returns The landing, or `null` when the pet is still in the air
 */
export function findLanding<T>(
  surfaces: readonly Surface<T>[],
  x: number,
  fromY: number,
  toY: number,
  viewport: Viewport,
): Landing<T> | null {
  if (toY <= fromY) {
    return null;
  }

  let best: Surface<T> | undefined;

  for (const surface of surfaces) {
    if (
      surface.top >= fromY &&
      surface.top <= toY &&
      isOnSurface(surface, x) &&
      (best === undefined || surface.top < best.top)
    ) {
      best = surface;
    }
  }

  if (best !== undefined) {
    return { top: best.top, surface: best };
  }

  const floor = floorOf(viewport);

  return toY >= floor ? { top: floor } : null;
}

/**
 * Where a pet dropped at `fromY` comes to rest, without animating the fall.
 * For reduced motion, where the pet goes straight to the ground.
 *
 * @param surfaces - What the pet can land on
 * @param x - The pet's centre
 * @param fromY - Where it was let go
 * @param viewport - The viewport
 * @returns The landing
 */
export function restingPlace<T>(
  surfaces: readonly Surface<T>[],
  x: number,
  fromY: number,
  viewport: Viewport,
): Landing<T> {
  return findLanding(surfaces, x, fromY, floorOf(viewport), viewport) ?? { top: floorOf(viewport) };
}

// ============================================================================
// Motion
// ============================================================================

/**
 * Keeps the pet's centre inside the viewport.
 *
 * @param x - The centre
 * @param viewport - The viewport
 * @returns The clamped centre
 */
export function clampX(x: number, viewport: Viewport): number {
  const half = PET_SIZE / 2;

  return Math.min(Math.max(x, half), Math.max(half, viewport.width - half));
}

/**
 * Keeps the pet's feet between the ceiling and the floor.
 *
 * @param y - The feet
 * @param viewport - The viewport
 * @returns The clamped feet
 */
export function clampY(y: number, viewport: Viewport): number {
  return Math.min(Math.max(y, ceilingOf()), floorOf(viewport));
}

/**
 * The new vertical speed after one frame of falling.
 *
 * @param vy - The speed before
 * @param dt - The frame, in seconds
 * @returns The speed after, capped
 */
export function fall(vy: number, dt: number): number {
  return Math.min(vy + GRAVITY * dt, MAX_FALL_SPEED);
}

/**
 * The launch speed that carries the pet from one spot to another in an arc
 * peaking just above the higher of the two.
 *
 * @param fromX - Where the pet stands
 * @param fromY - Its feet
 * @param toX - Where it should land
 * @param toY - The surface it lands on
 * @returns The launch speed, `vy` negative for up
 */
export function jumpVelocity(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): { readonly vx: number; readonly vy: number } {
  const peak = Math.min(fromY, toY) - JUMP_CLEARANCE,
    rise = fromY - peak,
    drop = toY - peak,
    vy = -Math.sqrt(2 * GRAVITY * rise),
    time = Math.sqrt((2 * rise) / GRAVITY) + Math.sqrt((2 * drop) / GRAVITY);

  return { vx: (toX - fromX) / time, vy };
}

/**
 * Picks a surface above the pet worth jumping to, or `null`.
 *
 * Only a surface higher than the feet, within reach both ways, qualifies,
 * and the pet aims a little inside its nearer end.
 *
 * @param surfaces - The candidates
 * @param x - The pet's centre
 * @param y - Its feet
 * @param random - A `[0, 1)` source, injectable for tests
 * @returns The surface and the spot on it, or `null`
 */
export function pickJumpTarget<T>(
  surfaces: readonly Surface<T>[],
  x: number,
  y: number,
  random: () => number,
): { readonly surface: Surface<T>; readonly x: number } | null {
  const candidates = surfaces.flatMap((surface) => {
    const rise = y - surface.top;

    if (rise < 24 || rise > MAX_JUMP_HEIGHT) {
      return [];
    }

    const inset = Math.min(FOOTING + PET_SIZE / 2, (surface.right - surface.left) / 2),
      landX = Math.min(Math.max(x, surface.left + inset), surface.right - inset);

    return Math.abs(landX - x) <= MAX_JUMP_REACH && isOnSurface(surface, landX)
      ? [{ surface, x: landX }]
      : [];
  });

  if (candidates.length === 0) {
    return null;
  }

  return candidates[Math.floor(random() * candidates.length)] ?? null;
}
