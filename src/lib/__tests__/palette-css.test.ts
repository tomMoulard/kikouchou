/**
 * @fileoverview Keeps `index.css` and `lib/palette` in agreement.
 *
 * A palette's light block and its dark block must declare the same custom
 * properties. The light block is `[data-palette="x"]` and matches `<html>` in
 * both modes, so a token only it sets would paint its light value in dark mode
 * and nothing in the browser would say so.
 *
 * @module lib/__tests__/palette-css.test
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PALETTES } from '@/lib/palette';

const CSS = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

/**
 * Collects the custom properties declared in the block whose selector list
 * starts with `selector`.
 *
 * @param selector - The first selector of the block, exactly as written
 * @returns The declared property names, sorted, or `undefined` when absent
 */
function declaredProperties(selector: string): string[] | undefined {
  const start = CSS.indexOf(`\n${selector}`);

  if (start === -1) {
    return undefined;
  }

  const open = CSS.indexOf('{', start),
    close = CSS.indexOf('}', open),
    body = CSS.slice(open + 1, close);

  return [...body.matchAll(/^\s*(--[\w-]+):/gm)]
    .map((match) => match[1] ?? '')
    .sort();
}

describe('palette tokens in index.css', () => {
  const custom = PALETTES.filter((palette) => palette !== 'default');

  it.each(custom)('declares a light and a dark block for %s', (palette) => {
    expect(declaredProperties(`[data-palette="${palette}"] {`)).toBeDefined();
    expect(declaredProperties(`.dark[data-palette="${palette}"],`)).toBeDefined();
    expect(CSS).toContain(`.dark [data-palette="${palette}"] {`);
  });

  it.each(custom)('declares the same tokens in both modes for %s', (palette) => {
    expect(declaredProperties(`.dark[data-palette="${palette}"],`)).toEqual(
      declaredProperties(`[data-palette="${palette}"] {`),
    );
  });

  it('declares the same tokens in every palette', () => {
    const reference = declaredProperties('[data-palette="ocean"] {');

    for (const palette of custom) {
      expect(declaredProperties(`[data-palette="${palette}"] {`)).toEqual(
        reference,
      );
    }
  });

  it('leaves the status tokens to the base theme', () => {
    const tokens = declaredProperties('[data-palette="ocean"] {') ?? [];

    expect(
      tokens.filter((token) =>
        /^--(success|warning|departure|destructive)/.test(token),
      ),
    ).toEqual([]);
  });

  it('lets a nested swatch show the default palette', () => {
    expect(CSS).toContain(':root,\n[data-palette="default"] {');
    expect(CSS).toContain('.dark,\n.dark [data-palette="default"] {');
  });
});
