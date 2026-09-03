/**
 * @fileoverview The real-i18n helper must refuse to run under the suite mock.
 *
 * `vi.mock` and `vi.unmock` are per test file, so no helper can unmock on its
 * caller's behalf — a file that forgets `vi.unmock('react-i18next')` gets the
 * key-returning mock back. If `renderWithRealI18n` quietly rendered through it,
 * every assertion in that file would be back to asserting keys while *looking*
 * like it asserted prose: worse than not having the helper at all.
 *
 * This file is the mocked case, deliberately kept apart from
 * `utils.i18n.test.tsx` because the two need opposite module registries. It
 * unmocks nothing.
 *
 * @module test/utils.i18n-guard.test
 */

import { describe, expect, it } from 'vitest';

import { createRealI18n, renderWithRealI18n } from '@/test/utils';

describe('renderWithRealI18n under the suite-wide i18n mock', () => {
  it('refuses to render and names the fix', async () => {
    await expect(renderWithRealI18n(<span />)).rejects.toThrow(
      /still mocked in this test file.*vi\.unmock/s,
    );
  });

  it('refuses to build an instance too', async () => {
    await expect(createRealI18n('fr')).rejects.toThrow(/vi\.unmock\('i18next'\)/);
  });

  it('reports the same failure on a second call rather than a stale rejection', async () => {
    // The per-language cache must not remember a rejected promise, or the
    // second caller sees an unrelated error.
    await expect(createRealI18n('en')).rejects.toThrow(/still mocked/);
    await expect(createRealI18n('en')).rejects.toThrow(/still mocked/);
  });
});
