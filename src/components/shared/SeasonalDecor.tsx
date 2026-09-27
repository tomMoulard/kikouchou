/**
 * @fileoverview The small seasonal touches a seasonal palette brings with it:
 * bats across the header and a cobweb in the corner for Halloween, snow, a
 * tree and gifts for Christmas, hearts for Valentine's Day, clovers and a
 * rainbow ending in a cauldron of gold for Saint Patrick's.
 *
 * Two surfaces, and neither can take a tap:
 *
 * - {@link SeasonalHeaderDecor} sits inside the sticky header, clipped to it,
 *   behind the header's own content.
 * - {@link SeasonalBackdrop} is fixed to the viewport at `-z-10`, so it paints
 *   over the page background and under every card, button and bar. That is
 *   why `Layout`'s root carries no background of its own: `body` paints it,
 *   and a root background would cover the backdrop entirely.
 *
 * Both are `aria-hidden` and `pointer-events-none`, and both render nothing
 * for a year-round palette. Motion lives in `index.css` behind
 * `prefers-reduced-motion: no-preference`; without it the pieces stand still
 * and the snow is not drawn at all.
 *
 * @module components/shared/SeasonalDecor
 */

import { type ReactElement, memo } from 'react';

import { useActivePalette } from '@/hooks/useActivePalette';
import { cn } from '@/lib/utils';

import type { Palette } from '@/lib/palette';

// ============================================================================
// Constants
// ============================================================================

/**
 * Rainbow bands, outermost first.
 *
 * Literal colours on purpose: a rainbow is its colours, whichever palette is
 * on, so none of the theme tokens is the right source. They are SVG paint
 * values rather than inline styles.
 */
const RAINBOW_BANDS = [
  'oklch(0.63 0.2 25)',
  'oklch(0.75 0.16 60)',
  'oklch(0.88 0.16 95)',
  'oklch(0.7 0.17 145)',
  'oklch(0.62 0.13 240)',
  'oklch(0.5 0.15 295)',
] as const;

/**
 * Snowflakes: position, size and timing, one class string each. Negative
 * delays start the fall already under way, so the page never loads on an
 * empty sky that then fills.
 */
const SNOWFLAKES = [
  'left-[4%] size-1.5 [animation-duration:14s] [animation-delay:-2s]',
  'left-[11%] size-1 [animation-duration:18s] [animation-delay:-9s]',
  'left-[19%] size-2 [animation-duration:16s] [animation-delay:-5s]',
  'left-[27%] size-1 [animation-duration:20s] [animation-delay:-13s]',
  'left-[35%] size-1.5 [animation-duration:15s] [animation-delay:-7s]',
  'left-[43%] size-1 [animation-duration:19s] [animation-delay:-1s]',
  'left-[51%] size-2 [animation-duration:17s] [animation-delay:-11s]',
  'left-[59%] size-1 [animation-duration:21s] [animation-delay:-4s]',
  'left-[67%] size-1.5 [animation-duration:16s] [animation-delay:-15s]',
  'left-[75%] size-1 [animation-duration:18s] [animation-delay:-6s]',
  'left-[83%] size-2 [animation-duration:14s] [animation-delay:-10s]',
  'left-[91%] size-1 [animation-duration:20s] [animation-delay:-3s]',
  'left-[97%] size-1.5 [animation-duration:17s] [animation-delay:-8s]',
] as const;

/** Bats: where each rests without motion, its height and its flight timing. */
const BATS = [
  'left-[22%] top-2 w-5 [animation-duration:26s] [animation-delay:-4s]',
  'left-[48%] top-6 w-4 [animation-duration:34s] [animation-delay:-17s]',
  'left-[71%] top-3 w-3.5 [animation-duration:30s] [animation-delay:-9s]',
] as const;

/** Hearts rising through the header. */
const HEARTS = [
  'left-[18%] size-3 [animation-duration:9s] [animation-delay:-1s]',
  'left-[34%] size-2.5 [animation-duration:11s] [animation-delay:-6s]',
  'left-[52%] size-3.5 [animation-duration:10s] [animation-delay:-3s]',
  'left-[66%] size-2.5 [animation-duration:12s] [animation-delay:-8s]',
  'left-[80%] size-3 [animation-duration:9.5s] [animation-delay:-5s]',
] as const;

/** Clovers swaying in the header. */
const CLOVERS = [
  'left-[24%] top-2 size-4 [animation-delay:-1s]',
  'left-[45%] top-7 size-3 [animation-delay:-2.5s]',
  'left-[63%] top-1.5 size-3.5 [animation-delay:-0.5s]',
  'left-[82%] top-6 size-3 [animation-delay:-2s]',
] as const;

/** Fairy lights along the bottom of the header, in the brand's four colours. */
const LIGHT_COLOURS = [
  'bg-brand-soleil',
  'bg-brand-corail',
  'bg-brand-framboise',
  'bg-brand-prune',
] as const;

const LIGHT_COUNT = 24;

// ============================================================================
// Pieces
// ============================================================================

