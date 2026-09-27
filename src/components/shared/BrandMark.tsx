/**
 * @fileoverview The Kikouchou logo mark: a house of four rooms under a roof.
 *
 * The geometry is the brand kit's 64-unit grid, so the mark stays pixel-aligned
 * at 16, 32, 48 and 64px. Each room reads its own `--brand-*` token, and those
 * switch to the brighter values under `.dark`, so the mark follows the app's
 * theme and not only the system one. Do not recolour a single room outside the
 * palette.
 *
 * A seasonal palette dresses the house without changing it: a carved face and
 * a stem for Halloween, snow and a star for Christmas, a heart, a clover. The
 * dress is drawn on top of the four rooms, so the mark underneath is still the
 * brand's.
 *
 * @module components/shared/BrandMark
 */

import type { ReactElement, SVGProps } from 'react';

import { cn } from '@/lib/utils';

import type { Palette } from '@/lib/palette';

// ============================================================================
// Type Definitions
// ============================================================================

interface BrandMarkProps extends SVGProps<SVGSVGElement> {
  /**
   * The active palette. A seasonal one adds its dress to the house; any other
   * value, or none, draws the plain mark.
   */
  readonly palette?: Palette;
}

// ============================================================================
// Seasonal dress
// ============================================================================

/**
 * Snow, the heart and the clover.
 *
 * One of the places AGENTS.md allows the literal: they sit on the brand rooms,
 * whose tokens are neither `--foreground` nor `--background`, and the same
 * white reads on all four in both modes.
 */
// eslint-disable-next-line kikouchou/no-raw-palette-class -- drawn over the brand rooms, where no theme token applies; see the comment above
const DRESS_WHITE = 'fill-white';

/**
 * A jack-o'-lantern: the tall room is the pumpkin, carved to show the candle
 * (Soleil) inside, and the roof gets a stem.
 */
function HalloweenDress(): ReactElement {
  return (
    <g data-dress="halloween">
      <rect className="fill-chart-4" x="30" y="0" width="4" height="6" rx="1.5" />
      <path className="fill-brand-soleil" d="M10.5 42L15 36.5L17.5 42Z" />
      <path className="fill-brand-soleil" d="M18.5 42L21 36.5L25.5 42Z" />
      <path
        className="fill-brand-soleil"
        d="M10.5 47.5H25.5Q25 55 18 55.5Q11 55 10.5 47.5ZM14 47.5V50.5H16.5V47.5ZM19.5 47.5V50.5H22V47.5Z"
        fillRule="evenodd"
      />
    </g>
  );
}

/**
 * Snow on the upper roof and a star on its apex.
 */
function ChristmasDress(): ReactElement {
  return (
    <g data-dress="christmas">
      <path
        className={DRESS_WHITE}
        d="M19.75 14.5L30.37 5.39Q32 4 33.63 5.39L44.25 14.5Q42 17 40 15Q38 18 35 15.5Q32 19 29 15.5Q26 18 24 15Q22 17 19.75 14.5Z"
      />
      <path
        className="fill-brand-soleil"
        d="M32 0L33.23 3.3L36.76 3.45L34 5.65L34.94 9.05L32 7.1L29.06 9.05L30 5.65L27.24 3.45L30.77 3.3Z"
      />
    </g>
  );
}

/**
 * A heart on the tall room.
 */
function ValentineDress(): ReactElement {
  return (
    <g data-dress="valentine">
      <path
        className={DRESS_WHITE}
        d="M18 54C9 47.5 11 38 18 42.5C25 38 27 47.5 18 54Z"
      />
    </g>
  );
}

/**
 * A three-leaf clover on the tall room.
 */
function StPatrickDress(): ReactElement {
  return (
    <g data-dress="stpatrick" className={DRESS_WHITE}>
      <circle cx="18" cy="40.5" r="4" />
      <circle cx="13.8" cy="46.5" r="4" />
      <circle cx="22.2" cy="46.5" r="4" />
      <path d="M17 46H19L20.5 56H18.5Z" />
    </g>
  );
}

/**
 * The dress for each seasonal palette. Year-round palettes have none.
 */
const DRESSES: Partial<Record<Palette, () => ReactElement>> = {
  halloween: HalloweenDress,
  christmas: ChristmasDress,
  valentine: ValentineDress,
  stpatrick: StPatrickDress,
};

// ============================================================================
// Component
// ============================================================================

export function BrandMark({
  className,
  palette,
  ...props
}: BrandMarkProps): ReactElement {
  const Dress = palette === undefined ? undefined : DRESSES[palette];

  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      className={cn('size-6 shrink-0', className)}
      {...props}
    >
      <path
        className="fill-brand-soleil"
        d="M10.76 28Q4 28 9.13 23.6L30.37 5.39Q32 4 33.63 5.39L54.87 23.6Q60 28 53.24 28L10.76 28Z"
      />
      <rect className="fill-brand-corail" x="8" y="32" width="20" height="28" rx="2.5" />
      <rect className="fill-brand-framboise" x="32" y="32" width="24" height="12" rx="2.5" />
      <rect className="fill-brand-prune" x="32" y="48" width="24" height="12" rx="2.5" />
      {Dress ? <Dress /> : null}
    </svg>
  );
}
