/**
 * Tests for guest colour selection.
 *
 * Two properties matter and they pull against each other: never repeat a colour
 * while the palette has spare ones, and do not hand them out in a fixed order.
 * The second is what makes this worth a test — a deterministic "next free
 * swatch" implementation satisfies every no-duplicates assertion and is still
 * wrong.
 *
 * @module lib/utils/__tests__/guest-colors.test
 */
import { describe, expect, it, vi } from 'vitest';

import { pickRandomUnusedColor } from '@/lib/utils/guest-colors';

const PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e'] as const;

describe('pickRandomUnusedColor', () => {
  it('never returns a colour already in use', () => {
    const used = new Set([PALETTE[0], PALETTE[1], PALETTE[2]]);

    // Every draw, not one: a random pick that is usually right is still a bug.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(pickRandomUnusedColor({ usedColors: used, palette: [...PALETTE] })).toBe(
        PALETTE[3],
      );
    }
  });

  it('compares case-insensitively', () => {
    const used = new Set(['#EF4444', '#F97316', '#EAB308']);

    expect(pickRandomUnusedColor({ usedColors: used, palette: [...PALETTE] })).toBe(
      PALETTE[3],
    );
  });

  it('spreads across the unused colours rather than walking the palette', () => {
    const seen = new Set<string>();

    for (let attempt = 0; attempt < 200; attempt += 1) {
      seen.add(pickRandomUnusedColor({ usedColors: new Set(), palette: [...PALETTE] }));
    }

    // The bug this replaces always answered '#ef4444' here, so every group ever
    // created began red, orange, yellow, green in that order.
    expect(seen.size).toBe(PALETTE.length);
  });

  it('reuses the palette once every colour is taken', () => {
    const used = new Set(PALETTE);

    // A repeat beats refusing to create the guest at all.
    expect(PALETTE).toContain(
      pickRandomUnusedColor({ usedColors: used, palette: [...PALETTE] }),
    );
  });

  it('falls back to a usable colour for an empty palette', () => {
    expect(pickRandomUnusedColor({ usedColors: new Set(), palette: [] })).toMatch(
      /^#[0-9a-f]{6}$/i,
    );
  });

  it('picks from the unused set, not the whole palette', () => {
    // `Math.random()` at its maximum would index the last entry of whichever
    // array is drawn from; the assertion says which array that is.
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const used = new Set([PALETTE[0], PALETTE[1]]);

    expect(pickRandomUnusedColor({ usedColors: used, palette: [...PALETTE] })).toBe(
      PALETTE[3],
    );

    random.mockRestore();
  });
});
