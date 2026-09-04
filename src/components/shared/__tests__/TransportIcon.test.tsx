/**
 * @fileoverview Tests for the TransportIcon component.
 *
 * The point of this component is the mode → icon mapping, so that is what these
 * assert. `it.each(modes)` with `expect(svg).toBeInTheDocument()` used to stand
 * in for it, which passed just as happily with every mode drawing a plane —
 * exactly the failure the three divergent icon maps caused before they were
 * consolidated into `lib/utils/transport-icons`.
 *
 * The expected shape comes from rendering the lucide icon the test names
 * itself, not from re-reading the production map: a test that asks the map what
 * it contains cannot notice the map being wrong. Comparing the drawn markup
 * (rather than a `lucide-*` class) also survives a lucide upgrade renaming its
 * classes, while still failing the moment two modes are swapped.
 *
 * @module components/shared/__tests__/TransportIcon.test
 */

import { describe, expect, it } from 'vitest';
import { render } from '@/test/utils';
import { Bus, Car, CircleDot, Plane, Train } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { TransportIcon } from '@/components/shared/TransportIcon';
import type { TransportMode } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

/** The paths a lucide icon draws, independent of the classes it is given. */
function shapeOf(Icon: LucideIcon): string {
  const { container, unmount } = render(<Icon />, { withProviders: false });
  const markup = container.querySelector('svg')?.innerHTML ?? '';
  unmount();
  return markup;
}

/** The paths `TransportIcon` drew for a mode. */
function renderedShapeFor(mode: TransportMode): string {
  const { container, unmount } = render(<TransportIcon mode={mode} />, {
    withProviders: false,
  });
  const markup = container.querySelector('svg')?.innerHTML ?? '';
  unmount();
  return markup;
}

/**
 * Each mode and the icon it must draw.
 *
 * `Train` is lucide's alias for `TramFront`; naming it the way the app does
 * keeps this table readable against `transport-icons.ts`.
 */
const MODE_ICONS: ReadonlyArray<readonly [TransportMode, string, LucideIcon]> = [
  ['plane', 'Plane', Plane],
  ['train', 'Train', Train],
  ['car', 'Car', Car],
  ['bus', 'Bus', Bus],
  ['other', 'CircleDot', CircleDot],
];

// ============================================================================
// Tests
// ============================================================================

describe('TransportIcon mode mapping', () => {
  it.each(MODE_ICONS)('draws %s as the %s icon', (mode, _name, Icon) => {
    expect(renderedShapeFor(mode)).toBe(shapeOf(Icon));
  });

  it('draws a different shape for every mode', () => {
    // Guards the whole table at once: if the fallback swallowed a mode, or two
    // entries collapsed onto one icon, the set shrinks.
    const shapes = new Set(MODE_ICONS.map(([mode]) => renderedShapeFor(mode)));
    expect(shapes.size).toBe(MODE_ICONS.length);
  });

  it('falls back to the shared "other" icon for an unknown mode', () => {
    // A row written by a build that knew a mode this one does not. The fallback
    // is `CircleDot` specifically — a person reads a `User` glyph as "on foot"
    // and a pin as "a place", neither of which is what "other" means.
    expect(renderedShapeFor('ferry' as TransportMode)).toBe(shapeOf(CircleDot));
  });
});

describe('TransportIcon presentation', () => {
  it('defaults to aria-hidden when no aria-label is provided', () => {
    const { container } = render(<TransportIcon mode="train" />, { withProviders: false });
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('is not aria-hidden when aria-label is provided', () => {
    const { container } = render(
      <TransportIcon mode="plane" aria-label="Airplane" />,
      { withProviders: false },
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-label', 'Airplane');
    expect(svg).not.toHaveAttribute('aria-hidden', 'true');
  });

  it('applies additional className', () => {
    const { container } = render(
      // eslint-disable-next-line kikouchou/no-raw-palette-class -- An arbitrary caller class, asserted below to reach the <svg>. Its job is to be recognisable in the output, not to style anything.
      <TransportIcon mode="car" className="size-8 text-red-500" />,
      { withProviders: false },
    );
    const svg = container.querySelector('svg');
    // eslint-disable-next-line kikouchou/no-raw-palette-class -- The other half of the fixture above.
    expect(svg?.className.baseVal ?? svg?.getAttribute('class') ?? '').toContain('text-red-500');
  });

  it('always includes the default size class', () => {
    const { container } = render(<TransportIcon mode="bus" />, { withProviders: false });
    const svg = container.querySelector('svg');
    const classes = svg?.className.baseVal ?? svg?.getAttribute('class') ?? '';
    expect(classes).toContain('shrink-0');
  });

  it('lets a call site override the size, so a bigger icon is not overruled', () => {
    // `cn()` merges through tailwind-merge; `size-4` first and `size-8` last
    // means the call site wins. Written as a plain string concat it would not.
    const { container } = render(
      <TransportIcon mode="bus" className="size-8" />,
      { withProviders: false },
    );
    const classes =
      container.querySelector('svg')?.getAttribute('class') ?? '';
    expect(classes).toContain('size-8');
    expect(classes).not.toMatch(/(^|\s)size-4(\s|$)/);
  });
});
