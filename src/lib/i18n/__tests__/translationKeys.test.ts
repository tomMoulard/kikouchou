/**
 * @fileoverview Guard against silently untranslated UI.
 *
 * i18next never throws for a missing key: it renders the inline `defaultValue`
 * when one is passed, and otherwise the key itself. A key that exists in
 * neither `en` nor `fr` therefore looks perfectly fine in development (English
 * default) and ships French users English text forever — the exact class of bug
 * these tests exist to catch, and one that no amount of manual review has.
 *
 * The scan is deliberately a net, not a proof. It reads the source of `src/**`
 * and collects two kinds of candidate key:
 *
 * 1. the literal first argument of a `t(…)` / `i18n.t(…)` / `safeTranslate(…)`
 *    call, which also gives a call site to name in the failure message;
 * 2. any string literal shaped like a dotted key whose first segment is one of
 *    the bundle's namespaces. This catches the keys the app never writes inside
 *    a `t()` call — `Layout`'s `labelKey: 'nav.calendar'` nav table,
 *    `RoomIconPicker`'s `rooms.icons.*`, `ColorPicker`'s `colors.*` and the
 *    assistant's model catalogue all resolve their key through a variable.
 *
 * Keys assembled at runtime (`t(`transports.modes.${mode}`)`) cannot be
 * resolved statically, so their prefixes are listed in
 * {@link DYNAMIC_KEY_PREFIXES} and the parent object is checked instead.
 *
 * en/fr key-set parity is asserted by the sibling suite rather than duplicated
 * here.
 *
 * @see ./index.test.ts — "Key Synchronization"
 * @module lib/i18n/__tests__/translationKeys
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ============================================================================
// Constants
// ============================================================================

/**
 * Absolute path to `src/`. Vitest runs with the project root as the cwd
 * (`import.meta.url` is not a `file:` URL under Vite's transform).
 */
