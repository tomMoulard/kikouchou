/**
 * @fileoverview Counted strings must agree with the language they render in.
 *
 * Plural bugs in this app are silent. i18next never throws for a missing plural
 * form: it quietly falls back to the unsuffixed key, or to whatever inline
 * `defaultValue` the call site happened to pass. So "3 nuitss", "1 people
 * online" and "{{count}} transport(s) added" all render happily, and only a
 * human reading the screen in the right language ever notices.
 *
 * Two traps this file exists to catch:
 *
 * 1. **The v3 `_plural` suffix.** The app runs JSON v4 (no `compatibilityJSON`),
 *    where the categories are `_one` / `_other`. A `_plural` key is unreachable,
 *    so the singular wins at every count and nothing reports it.
 * 2. **French is not English.** French puts 0 in the `one` category — "0 nuit",
 *    not "0 nuits" — so a French file that mirrors the English boundaries is
 *    wrong at exactly one count, and it is the count most demos never reach.
 *
 * `src/test/setup.ts` mocks `react-i18next` and `i18next` so component tests see
 * translation keys rather than prose. A mocked `t` cannot select a plural form,
 * which is the entire subject here — hence the `vi.unmock` below and a real
 * instance built from the shipped resource files.
 *
 * @module lib/i18n/__tests__/plurals.test
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { i18n as I18n } from 'i18next';

import enTranslation from '@/locales/en/translation.json';
import frTranslation from '@/locales/fr/translation.json';

// Hoisted above the imports by Vitest, so it also lifts the mock that
// `setupFiles` registered for the whole suite — for this file only.
vi.unmock('i18next');

// ============================================================================
// Fixtures
// ============================================================================

interface PluralCase {
  /** Dotted translation key, without any plural suffix. */
  readonly key: string;
  /** Expected English rendering at counts 0, 1 and 2, in that order. */
  readonly en: readonly [string, string, string];
  /** Expected French rendering at counts 0, 1 and 2, in that order. */
  readonly fr: readonly [string, string, string];
}

/**
 * One representative counted string per place the app got plurals wrong.
 *
 * The French column is the point of the table: every row disagrees with the
 * English column at count 0.
 */
const PLURAL_CASES: readonly PluralCase[] = [
  {
    // Was `nights` / `nights_plural` — the v3 suffix — plus a literal 's'
    // appended in EventDetailDialog's JSX, which produced "3 nuitss" in French.
    key: 'calendar.nights',
    en: ['0 nights', '1 night', '2 nights'],
    fr: ['0 nuit', '1 nuit', '2 nuits'],
  },
  {
    key: 'calendar.moreItemsHidden',
    en: [
      '0 more items in this day',
      '1 more item in this day',
      '2 more items in this day',
    ],
    fr: [
      '0 autre élément dans cette journée',
      '1 autre élément dans cette journée',
      '2 autres éléments dans cette journée',
    ],
  },
  {
    // SyncStatusBadge routes counts of 1 or fewer to `nav.syncOnlineJustYou`,
    // so today only the `_other` form reaches a screen. The singular is still
    // the bundle's job to carry: a catalogue that is only correct because of a
    // guard at one call site breaks the moment that guard moves.
    key: 'nav.syncOnlineCount',
    en: ['0 people online', '1 person online', '2 people online'],
    fr: ['0 personne en ligne', '1 personne en ligne', '2 personnes en ligne'],
  },
  {
    // The shipped key and SyncStatusBadge's inline default used to say
    // different things; whichever won, the other was dead and misleading.
    key: 'nav.syncPending',
    en: ['0 changes not sent yet', '1 change not sent yet', '2 changes not sent yet'],
    fr: [
      '0 modification pas encore envoyée',
      '1 modification pas encore envoyée',
      '2 modifications pas encore envoyées',
    ],
  },
  {
    // Was string surgery: `${arrivals.length} ${t('transports.arrivals').toLowerCase()}`.
    key: 'transports.arrivalsCount',
    en: ['0 arrivals', '1 arrival', '2 arrivals'],
    fr: ['0 arrivée', '1 arrivée', '2 arrivées'],
  },
  {
    key: 'transports.departuresCount',
    en: ['0 departures', '1 departure', '2 departures'],
    fr: ['0 départ', '1 départ', '2 départs'],
  },
  {
    key: 'activities.participantCount',
    en: ['0 participants', '1 participant', '2 participants'],
    fr: ['0 participant', '1 participant', '2 participants'],
  },
  {
    // Was "{{count}} room allocation(s) optimized automatically".
    key: 'rooms.autoAssignSuccess',
    en: [
      '0 room allocations optimized automatically',
      '1 room allocation optimized automatically',
      '2 room allocations optimized automatically',
    ],
    fr: [
      '0 attribution optimisée automatiquement',
      '1 attribution optimisée automatiquement',
      '2 attributions optimisées automatiquement',
    ],
  },
  {
    key: 'sharing.sync.conflictCount',
    en: ['0 conflicts to resolve', '1 conflict to resolve', '2 conflicts to resolve'],
    fr: ['0 conflit à résoudre', '1 conflit à résoudre', '2 conflits à résoudre'],
  },
  {
    // Was "Synced with {{count}} peer(s)".
    key: 'sharing.p2p.syncedWithPeers',
    en: ['Synced with 0 peers', 'Synced with 1 peer', 'Synced with 2 peers'],
    fr: [
      'Synchronisé avec 0 pair',
      'Synchronisé avec 1 pair',
      'Synchronisé avec 2 pairs',
    ],
  },
  {
    key: 'sharing.transportEnteredCount',
    en: ['0 transports added', '1 transport added', '2 transports added'],
    fr: ['0 transport ajouté', '1 transport ajouté', '2 transports ajoutés'],
  },
  {
    key: 'map.tilesCount',
    en: ['0 tiles', '1 tile', '2 tiles'],
    fr: ['0 tuile', '1 tuile', '2 tuiles'],
  },
];

