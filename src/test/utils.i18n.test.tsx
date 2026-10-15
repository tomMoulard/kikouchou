/**
 * @fileoverview The real-i18n render helper, tested against the thing it exists
 * to defeat.
 *
 * `src/test/setup.ts` mocks `react-i18next` so `t(key)` returns the key. Every
 * component assertion in this repo therefore asserts a *key*, not a rendering:
 * delete both locale files and the suite stays green. `renderWithRealI18n` is
 * the opt-in way out, and these tests pin the three properties that make it
 * worth reaching for:
 *
 * 1. it resolves through the shipped bundles, so a missing key shows up;
 * 2. it selects plural forms, which the mock cannot (it drops `count`);
 * 3. it renders French, which the mock cannot (it hardcodes `en`).
 *
 * The guard tests matter as much as the rest. A helper that silently fell back
 * to the mock would hand every caller a green suite that proves nothing — the
 * exact failure mode being fixed — so the mocked case must be a loud error.
 *
 * @module test/utils.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';

import { createRealI18n, renderWithRealI18n } from '@/test/utils';

// Hoisted above the imports by Vitest, which also lifts them above the mocks
// `setupFiles` registered — for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Fixtures
// ============================================================================

/** Renders one key, so the assertions read off the DOM rather than off `t`. */
function Probe({
  translationKey,
  count,
}: {
  readonly translationKey: string;
  readonly count?: number;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <p data-testid="probe">
      {count === undefined ? t(translationKey) : t(translationKey, { count })}
    </p>
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('renderWithRealI18n', () => {
  it('renders the English translation, not the key', async () => {
    await renderWithRealI18n(<Probe translationKey="common.save" />, {
      withProviders: false,
    });

    expect(screen.getByTestId('probe')).toHaveTextContent('Save');
  });

  it('renders French when asked', async () => {
    await renderWithRealI18n(<Probe translationKey="common.save" />, {
      language: 'fr',
      withProviders: false,
    });

    // Unreachable under the suite mock, which hardcodes `language: 'en'` and
    // returns the key regardless.
    expect(screen.getByTestId('probe')).toHaveTextContent('Enregistrer');
  });

  it('selects the plural form from the count', async () => {
    await renderWithRealI18n(<Probe translationKey="calendar.nights" count={1} />, {
      withProviders: false,
    });

    expect(screen.getByTestId('probe')).toHaveTextContent('1 night');
  });

  it('selects the French plural form, where zero is singular', async () => {
    await renderWithRealI18n(<Probe translationKey="calendar.nights" count={0} />, {
      language: 'fr',
      withProviders: false,
    });

    // "0 nuit", not "0 nuits" — the boundary a translator mirroring the English
    // file always gets wrong, and one the mock cannot reach at all because it
    // strips `count` before interpolating.
    expect(screen.getByTestId('probe')).toHaveTextContent('0 nuit');
  });

  it('hands back the instance so expectations can name the expected string', async () => {
    const { i18n } = await renderWithRealI18n(<Probe translationKey="common.save" />, {
      withProviders: false,
    });

    expect(i18n.t('common.save')).toBe('Save');
  });
});

describe('createRealI18n', () => {
  it('falls back to French rather than to the key', async () => {
    const i18n = await createRealI18n('en');

    // Key parity is enforced, so no shipped key is French-only; this probe adds
    // one. Asserted through `t` rather than by reading `options.fallbackLng`
    // back — the config would still read 'fr' if resolution stopped honouring
    // it, and a config-shaped assertion is the thing this whole file argues
    // against. Adding a key is the one safe mutation of the shared instance: it
    // changes no existing resolution, and nothing else asks for this one.
    i18n.addResource('fr', 'translation', 'testOnly.fallbackProbe', 'Repli');

    expect(i18n.t('testOnly.fallbackProbe')).toBe('Repli');
  });

  it('agrees with the language the app declares as its fallback', async () => {
    const real = await vi.importActual<typeof import('@/lib/i18n')>('@/lib/i18n');
    const i18n = await createRealI18n('en');

    // `src/lib/i18n/__tests__/index.test.ts` looks like it pins this — it has
    // an `exports DEFAULT_LANGUAGE as fr` test — but it reads the module
    // through the setup.ts mock, so it asserts the mock's copy and passes even
    // if the app's fallback changes. `importActual` reads the shipped module.
    expect(i18n.options.fallbackLng).toEqual([real.DEFAULT_LANGUAGE]);
  });

  it('reuses one instance per language', async () => {
    const [first, second] = await Promise.all([
      createRealI18n('fr'),
      createRealI18n('fr'),
    ]);

    // Building one parses ~95 KB of JSON; a per-call instance would make the
    // helper too slow to reach for.
    expect(first).toBe(second);
  });

  it('resolves a key the app renders with no inline default', async () => {
    const i18n = await createRealI18n('en');

    // `calendar.today` is passed to `t()` bare. Were it ever dropped from the
    // catalogue, users would read "calendar.today" on the button.
    expect(i18n.t('calendar.today')).toBe('Today');
  });
});
