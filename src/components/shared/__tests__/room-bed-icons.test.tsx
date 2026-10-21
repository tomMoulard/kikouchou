/**
 * @fileoverview The two bed icons lucide does not ship.
 *
 * Each is a list of paths on lucide's 24px grid. A dropped or emptied path
 * still renders an icon, only the wrong one, so the drawing is pinned path by
 * path.
 *
 * The module is imported inside the test rather than at the top of the file:
 * the icons are built when the module loads, and Stryker can only test a
 * mutant in load-time code against the test that was running when it loaded.
 *
 * @module components/shared/__tests__/room-bed-icons.test
 */

import { describe, expect, it } from 'vitest';
// Straight from RTL rather than `@/test/utils`: the helper module pulls in the
// app's providers, and anything among them that loads these icons would load
// them before the test runs, which is what this file is arranged to avoid.
import { render } from '@testing-library/react';

/** The `d` of every path the icon drew, in order. */
function pathsOf(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('svg path')].map((path) => path.getAttribute('d'));
}

describe('room bed icons', () => {
  it('draws a twin room as two single beds and a bunk bed as two bunks between shared posts', async () => {
    const { BedBunk, BedTwin } = await import('../room-bed-icons');

    const twin = render(<BedTwin />);
    expect(twin.container.querySelector('svg')).toHaveClass('lucide-bed-twin');
    expect(pathsOf(twin.container)).toEqual([
      'M2 20v-7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v7',
      'M3 11V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4',
      'M2 18h8',
      'M14 20v-7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v7',
      'M15 11V7a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v4',
      'M14 18h8',
    ]);

    const bunk = render(<BedBunk />);
    expect(bunk.container.querySelector('svg')).toHaveClass('lucide-bed-bunk');
    expect(pathsOf(bunk.container)).toEqual([
      'M3 2v20',
      'M21 2v20',
      'M3 10h18',
      'M3 19h18',
      'M3 6h5a2 2 0 0 1 2 2v2',
      'M3 15h5a2 2 0 0 1 2 2v2',
    ]);
  });
});
