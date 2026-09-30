/**
 * @fileoverview The pet on screen: it wanders, climbs the page, and answers a
 * tap with a bubble.
 *
 * What the pet does, frame by frame:
 *
 * - **Standing** on a surface, the top edge of a card, a button, a heading or
 *   the mobile nav bar, or on the bottom of the screen. It rides that surface
 *   while the page scrolls, and falls when the surface goes away.
 * - **Idle**, it picks something to do every few seconds: sit, walk, or jump
 *   up onto something within reach. Walking to the end of a surface, it
 *   turns around, or sometimes jumps off. After a minute with nobody touching
 *   it, it falls asleep.
 * - **Dragged**, it dangles under the pointer. Let go, it falls with the speed
 *   it was thrown at, and lands on the first surface under it.
 * - **Tapped**, it hops and says something in a bubble: a heart, its own
 *   sound, a friendly line, a joke or a tip about the app.
 *
 * The bottom of the screen is a hard floor and the sides are walls, so the
 * pet can never leave the page.
 *
 * Only the pet's own box takes pointer events. The wrapper is
 * `pointer-events-none`, and so is the bubble, because a fixed overlay eats
 * every tap under it (see AGENTS.md).
 *
 * Under `prefers-reduced-motion: reduce` the pet does not wander, a drop lands
 * at once, and nothing animates, but a tap and a drag still work.
 *
 * Position is written straight to the element's `transform` every frame, not
 * through React state, which only changes when the pose does. That is the
 * computed-geometry carve-out of the inline-style rule.
 *
 * @module features/pet/components/PetOverlay
 */

import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { captureEvent } from '@/lib/posthog';
import { cn } from '@/lib/utils';

import { usePetPreferences } from '../hooks/usePetPreferences';
import {
  PET_SIZE,
  WALK_SPEED,
  ceilingOf,
  clampX,
  clampY,
  fall,
  findLanding,
  floorOf,
  isOnSurface,
  jumpVelocity,
  pickJumpTarget,
  restingPlace,
  surfaceFromBox,
  type Landing,
  type Surface,
  type Viewport,
} from '../lib/pet-physics';
import { type PetReaction, pickReaction, reactionTextKey } from '../lib/pet-reactions';
import { collectSurfaces } from '../lib/pet-surfaces';
import { type PetExpression, PetSprite } from './PetSprite';

// ============================================================================
// Type Definitions
// ============================================================================

/** What the pet is doing, as `data-pet-pose` tells the stylesheet. */
export type PetPose = 'idle' | 'walk' | 'fall' | 'held' | 'sleep';

interface Simulation {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mode: PetPose;
  direction: -1 | 1;
  /** The element the pet stands on, or `null` for the floor. */
  support: Element | null;
  decideAt: number;
  walkUntil: number;
  /** Whether this walk may go over the edge instead of turning back. */
  mayLeap: boolean;
  lastTouch: number;
  surfaces: readonly Surface<Element>[];
  surfacesAt: number;
}

interface DragState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  moved: boolean;
  lastX: number;
  lastY: number;
  lastTime: number;
  vx: number;
  vy: number;
}

interface Bubble {
  readonly id: number;
  readonly reaction: PetReaction;
  readonly placement: 'above' | 'below';
  readonly align: 'start' | 'center' | 'end';
}

// ============================================================================
// Constants
// ============================================================================

/** How often surfaces are measured again while the pet is in the air. */
const SURFACE_REFRESH_MS = 250;

/** How long with nobody touching the pet before it falls asleep. */
const SLEEP_AFTER_MS = 60_000;

/** How long a bubble stays up. */
const BUBBLE_MS = 4_000;

/** How far a pointer moves before a press becomes a drag. */
const DRAG_THRESHOLD = 6;

/** How far one arrow key press moves the pet. */
const KEY_STEP = 24;

/** How far from a side the bubble stops centring on the pet. */
const BUBBLE_EDGE = 130;

/** The fastest a throw can send the pet, pixels per second. */
const MAX_THROW = 900;

// ============================================================================
// Helpers
// ============================================================================

function readViewport(): Viewport {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: window.innerHeight,
  };
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

