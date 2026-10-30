/**
 * @fileoverview The solid twins the bottom bar draws for its current tab.
 *
 * Loaded inside the test: the shared SVG attributes are a load-time constant,
 * and Stryker can only test a mutant in load-time code against the test that
 * was running when the module loaded.
 *
 * @module components/shared/__tests__/nav-icons.test
 */

import { describe, expect, it } from 'vitest';

import { render } from '@/test/utils';

describe('solid nav icons', () => {
  it('draws each twin filled on lucide\'s grid, with its own shapes, and passes props through', async () => {
    const { CalendarSolid, HouseSolid, UsersSolid, WalletSolid } = await import('../nav-icons');
    const icons = [
      [CalendarSolid, 2],
      [HouseSolid, 1],
      [UsersSolid, 4],
      [WalletSolid, 2],
    ] as const;

    for (const [Icon, shapes] of icons) {
      const { container, unmount } = render(<Icon className="probe" aria-hidden="true" />, {
        withProviders: false,
      });
      const svg = container.querySelector('svg') as SVGElement;
      expect(svg.getAttribute('viewBox'), Icon.name).toBe('0 0 24 24');
      expect(svg.getAttribute('width')).toBe('24');
      expect(svg.getAttribute('height')).toBe('24');
      expect(svg.getAttribute('fill')).toBe('currentColor');
      expect(svg.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
      expect(svg).toHaveClass('probe');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg.children, Icon.name).toHaveLength(shapes);
      unmount();
    }
  });
});
