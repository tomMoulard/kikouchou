/**
 * @fileoverview Solid twins of the bottom bar's four lucide icons.
 *
 * The mobile tab bar marked the current page with colour alone. On a phone,
 * against a white bar, one tinted outline among four outlines is easy to miss —
 * people could not tell which page they were on. Every mobile app solves this
 * the same way: the selected tab's glyph is filled, the rest are outlines. The
 * shape changes, not just its colour, so the answer survives a glance, a bright
 * screen, and a reader who does not distinguish the two colours.
 *
 * lucide-react has no solid set — every icon is an outline drawn with
 * `fill: none` and a stroke — and a blanket `fill-current` on these four does
 * not produce one. `Calendar` is a rectangle plus three lines: filling it gives
 * a plain solid square and swallows the grid that makes it a calendar. `Users`
 * is circles and arcs that merge into a blob. So the four are drawn here, on
 * lucide's own 24x24 grid and matching its silhouettes, with `evenodd` cutting
 * the interior detail out of the fill rather than drawing it on top.
 *
 * Only the four primary tabs need one. Everything else in the bar — the More
 * button, the sheet, the desktop sidebar — keeps its lucide outline, so this
 * file stays a closed set rather than a second icon library to maintain.
 *
 * @module components/shared/nav-icons
 */

import type { ReactElement, SVGProps } from 'react';

/**
 * The props a lucide icon accepts that these are used with.
 *
 * Deliberately narrower than `LucideProps`: `strokeWidth` and `absoluteStrokeWidth`
 * mean nothing to a filled glyph, and accepting them would invite a call site
 * to set one and wonder why nothing moved.
 */
export type SolidIconProps = Omit<SVGProps<SVGSVGElement>, 'children' | 'fill'>;

/**
 * Shared attributes, mirroring lucide's own `defaultAttributes` minus the
 * stroke: same viewBox and default size, so a solid icon is a drop-in
 * replacement for the outline it stands in for.
 */
const BASE = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  width: 24,
  height: 24,
  fill: 'currentColor',
} as const;

/**
 * Solid counterpart of lucide's `Calendar`.
 *
 * The body is filled and the header rule is cut back out of it, which is what
 * keeps it reading as a calendar rather than as a rounded square. The two
 * hangers stay strokes: they sit above the body, where there is nothing to fill.
 */
export function CalendarSolid(props: SolidIconProps): ReactElement {
  return (
    <svg {...BASE} {...props}>
      <path
        d="M8 1.5a1 1 0 0 1 1 1V4H7V2.5a1 1 0 0 1 1-1Zm8 0a1 1 0 0 1 1 1V4h-2V2.5a1 1 0 0 1 1-1Z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm-2 5.25h18v1.5H3v-1.5Z"
      />
    </svg>
  );
}

/**
 * Solid counterpart of lucide's `Home` (which re-exports `House`).
 *
 * Same roofline and body as the outline; the door is cut out of the fill, so
 * the silhouette still says "house" and not "pentagon".
 */
export function HouseSolid(props: SolidIconProps): ReactElement {
  return (
    <svg {...BASE} {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V10Zm6 11v-7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7H9Z"
      />
    </svg>
  );
}

/**
 * Solid counterpart of lucide's `Users`.
 *
 * Two heads and two shoulder shapes rather than one merged blob: the second
 * person is drawn slightly smaller and behind, which is how the outline reads
 * the pair and the only way the filled version stays countable at 20px.
 */
export function UsersSolid(props: SolidIconProps): ReactElement {
  return (
    <svg {...BASE} {...props}>
      <circle cx="17" cy="7.5" r="3.25" />
      <path d="M17.75 14.5a4.75 4.75 0 0 1 4.25 4.72V21h-4v-2a5.9 5.9 0 0 0-1.62-4.06 5.4 5.4 0 0 0-.38-.37v-.07h1.75Z" />
      <circle cx="9" cy="7" r="4" />
      <path d="M6 15h6a4 4 0 0 1 4 4v2H2v-2a4 4 0 0 1 4-4Z" />
    </svg>
  );
}

/**
 * Solid counterpart of lucide's `Wallet`.
 *
 * The flap sits above a filled body, and the card slot on the right is cut out
 * of the fill with the clasp drawn back inside it — the one detail that
 * separates this silhouette from a plain rounded rectangle.
 */
export function WalletSolid(props: SolidIconProps): ReactElement {
  return (
    <svg {...BASE} {...props}>
      <path d="M5 3h13a1 1 0 0 1 1 1v3H5a2 2 0 0 1 0-4Z" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3 7.24A3.99 3.99 0 0 0 5 8h15a1 1 0 0 1 1 1v3h-3a2 2 0 0 0 0 4h3v3a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V7.24ZM18.5 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
      />
    </svg>
  );
}
