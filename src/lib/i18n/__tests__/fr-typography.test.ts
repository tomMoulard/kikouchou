/**
 * @fileoverview French typography in the French bundle.
 *
 * French puts a space before `?`, `!`, `:` and `;`, and inside « ». With an
 * ordinary space the line can break there, and a tester met a "?" alone at
 * the end of a line and a line starting with ":" while creating a trip. The
 * space must be one that does not break: U+202F before `?`, `!` and `;`,
 * U+00A0 before `:` and inside the guillemets.
 *
 * @module lib/i18n/__tests__/fr-typography.test
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ============================================================================
// Constants
// ============================================================================

const FR_PATH = join(resolve(process.cwd(), 'src'), 'locales/fr/translation.json');

/** An ordinary space where the line must not break. */
const BREAKABLE_SPACE = / [?!:;]|« | »/u;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Every string of a locale tree, with its dotted key.
 *
 * @param node - A subtree of the bundle
 * @param path - The key of that subtree
 * @returns The leaves, as `[key, value]` pairs
 */
function leaves(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') {
    return [[path, node]];
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      leaves(value, path === '' ? key : `${path}.${key}`),
    );
  }
  return [];
}

// ============================================================================
// Tests
// ============================================================================

describe('French typography', () => {
  it('never lets a line break before ? ! : ; or inside « »', () => {
    const bundle: unknown = JSON.parse(readFileSync(FR_PATH, 'utf8'));
    const offenders = leaves(bundle)
      .filter(([, value]) => BREAKABLE_SPACE.test(value))
      .map(([key, value]) => `${key}: ${value}`);

    expect(offenders).toEqual([]);
  });
});