function Bat({ className }: { readonly className: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 10"
      className={cn('seasonal-bat absolute fill-foreground/45', className)}
      data-piece="bat"
    >
      <path d="M12 3C11 1 10.5 1.5 10 3C7 1 4 0.5 0 1.5C3 3 3.5 5 3 7.5C5 6 7 6.5 8.5 8C9.5 6.5 10.5 6 12 8C13.5 6 14.5 6.5 15.5 8C17 6.5 19 6 21 7.5C20.5 5 21 3 24 1.5C20 0.5 17 1 14 3C13.5 1.5 13 1 12 3Z" />
    </svg>
  );
}

function Heart({ className }: { readonly className: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 16 14"
      className={cn('seasonal-rise absolute bottom-0 fill-primary/35', className)}
      data-piece="heart"
    >
      <path d="M8 14C-2 7 1 -2 8 3C15 -2 18 7 8 14Z" />
    </svg>
  );
}

function Clover({ className }: { readonly className: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 16 18"
      className={cn('seasonal-sway absolute fill-primary/40', className)}
      data-piece="clover"
    >
      <circle cx="8" cy="4.5" r="4" />
      <circle cx="3.8" cy="10" r="4" />
      <circle cx="12.2" cy="10" r="4" />
      <path d="M7 10H9L10.5 18H8.5Z" />
    </svg>
  );
}

// ============================================================================
// Scenes
// ============================================================================

/**
 * A cobweb in the top-right corner, with a spider on its thread.
 */