const SRC_DIR = resolve(process.cwd(), 'src'),

 EN_PATH = join(SRC_DIR, 'locales/en/translation.json'),
 FR_PATH = join(SRC_DIR, 'locales/fr/translation.json'),

 /**
  * Suffixes i18next appends when resolving a key with `{{count}}`.
  * A call site writes `t('persons.headcountBadge', { count })`; the locale file
  * holds `persons.headcountBadge_one` / `_other`.
  */
 PLURAL_SUFFIXES = ['_one', '_other', '_zero', '_two', '_few', '_many', '_plural'],

 /**
  * Prefixes of keys assembled at runtime from a template literal. Those cannot
  * be checked leaf-by-leaf, so the parent object is required to exist instead.
  */
 DYNAMIC_KEY_PREFIXES = [
   'activities.categories',
   'assistant.actionDetails.tripField',
   'childSeats',
   'settings.languages',
   'transports.modes',
 ],

 /**
  * Escape hatch for a dotted literal that merely happens to start with a
  * namespace name (an analytics event id, say) and is not a translation key.
  * Empty today; add here rather than weakening the scan.
  */
 ALLOWED_NON_KEYS = new Set<string>(),

 /**
  * Call sites that resolve a translation. `safeTranslate` is the
  * ErrorBoundary's guarded wrapper around `t`.
  *
  * The lookbehind stops `format(`, `.at(`, `expect(` and friends from being
  * read as a bare `t(`.
  */
 TRANSLATE_CALL = /(?:\bi18n\.t|\bsafeTranslate|(?<![\w$.])t)\(\s*(['"`])([^'"`]*)\1/g,

 /** Any single-line string literal. */
 STRING_LITERAL = /(['"`])([^'"`\n]*)\1/g,

 /** A statically resolvable key: dotted, no interpolation. */
 STATIC_KEY = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/;

// ============================================================================
// Helpers
// ============================================================================

/** Recursively collects every `.ts`/`.tsx` file under `dir`, skipping tests. */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  // withFileTypes avoids a stat() per entry, and cannot throw on a dangling
  // symlink the way statSync() does.
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Test files reference deliberately-missing keys ('nonexistent.key').
      if (entry.name === '__tests__' || entry.name === 'test') continue;
      collectSourceFiles(path, out);
    } else if (
      entry.isFile() &&
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Removes comments so JSDoc `@example` blocks are not mistaken for call sites.
 *
 * Both patterns are line-anchored, so a `'/*'` or `'//'` inside a string
 * literal — a glob, a URL — cannot swallow the code that follows it.
 */
function stripComments(source: string): string {
  return source
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Flattens a nested translation object into dotted leaf keys. */
function flattenKeys(
  value: unknown,
  prefix = '',
  out: Set<string> = new Set(),
): Set<string> {
  if (typeof value !== 'object' || value === null) return out;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'object' && child !== null) {
      flattenKeys(child, path, out);
    } else {
      out.add(path);
    }
  }
  return out;
}

/** Whether `key` resolves in `keys`, directly or via a plural suffix. */
function resolves(keys: ReadonlySet<string>, key: string): boolean {
  if (keys.has(key)) return true;
  return PLURAL_SUFFIXES.some((suffix) => keys.has(`${key}${suffix}`));
}

/** Reads the nested value at a dotted path, or `undefined`. */
function valueAt(bundle: unknown, path: string): unknown {
  let cursor: unknown = bundle;
  for (const segment of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

// ============================================================================
// Fixtures
// ============================================================================

const en: unknown = JSON.parse(readFileSync(EN_PATH, 'utf8')),
 fr: unknown = JSON.parse(readFileSync(FR_PATH, 'utf8')),
 enKeys = flattenKeys(en),
 frKeys = flattenKeys(fr),
 namespaces = new Set(Object.keys(en as Record<string, unknown>)),
 sourceFiles = collectSourceFiles(SRC_DIR),

 /** Every statically resolvable key, mapped to the files that reference it. */
 referencedKeys = ((): Map<string, Set<string>> => {
   const found = new Map<string, Set<string>>(),
    record = (key: string, file: string): void => {
      if (ALLOWED_NON_KEYS.has(key)) return;
      const sites = found.get(key);
      if (sites) sites.add(file);
      else found.set(key, new Set([file]));
    };

   for (const file of sourceFiles) {
     const source = stripComments(readFileSync(file, 'utf8')),
      relative = file.slice(SRC_DIR.length);
     let match: RegExpExecArray | null;

     // Pass 1: keys written straight into a t() call.
     TRANSLATE_CALL.lastIndex = 0;
     while ((match = TRANSLATE_CALL.exec(source)) !== null) {
       const key = match[2];
       if (key !== undefined && STATIC_KEY.test(key)) record(key, relative);
     }

     // Pass 2: keys held in a constant and resolved through a variable.
     STRING_LITERAL.lastIndex = 0;
     while ((match = STRING_LITERAL.exec(source)) !== null) {
       const key = match[2];
       if (key === undefined || !STATIC_KEY.test(key)) continue;
       const [namespace] = key.split('.');
       if (namespace !== undefined && namespaces.has(namespace)) {
         record(key, relative);
       }
     }
   }
   return found;
 })();

/** Formats the missing keys of a bundle as `key (file, file)` lines. */
function missingFrom(keys: ReadonlySet<string>): string[] {
  return [...referencedKeys.entries()]
    .filter(([key]) => !resolves(keys, key))
    .map(([key, sites]) => `${key} (${[...sites].join(', ')})`)
    .sort();
}

// ============================================================================
// Tests
// ============================================================================

describe('translation key references', () => {
  it('scans a realistic number of source files and call sites', () => {
    // Without this the suite below would pass vacuously if the walk, the
    // comment stripper or either regex ever silently stopped matching.
    expect(sourceFiles.length).toBeGreaterThan(100);
    expect(referencedKeys.size).toBeGreaterThan(600);
    expect(enKeys.size).toBeGreaterThan(600);
  });

  it('resolves every referenced key in the en bundle', () => {
    expect(missingFrom(enKeys)).toEqual([]);
  });

  it('resolves every referenced key in the fr bundle', () => {
    // fr is the fallback language: a key missing here renders as the raw key
    // (or the inline English default) for every user, not just French ones.
    expect(missingFrom(frKeys)).toEqual([]);
  });

  it('has a parent object for every runtime-built key prefix', () => {
    for (const prefix of DYNAMIC_KEY_PREFIXES) {
      for (const [language, bundle] of [
        ['en', en],
        ['fr', fr],
      ] as const) {
        const value = valueAt(bundle, prefix);
        expect(
          typeof value === 'object' && value !== null,
          `${language}: ${prefix} should be an object`,
        ).toBe(true);
        expect(
          Object.keys(value as Record<string, unknown>).length,
          `${language}: ${prefix} should not be empty`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