function clampSpeed(value: number): number {
  return Math.max(-MAX_THROW, Math.min(MAX_THROW, value));
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// ============================================================================
// Sub-Components
// ============================================================================

/** A heart, for the bubble. Illustration colours, like the sprite. */
function PetHeart(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true" focusable="false">
      <path
        d="M12 21s-7.5-4.6-9.6-9.3C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.1 1.7-1.9 3.2-3.1 5.3-3.1 3.7 0 5.8 3.9 4.3 7.2C19.5 16.4 12 21 12 21z"
        fill="#FF6F91"
        stroke="#4A3426"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ============================================================================
// Component
// ============================================================================

/**
 * The pet overlay. Mounted by `PetMount` only while the pet is on.
 *
 * @returns The overlay
 */
export const PetOverlay = memo(function PetOverlay(): ReactElement {
  const { t } = useTranslation(),
    { species, outfit } = usePetPreferences(),
    rootRef = useRef<HTMLDivElement>(null),
    simRef = useRef<Simulation | null>(null),
    dragRef = useRef<DragState | null>(null),
    suppressClickRef = useRef(false),
    lastReactionRef = useRef<PetReaction | undefined>(undefined),
    reportedRef = useRef(false),
    bubbleUpRef = useRef(false),
    poseRef = useRef<PetPose>('fall'),
    [reducedMotion] = useState(prefersReducedMotion),
    [pose, setPoseState] = useState<PetPose>('fall'),
    [facing, setFacing] = useState<-1 | 1>(-1),
    [bubble, setBubble] = useState<Bubble | null>(null),
    [hopping, setHopping] = useState(false),
    [landed, setLanded] = useState(false);

  const speciesName = t(`pet.species.${species}`, species);

  // --------------------------------------------------------------------------
  // Simulation helpers
  // --------------------------------------------------------------------------

  const setMode = useCallback((sim: Simulation, mode: PetPose): void => {
    sim.mode = mode;
    if (poseRef.current !== mode) {
      poseRef.current = mode;
      setPoseState(mode);
    }
  }, []);

  const face = useCallback((sim: Simulation, direction: -1 | 1): void => {
    if (sim.direction !== direction) {
      sim.direction = direction;
      setFacing(direction);
    }
  }, []);

  const paint = useCallback((): void => {
    const sim = simRef.current,
      node = rootRef.current;

    if (sim !== null && node !== null) {
      node.style.transform = `translate3d(${sim.x - PET_SIZE / 2}px, ${sim.y - PET_SIZE}px, 0)`;
    }
  }, []);

  const refreshSurfaces = useCallback((sim: Simulation, now: number): readonly Surface<Element>[] => {
    sim.surfaces = collectSurfaces(rootRef.current, readViewport());
    sim.surfacesAt = now;
    return sim.surfaces;
  }, []);

  const land = useCallback(
    (sim: Simulation, landing: Landing<Element>, now: number): void => {
      const hard = sim.vy > 500;

      sim.y = landing.top;
      sim.vx = 0;
      sim.vy = 0;
      sim.support = landing.surface?.ref ?? null;
      sim.decideAt = now + randomBetween(600, 1800);
      setMode(sim, 'idle');

      if (hard && !reducedMotion) {
        setLanded(true);
        window.setTimeout(() => setLanded(false), 240);
      }
    },
    [reducedMotion, setMode],
  );

  const startFalling = useCallback(
    (sim: Simulation, now: number): void => {
      sim.support = null;
      refreshSurfaces(sim, now);

      if (reducedMotion) {
        land(sim, restingPlace(sim.surfaces, sim.x, sim.y, readViewport()), now);
        return;
      }

      setMode(sim, 'fall');
    },
    [land, reducedMotion, refreshSurfaces, setMode],
  );

  /** Where the pet's feet rest now, or `null` when the surface went away. */
  const supportTop = useCallback((sim: Simulation, viewport: Viewport): number | null => {
    if (sim.support === null) {
      return floorOf(viewport);
    }
    if (!sim.support.isConnected) {
      return null;
    }

    const surface = surfaceFromBox(sim.support.getBoundingClientRect(), viewport);

    return surface !== null && isOnSurface(surface, sim.x) ? surface.top : null;
  }, []);

  const decide = useCallback(
    (sim: Simulation, now: number): void => {
      if (reducedMotion) {
        sim.decideAt = Number.POSITIVE_INFINITY;
        return;
      }

      const roll = Math.random();

      if (roll < 0.22) {
        const target = pickJumpTarget(refreshSurfaces(sim, now), sim.x, sim.y, Math.random);

        if (target !== null) {
          const velocity = jumpVelocity(sim.x, sim.y, target.x, target.surface.top);

          sim.vx = velocity.vx;
          sim.vy = velocity.vy;
          sim.support = null;
          face(sim, velocity.vx < 0 ? -1 : 1);
          setMode(sim, 'fall');
          return;
        }
      }

      if (roll < 0.65) {
        face(sim, Math.random() < 0.5 ? -1 : 1);
        sim.walkUntil = now + randomBetween(1500, 5000);
        sim.mayLeap = Math.random() < 0.3;
        sim.decideAt = sim.walkUntil;
        setMode(sim, 'walk');
        return;
      }

      sim.decideAt = now + randomBetween(1500, 5000);
      setMode(sim, 'idle');
    },
    [face, reducedMotion, refreshSurfaces, setMode],
  );

  const tick = useCallback(
    (now: number, dt: number): void => {
      const sim = simRef.current;

      if (sim === null || sim.mode === 'held') {
        return;
      }

      const viewport = readViewport();
      sim.x = clampX(sim.x, viewport);

      if (sim.mode === 'fall' && reducedMotion) {
        land(sim, restingPlace(refreshSurfaces(sim, now), sim.x, sim.y, viewport), now);
        return;
      }

      if (sim.mode === 'fall') {
        sim.vy = fall(sim.vy, dt);

        const nextX = sim.x + sim.vx * dt,
          clampedX = clampX(nextX, viewport);

        if (clampedX !== nextX) {
          sim.vx = -sim.vx * 0.4;
        }
        sim.x = clampedX;

        if (now - sim.surfacesAt > SURFACE_REFRESH_MS) {
          refreshSurfaces(sim, now);
        }

        const nextY = sim.y + sim.vy * dt,
          landing = findLanding(sim.surfaces, sim.x, sim.y, nextY, viewport);

        if (landing !== null) {
          land(sim, landing, now);
        } else if (nextY < ceilingOf()) {
          sim.y = ceilingOf();
          sim.vy = Math.max(sim.vy, 0);
        } else {
          sim.y = nextY;
        }
        return;
      }

      const top = supportTop(sim, viewport);

      if (top === null) {
        sim.vx = sim.mode === 'walk' ? sim.direction * WALK_SPEED : 0;
        sim.vy = 0;
        startFalling(sim, now);
        return;
      }
      sim.y = top;

      if (sim.mode === 'walk') {
        const next = sim.x + sim.direction * WALK_SPEED * dt,
          half = PET_SIZE / 2,
          atWall = next <= half || next >= viewport.width - half,
          box = sim.support?.getBoundingClientRect(),
          atEdge = box !== undefined && !isOnSurface(box, next);

        if (atWall || (atEdge && !sim.mayLeap)) {
          face(sim, sim.direction === 1 ? -1 : 1);
        } else {
          sim.x = next;
        }

        if (now >= sim.walkUntil) {
          setMode(sim, 'idle');
        }
      }

      if (bubbleUpRef.current) {
        sim.decideAt = Math.max(sim.decideAt, now + 500);
        if (sim.mode === 'walk') {
          setMode(sim, 'idle');
        }
        return;
      }

      if (sim.mode === 'idle' && now - sim.lastTouch > SLEEP_AFTER_MS) {
        setMode(sim, 'sleep');
        return;
      }

      if (sim.mode !== 'sleep' && now >= sim.decideAt) {
        decide(sim, now);
      }
    },
    [decide, face, land, reducedMotion, refreshSurfaces, setMode, startFalling, supportTop],
  );

  // --------------------------------------------------------------------------
  // Loop
  // --------------------------------------------------------------------------

  useEffect(() => {
    const now = performance.now(),
      viewport = readViewport(),
      sim: Simulation = {
        x: clampX(viewport.width - 90, viewport),
        y: ceilingOf(),
        vx: 0,
        vy: 0,
        mode: 'fall',
        direction: -1,
        support: null,
        decideAt: now + 1500,
        walkUntil: 0,
        mayLeap: false,
        lastTouch: now,
        surfaces: [],
        surfacesAt: 0,
      };

    // The pet starts in the air: it drops in from the top of the screen, or,
    // for reduced motion, appears on the first frame where it would land.
    simRef.current = sim;
    paint();

    const request =
        typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame.bind(window)
          : (callback: FrameRequestCallback): number =>
              window.setTimeout(() => callback(performance.now()), 16),
      cancel =
        typeof window.cancelAnimationFrame === 'function'
          ? window.cancelAnimationFrame.bind(window)
          : window.clearTimeout.bind(window);

    let last = now,
      frame = 0;

    const loop = (time: number): void => {
      // A background tab stops the frames; resuming must not replay the gap.
      const dt = Math.min(Math.max((time - last) / 1000, 0), 0.05);

      last = time;
      tick(time, dt);
      paint();
      frame = request(loop);
    };

    frame = request(loop);

    return () => {
      cancel(frame);
      simRef.current = null;
    };
  }, [paint, tick]);

  useEffect(() => {
    bubbleUpRef.current = bubble !== null;

    if (bubble === null) {
      return undefined;
    }

    const timer = window.setTimeout(() => setBubble(null), BUBBLE_MS);

    return () => window.clearTimeout(timer);
  }, [bubble]);

  // --------------------------------------------------------------------------
  // Interaction
  // --------------------------------------------------------------------------

  const interact = useCallback((): void => {
    const sim = simRef.current;

    if (sim === null) {
      return;
    }

    const now = performance.now(),
      viewport = readViewport(),
      reaction = pickReaction(Math.random, lastReactionRef.current);

    lastReactionRef.current = reaction;
    sim.lastTouch = now;

    if (sim.mode === 'sleep' || sim.mode === 'walk') {
      setMode(sim, 'idle');
    }
    sim.decideAt = now + BUBBLE_MS;

    setBubble({
      id: now,
      reaction,
      placement: sim.y - PET_SIZE < 96 ? 'below' : 'above',
      align:
        sim.x < BUBBLE_EDGE ? 'start' : sim.x > viewport.width - BUBBLE_EDGE ? 'end' : 'center',
    });

    if (!reducedMotion && sim.mode === 'idle') {
      setHopping(true);
      window.setTimeout(() => setHopping(false), 460);
    }

    // Once per page load: a pet invites a dozen taps in a row, and one
    // person tapping is one answer to "does anybody play with it", not twelve.
    if (!reportedRef.current) {
      reportedRef.current = true;
      captureEvent('pet_interacted', { species, reaction: reaction.kind });
    }
  }, [reducedMotion, setMode, species]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>): void => {
    const sim = simRef.current;

    if (sim === null || event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - sim.x,
      offsetY: event.clientY - sim.y,
      moved: false,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      vx: 0,
      vy: 0,
    };
  }, []);

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>): void => {
      const drag = dragRef.current,
        sim = simRef.current;

      if (drag === null || sim === null || drag.pointerId !== event.pointerId) {
        return;
      }

      if (
        !drag.moved &&
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD
      ) {
        return;
      }

      if (!drag.moved) {
        drag.moved = true;
        sim.support = null;
        setBubble(null);
        setMode(sim, 'held');
      }

      const viewport = readViewport(),
        elapsed = (event.timeStamp - drag.lastTime) / 1000;

      if (elapsed > 0) {
        drag.vx = 0.6 * ((event.clientX - drag.lastX) / elapsed) + 0.4 * drag.vx;
        drag.vy = 0.6 * ((event.clientY - drag.lastY) / elapsed) + 0.4 * drag.vy;
      }
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.lastTime = event.timeStamp;

      sim.x = clampX(event.clientX - drag.offsetX, viewport);
      sim.y = clampY(event.clientY - drag.offsetY, viewport);
      sim.lastTouch = performance.now();
      paint();
    },
    [paint, setMode],
  );

  const release = useCallback(
    (event: PointerEvent<HTMLButtonElement>): void => {
      const drag = dragRef.current,
        sim = simRef.current;

      if (drag === null || drag.pointerId !== event.pointerId) {
        return;
      }
      dragRef.current = null;

      if (!drag.moved || sim === null) {
        return;
      }

      suppressClickRef.current = true;
      sim.vx = clampSpeed(drag.vx);
      sim.vy = clampSpeed(drag.vy);
      if (sim.vx !== 0) {
        face(sim, sim.vx < 0 ? -1 : 1);
      }
      startFalling(sim, performance.now());
    },
    [face, startFalling],
  );

  const handleClick = useCallback((): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    interact();
  }, [interact]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>): void => {
      const sim = simRef.current;

      if (sim === null || sim.mode === 'fall' || sim.mode === 'held') {
        return;
      }

      const now = performance.now();

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' ? -1 : 1;

        face(sim, direction);
        sim.x = clampX(sim.x + direction * KEY_STEP, readViewport());
        sim.lastTouch = now;
        sim.decideAt = now + 3000;
        setMode(sim, 'idle');
        paint();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        sim.lastTouch = now;
        sim.vx = 0;
        sim.vy = -620;
        sim.support = null;
        if (reducedMotion) {
          startFalling(sim, now);
        } else {
          setMode(sim, 'fall');
        }
      }
    },
    [face, paint, reducedMotion, setMode, startFalling],
  );

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  const expression: PetExpression =
      pose === 'sleep'
        ? 'sleep'
        : pose === 'held'
          ? 'surprised'
          : bubble !== null
            ? 'happy'
            : 'normal',
    bubbleText =
      bubble === null
        ? ''
        : t(reactionTextKey(bubble.reaction, species), { name: speciesName });

  return (
    <div
      ref={rootRef}
      data-testid="pet"
      data-pet-pose={pose}
      data-pet-hop={hopping ? 'true' : undefined}
      data-pet-landed={landed ? 'true' : undefined}
      className="pointer-events-none fixed left-0 top-0 z-50 size-15 will-change-transform print:hidden"
    >
      {pose !== 'fall' && pose !== 'held' && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-1/2 h-1.5 w-9 -translate-x-1/2 translate-y-1/2 rounded-full bg-foreground/15"
        />
      )}

      <button
        type="button"
        aria-label={t('pet.label', {
          name: speciesName,
          defaultValue: '{{name}}, your pet. Press to play. Drag it, or use the arrow keys, to move it.',
        })}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        className={cn(
          'pointer-events-auto block size-full cursor-grab touch-none select-none rounded-full',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          pose === 'held' && 'cursor-grabbing',
        )}
      >
        <span
          className={cn(
            'block size-full dark:drop-shadow-[0_0_1.5px_rgb(255_255_255/0.6)]',
            facing === -1 && '-scale-x-100',
          )}
        >
          <PetSprite species={species} outfit={outfit} expression={expression} className="size-full" />
        </span>
      </button>

      {bubble !== null && (
        <div
          key={bubble.id}
          aria-hidden="true"
          className={cn(
            'pet-bubble pointer-events-none absolute w-max max-w-56 rounded-2xl border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg',
            bubble.placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2',
            bubble.align === 'center' && 'left-1/2 -translate-x-1/2',
            bubble.align === 'start' && 'left-0',
            bubble.align === 'end' && 'right-0',
          )}
        >
          {bubble.reaction.kind === 'heart' ? (
            <PetHeart />
          ) : (
            <>
              {bubble.reaction.kind === 'tip' && (
                <span className="mb-0.5 block text-xs font-semibold text-primary">
                  {t('pet.tipLabel', 'Tip')}
                </span>
              )}
              {bubbleText}
            </>
          )}
          <span
            aria-hidden="true"
            className={cn(
              'absolute size-2.5 rotate-45 border bg-popover',
              bubble.placement === 'above'
                ? 'top-full -mt-[5px] border-l-0 border-t-0'
                : 'bottom-full -mb-[5px] border-b-0 border-r-0',
              bubble.align === 'center' && 'left-1/2 -translate-x-1/2',
              bubble.align === 'start' && 'left-6',
              bubble.align === 'end' && 'right-6',
            )}
          />
        </div>
      )}

      {/* The bubble is drawn for the eye; this says the same thing to a screen reader. */}
      <p className="sr-only" aria-live="polite">
        {bubbleText}
      </p>
    </div>
  );
});