function CobwebScene(): ReactElement {
  return (
    <svg
      viewBox="0 0 120 150"
      className="absolute top-14 right-0 w-28 fill-none stroke-muted-foreground/45 md:w-36"
      data-piece="cobweb"
    >
      {/* Radials, from the corner. */}
      <path d="M120 0L0 0M120 0L10 55M120 0L45 95M120 0L90 110M120 0L120 115" strokeWidth="1" />
      {/* Spiral, three rings, each a chain of sagging arcs between radials. */}
      {[30, 55, 80].map((radius) => {
        const points = [0, 27, 50, 72, 90].map((degrees) => {
          const radians = (degrees * Math.PI) / 180;

          return [120 - radius * Math.cos(radians), radius * Math.sin(radians)] as const;
        });

        return (
          <path
            key={radius}
            strokeWidth="0.9"
            d={points
              .map(([x, y], index) => {
                if (index === 0) {
                  return `M${x.toFixed(1)} ${y.toFixed(1)}`;
                }

                const [px, py] = points[index - 1] ?? [x, y],
                  midX = (px + x) / 2 + 4,
                  midY = (py + y) / 2 - 4;

                return `Q${midX.toFixed(1)} ${midY.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
              })
              .join('')}
          />
        );
      })}
      <g className="seasonal-dangle">
        <path d="M78 42V96" strokeWidth="0.8" />
        <g className="fill-foreground/50 stroke-foreground/50" strokeWidth="1">
          <ellipse cx="78" cy="101" rx="4" ry="5" />
          <path d="M74 99L68 95M74 102L67 102M74 105L68 109M82 99L88 95M82 102L89 102M82 105L88 109" />
        </g>
      </g>
    </svg>
  );
}

/**
 * Snow over the whole page, and a small tree with gifts in the bottom-right
 * corner, above the phone's bottom stack.
 */
function ChristmasScene(): ReactElement {
  return (
    <>
      {SNOWFLAKES.map((className) => (
        <span
          key={className}
          className={cn(
            'seasonal-snowflake absolute top-0 rounded-full bg-foreground/20 dark:bg-foreground/55',
            className,
          )}
          data-piece="snowflake"
        />
      ))}
      <svg
        viewBox="0 0 90 80"
        className="absolute right-4 bottom-above-stack w-20 opacity-70 md:bottom-4 md:w-24"
        data-piece="tree"
      >
        <rect className="fill-brand-prune" x="24" y="66" width="8" height="10" />
        <path className="fill-primary" d="M28 10L44 34H36L50 54H40L56 70H0L16 54H6L20 34H12Z" />
        <path
          className="fill-brand-soleil"
          d="M28 2L29.5 6.5H34L30.5 9L32 13.5L28 11L24 13.5L25.5 9L22 6.5H26.5Z"
        />
        <circle className="fill-brand-framboise" cx="22" cy="44" r="2.2" />
        <circle className="fill-brand-soleil" cx="34" cy="50" r="2.2" />
        <circle className="fill-brand-corail" cx="18" cy="62" r="2.2" />
        <circle className="fill-brand-soleil" cx="40" cy="64" r="2.2" />
        <rect className="fill-brand-framboise" x="52" y="60" width="18" height="16" rx="1.5" />
        <rect className="fill-brand-soleil" x="59.5" y="60" width="3" height="16" />
        <rect className="fill-brand-soleil" x="52" y="66.5" width="18" height="3" />
        <rect className="fill-brand-prune" x="72" y="66" width="14" height="10" rx="1.5" />
        <rect className="fill-brand-soleil" x="77.5" y="66" width="3" height="10" />
      </svg>
    </>
  );
}

/**
 * A few hearts gathered in the top-right corner.
 */
function ValentineScene(): ReactElement {
  return (
    <svg
      viewBox="0 0 100 70"
      className="absolute top-16 right-2 w-24 fill-primary/20 md:w-32"
      data-piece="hearts"
    >
      <path d="M70 50C50 36 56 18 70 28C84 18 90 36 70 50Z" />
      <path d="M36 34C24 26 28 14 36 20C44 14 48 26 36 34Z" />
      <path d="M88 20C82 16 84 10 88 13C92 10 94 16 88 20Z" />
    </svg>
  );
}

/**
 * A rainbow coming in from the right edge and landing in a cauldron of gold.
 */
function RainbowScene(): ReactElement {
  return (
    <svg
      viewBox="0 0 200 130"
      className="absolute top-14 right-0 w-44 opacity-55 md:w-60"
      data-piece="rainbow"
    >
      <g fill="none" strokeWidth="5">
        {RAINBOW_BANDS.map((colour, index) => {
          const radius = 125 - index * 5;

          return (
            <path
              key={colour}
              stroke={colour}
              d={`M${200 - radius} 110A${radius} ${radius} 0 0 1 200 ${110 - radius}`}
            />
          );
        })}
      </g>
      {/* The pot sits where the bands land, around x 75 to 100: body, coins heaped above it, then the rim in front of the coins. */}
      <g>
        <path className="fill-foreground/80" d="M68 100H108Q110 124 88 126Q66 124 68 100Z" />
        <path className="fill-foreground/80" d="M72 122L69 129H74ZM104 122L107 129H102Z" />
        <g className="fill-brand-soleil stroke-brand-corail" strokeWidth="0.8">
          <circle cx="76" cy="95" r="5" />
          <circle cx="100" cy="95" r="5" />
          <circle cx="82" cy="89" r="5" />
          <circle cx="94" cy="89" r="5" />
          <circle cx="88" cy="94" r="5" />
          <circle cx="88" cy="82" r="4.5" />
        </g>
        <rect className="fill-foreground/80" x="65" y="97" width="46" height="5" rx="2.5" />
      </g>
    </svg>
  );
}

// ============================================================================
// Component
// ============================================================================

/**
 * Header pieces for each seasonal palette.
 */
const HEADER_PIECES: Partial<Record<Palette, () => ReactElement>> = {
  halloween: () => (
    <>
      {BATS.map((className) => (
        <Bat key={className} className={className} />
      ))}
    </>
  ),
  valentine: () => (
    <>
      {HEARTS.map((className) => (
        <Heart key={className} className={className} />
      ))}
    </>
  ),
  stpatrick: () => (
    <>
      {CLOVERS.map((className) => (
        <Clover key={className} className={className} />
      ))}
    </>
  ),
  christmas: () => (
    <div className="absolute inset-x-0 bottom-0.5 flex justify-around px-24" data-piece="lights">
      {Array.from({ length: LIGHT_COUNT }, (_, index) => (
        <span
          key={index}
          className={cn(
            'seasonal-twinkle size-1.5 rounded-full',
            LIGHT_COLOURS[index % LIGHT_COLOURS.length],
            index % 3 === 0 && '[animation-delay:-0.6s]',
            index % 3 === 1 && '[animation-delay:-1.3s]',
            // Half the string on a phone, where 24 lights in 200px is a bead
            // curtain rather than a garland.
            index % 2 === 1 && 'max-sm:hidden',
          )}
        />
      ))}
    </div>
  ),
};

/**
 * Backdrop scene for each seasonal palette.
 */
const BACKDROP_SCENES: Partial<Record<Palette, () => ReactElement>> = {
  halloween: CobwebScene,
  christmas: ChristmasScene,
  valentine: ValentineScene,
  stpatrick: RainbowScene,
};

/**
 * The seasonal pieces inside the sticky header.
 *
 * Must be rendered as a child of the header, which is `sticky` and so already
 * a containing block: the pieces are clipped to its 56px and drawn behind its
 * links and badges.
 *
 * @returns The header pieces, or nothing for a year-round palette
 */
export const SeasonalHeaderDecor = memo(
  function SeasonalHeaderDecor(): ReactElement | null {
    const Pieces = HEADER_PIECES[useActivePalette()];

    if (!Pieces) {
      return null;
    }

    return (
      <div
        aria-hidden="true"
        data-testid="seasonal-header-decor"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden @container print:hidden"
      >
        <Pieces />
      </div>
    );
  },
);

/**
 * The seasonal scene behind the page.
 *
 * @returns The backdrop, or nothing for a year-round palette
 */
export const SeasonalBackdrop = memo(
  function SeasonalBackdrop(): ReactElement | null {
    const Scene = BACKDROP_SCENES[useActivePalette()];

    if (!Scene) {
      return null;
    }

    return (
      <div
        aria-hidden="true"
        data-testid="seasonal-backdrop"
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden print:hidden"
      >
        <Scene />
      </div>
    );
  },
);
