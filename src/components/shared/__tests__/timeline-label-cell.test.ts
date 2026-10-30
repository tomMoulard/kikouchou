/**
 * @fileoverview The sizing every sticky timeline label cell shares.
 *
 * The frame writes the two custom properties and every label cell reads them,
 * so the names on both sides have to agree to the letter.
 *
 * Imported inside the test: these are load-time constants, and Stryker can
 * only test a mutant in load-time code against the test that was running when
 * the module loaded.
 *
 * @module components/shared/__tests__/timeline-label-cell.test
 */

import { describe, expect, it } from 'vitest';

describe('timeline label cell', () => {
  it('names the two custom properties, and sizes a cell to the current width in a slot of the open width', async () => {
    const { TIMELINE_LABEL_CELL_STYLE, TIMELINE_LABEL_EXPANDED_VAR, TIMELINE_LABEL_WIDTH_VAR } =
      await import('../timeline-label-cell');

    expect(TIMELINE_LABEL_WIDTH_VAR).toBe('--timeline-label-width');
    expect(TIMELINE_LABEL_EXPANDED_VAR).toBe('--timeline-label-expanded');
    expect(TIMELINE_LABEL_CELL_STYLE).toEqual({
      width: 'var(--timeline-label-width)',
      minWidth: 'var(--timeline-label-width)',
      marginRight: 'calc(var(--timeline-label-expanded) - var(--timeline-label-width))',
    });
  });
});