/** One row per (key, count): 0 and 2 share a form in English, 0 and 1 in French. */
const EXPECTATIONS = PLURAL_CASES.flatMap((testCase) => [
  { key: testCase.key, count: 0, en: testCase.en[0], fr: testCase.fr[0] },
  { key: testCase.key, count: 1, en: testCase.en[1], fr: testCase.fr[1] },
  { key: testCase.key, count: 2, en: testCase.en[2], fr: testCase.fr[2] },
]);

/**
 * Every counted key converted to v4 plural forms, including the ones with no
 * call site interesting enough to earn a row in {@link PLURAL_CASES}.
 *
 * Keys carrying the same bug but owned by other work in flight — `rooms.beds`,
 * `transports.locationsCount`, `map.markerCount` — are deliberately absent.
 */
const CONVERTED_KEYS: readonly string[] = [
  'assignments.showMore',
  'upcomingPickups.showMore',
  'sharing.sync.autoApplyCount',
  'sharing.sync.warningCount',
  'sharing.sync.mergeSuccess',
  'rooms.autoAssignPartial',
  'sharing.p2p.syncingWithPeers',
  ...PLURAL_CASES.map((testCase) => testCase.key),
];

/** "transport(s)", "optimisée(s)", "ami(e)" — the plural machinery bypassed by hand. */
const MANUAL_PLURAL_SUFFIX = /\([sxe]s?\)/;

const BUNDLES = [
  { language: 'en', translations: enTranslation as unknown as Record<string, unknown> },
  { language: 'fr', translations: frTranslation as unknown as Record<string, unknown> },
] as const;

// ============================================================================
// Helpers
// ============================================================================

/** Reads a dotted path out of a parsed translation file. */
function lookup(bundle: Record<string, unknown>, path: string): unknown {
  let current: unknown = bundle;

  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/** Same, reporting a missing or non-string value as the empty string. */
function readString(bundle: Record<string, unknown>, path: string): string {
  const value = lookup(bundle, path);

  return typeof value === 'string' ? value : '';
}

// ============================================================================
// Tests
// ============================================================================

describe('counted translations', () => {
  let i18n: I18n;

  beforeAll(async () => {
    const { createInstance } = await import('i18next');

    i18n = createInstance();
    await i18n.init({
      // Mirrors src/lib/i18n: French is the fallback, JSON v4 plurals (no
      // `compatibilityJSON`), both bundles from the files the app ships.
      lng: 'en',
      fallbackLng: 'fr',
      supportedLngs: ['en', 'fr'],
      resources: {
        en: { translation: enTranslation },
        fr: { translation: frTranslation },
      },
      interpolation: { escapeValue: false },
    });
  });

  it('runs against the real i18next, not the suite-wide mock', () => {
    // Guards the vi.unmock above: were the mock to leak back in, `t` would echo
    // the key and every assertion below would be testing the mock.
    expect(i18n.getFixedT('en')('common.save')).toBe('Save');
    expect(i18n.getFixedT('fr')('common.save')).toBe('Enregistrer');
  });

  it.each(EXPECTATIONS)('$key at count $count reads "$en" / "$fr"', (expectation) => {
    expect(i18n.getFixedT('en')(expectation.key, { count: expectation.count })).toBe(
      expectation.en,
    );
    expect(i18n.getFixedT('fr')(expectation.key, { count: expectation.count })).toBe(
      expectation.fr,
    );
  });

  it('puts zero in the singular in French and the plural in English', () => {
    // The one boundary a translator mirroring the English file always gets
    // wrong. Called out on its own so a failure names the reason.
    expect(i18n.getFixedT('fr')('calendar.nights', { count: 0 })).toBe('0 nuit');
    expect(i18n.getFixedT('en')('calendar.nights', { count: 0 })).toBe('0 nights');
  });

  describe.each(BUNDLES)('$language bundle', ({ translations }) => {
    it.each(CONVERTED_KEYS)('%s spells both v4 plural forms out', (key) => {
      const one = readString(translations, `${key}_one`);
      const other = readString(translations, `${key}_other`);

      expect(one).not.toBe('');
      expect(other).not.toBe('');
      expect(one).not.toMatch(MANUAL_PLURAL_SUFFIX);
      expect(other).not.toMatch(MANUAL_PLURAL_SUFFIX);
    });

    it.each(CONVERTED_KEYS)('%s carries no unreachable v3 _plural key', (key) => {
      expect(lookup(translations, `${key}_plural`)).toBeUndefined();
    });
  });
});
