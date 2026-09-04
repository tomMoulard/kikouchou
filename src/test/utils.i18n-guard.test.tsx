/**
 * @fileoverview The real-i18n helper must refuse to run under the suite mock,
 * and must agree with that mock about which language the suite renders in.
 *
 * `vi.mock` and `vi.unmock` are per test file, so no helper can unmock on its
 * caller's behalf — a file that forgets `vi.unmock('react-i18next')` gets the
 * key-returning mock back. If `renderWithRealI18n` quietly rendered through it,
 * every assertion in that file would be back to asserting keys while *looking*
 * like it asserted prose: worse than not having the helper at all.
 *
 * This file is the mocked case, deliberately kept apart from
 * `utils.i18n.test.tsx` because the two need opposite module registries. It
 * unmocks nothing, which is also what lets it read the mock's own values and
 * compare them with the helper's.
 *
 * @module test/utils.i18n-guard.test
 */

import { describe, expect, it } from 'vitest';
import { useTranslation } from 'react-i18next';

import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from '@/lib/i18n';
import {
  DEFAULT_TEST_LANGUAGE,
  FALLBACK_TEST_LANGUAGE,
  createRealI18n,
  renderWithRealI18n,
} from '@/test/utils';

describe('renderWithRealI18n under the suite-wide i18n mock', () => {
  it('refuses to render and names the fix', async () => {
    await expect(renderWithRealI18n(<span />)).rejects.toThrow(
      /still mocked in this test file.*vi\.unmock/s,
    );
  });

  it('refuses to build an instance too', async () => {
    await expect(createRealI18n('fr')).rejects.toThrow(/vi\.unmock\('i18next'\)/);
  });
});

describe('the helper and the suite mock agree', () => {
  it('renders in the language the mock reports as active', () => {
    // `src/test/setup.ts` and `src/test/utils.tsx` each name this language, and
    // only this assertion couples them. Were they to drift, converting a file
    // to renderWithRealI18n would silently change which language it asserts —
    // the one thing the conversion is supposed to leave alone.
    const { i18n } = useTranslation();

    expect(i18n.language).toBe(DEFAULT_TEST_LANGUAGE);
  });

  it('falls back to the language the app declares as its default', () => {
    // Read here through the `@/lib/i18n` mock, which mirrors the real export.
    expect(DEFAULT_LANGUAGE).toBe(FALLBACK_TEST_LANGUAGE);
  });

  it('covers every language the app claims to support', () => {
    // A language the helper has no bundle for would resolve through the
    // fallback and read like a translation, so the two lists have to match.
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual(
      [DEFAULT_TEST_LANGUAGE, FALLBACK_TEST_LANGUAGE].sort(),
    );
  });
});
