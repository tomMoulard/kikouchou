/**
 * @fileoverview Tests for the project-local ESLint rules.
 *
 * A lint rule that cannot fail is worse than no rule: it reads like a guarantee
 * and provides none. These cases pin the two halves that matter — the shapes
 * the rule must reject, and the documented carve-outs it must let through — so
 * that a future edit to the regex or the visitor cannot quietly turn either
 * guard into decoration.
 *
 * @module test/eslint-rules.test
 */

/* eslint-disable kikouchou/no-raw-palette-class -- This file is the rule's own
   fixtures: every palette shade below is there to be rejected, and a test that
   could not name the thing it rejects would not be testing anything. */

import { RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';

import kikouchou from '../../eslint-rules/index.js';
import { RAW_PALETTE, matchRawPalette } from '../../eslint-rules/raw-palette.js';

// ============================================================================
// Fixtures
// ============================================================================

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

// ============================================================================
// Tests
// ============================================================================

describe('raw-palette', () => {
  it('is the same pattern the status variants test asserts against', () => {
    // Not a tautology: `status.variants.test.ts` imports this exact export, so
    // this pins the shared definition to the shapes that motivated it. Loosen
    // the regex and both fail together, which is the point of sharing it.
    expect(RAW_PALETTE.test('bg-amber-100')).toBe(true);
    expect(RAW_PALETTE.test('dark:hover:text-red-500')).toBe(true);
    expect(RAW_PALETTE.test('bg-black/12')).toBe(true);
    expect(RAW_PALETTE.test('bg-warning-surface')).toBe(false);
    expect(RAW_PALETTE.test('text-muted-foreground')).toBe(false);
  });

  it('covers every utility prefix that can carry a colour, not just the obvious four', () => {
    // A prefix missing from the list is a shade the rule silently permits while
    // still reading like a guarantee — `shadow-black/15` shipped that way once.
    for (const shade of [
      'shadow-red-500',
      'inset-shadow-red-500',
      'text-shadow-red-500',
      'outline-blue-500',
      'border-t-amber-100',
      'divide-y-slate-200',
      'ring-offset-white',
      'inset-ring-white',
      'accent-pink-500',
      'caret-red-500',
      'decoration-sky-500',
      'placeholder-gray-400',
    ]) {
      expect(RAW_PALETTE.test(shade), `${shade} slipped through`).toBe(true);
    }
  });

  it('takes a hyphen as part of a word, not as a class boundary', () => {
    // `\b` would read these as gradient stops, turning every route segment and
    // i18n key containing `-to-<colour>-` into a lint error with no honest fix.
    for (const notAClass of [
      'navigate-to-blue-page',
      'trip-from-white-label',
      'to-blue-thing',
      'drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]',
    ]) {
      expect(RAW_PALETTE.test(notAClass), `${notAClass} was flagged`).toBe(
        false,
      );
    }
    // ...while the real gradient stops, delimited by whitespace, still match.
    expect(matchRawPalette('bg-gradient-to-r from-amber-500 to-orange-500')).toEqual([
      'from-amber-500',
      'to-orange-500',
    ]);
  });

  it('has no `g` flag, so repeated matching is not stateful', () => {
    // A global regex carries `lastIndex` between calls, which would make
    // `expect(x).toMatch(RAW_PALETTE)` answer differently on identical input.
    expect(RAW_PALETTE.flags).toBe('');
    expect(RAW_PALETTE.test('bg-white')).toBe(true);
    expect(RAW_PALETTE.test('bg-white')).toBe(true);
  });

  it('reports every distinct shade in a class list, deduplicated', () => {
    expect(matchRawPalette('rounded bg-black/10 dark:bg-white/10')).toEqual([
      'bg-black',
      'bg-white',
    ]);
    expect(matchRawPalette('bg-white p-4 bg-white')).toEqual(['bg-white']);
    expect(matchRawPalette('bg-card text-foreground')).toEqual([]);
  });
});

// `RuleTester.run` declares its own `describe`/`it` per case, so it has to be
// called at suite level rather than from inside a test.
ruleTester.run(
  'kikouchou/no-raw-palette-class',
  kikouchou.rules['no-raw-palette-class'],
  {
    valid: [
      // Theme tokens, which is the whole point.
      { code: 'const x = <div className="bg-card text-muted-foreground" />;' },
      // The `-surface` / `-on-surface` tokens must not read as shades.
      { code: 'const x = "bg-warning-surface text-warning-on-surface";' },
      // Nothing colour-shaped at all.
      { code: 'const x = "flex items-center gap-2";' },
      // A module specifier is a path, not a class list.
      { code: 'import x from "./to-red.js";' },
      // Prose explaining the rule must not trip the rule.
      { code: '// never write bg-amber-100 here\nconst x = 1;' },
    ],
    invalid: [
      {
        // The literal case: straight into `className`.
        code: 'const x = <div className="bg-amber-100" />;',
        errors: [{ messageId: 'rawPalette' }],
      },
      {
        // The case a `className`-only selector would miss: a `cva` table in a
        // `.variants.ts` file with no JSX anywhere near it.
        code: 'export const v = { destructive: "bg-destructive text-white" };',
        errors: [{ messageId: 'rawPalette' }],
      },
      {
        // ...and the other one it would miss: an interpolated template.
        code: 'const x = `rounded ${size} bg-slate-50`;',
        errors: [{ messageId: 'rawPalette' }],
      },
      {
        // A variant prefix must not hide the shade behind it.
        code: 'const x = "dark:hover:text-red-500";',
        errors: [{ messageId: 'rawPalette' }],
      },
      {
        // A shadow is a colour too, and was the one that got away.
        code: 'const x = "rounded-full shadow-sm shadow-black/15";',
        errors: [{ messageId: 'rawPalette', data: { classes: "'shadow-black'" } }],
      },
      {
        // One report per literal, naming every distinct shade it carries.
        code: 'const x = "bg-black/10 dark:bg-white/10";',
        errors: [
          {
            messageId: 'rawPalette',
            data: { classes: "'bg-black', 'bg-white'" },
          },
        ],
      },
    ],
  },
);

ruleTester.run(
  'kikouchou/require-disable-description',
  kikouchou.rules['require-disable-description'],
  {
    valid: [
      {
        code: '// eslint-disable-next-line no-console -- prints the build id\nconsole.log(1);',
      },
      {
        code: 'console.log(1); // eslint-disable-line no-console -- prints the build id',
      },
      { code: '/* eslint-disable no-console -- this whole file is the CLI */' },
      // Re-enabling suppresses nothing, so it owes nothing.
      { code: '/* eslint-enable no-console */' },
      // A plain comment that merely mentions the word.
      { code: '// we could eslint-disable this, but the fix is cheap\nconst x = 1;' },
      // The directive name must match exactly: this is not one.
      { code: '// eslint-disabled-for-now no-console\nconst x = 1;' },
      // ESLint honours bare `eslint-disable` only in a block comment, so this
      // line comment suppresses nothing and owes nothing. Demanding a reason
      // would send someone off to justify a comment that does not do anything.
      { code: '// eslint-disable no-console\nconsole.log(1);' },
      // Same divergence at the other end: ESLint terminates a directive name on
      // whitespace, so a colon means this was never parsed as one.
      { code: '// eslint-disable-next-line:no-console\nconsole.log(1);' },
    ],
    invalid: [
      {
        code: '// eslint-disable-next-line no-console\nconsole.log(1);',
        errors: [{ messageId: 'missingDescription' }],
      },
      {
        code: 'console.log(1); // eslint-disable-line no-console',
        errors: [{ messageId: 'missingDescription' }],
      },
      {
        // Bare `eslint-disable` IS a directive in a block comment, unlike the
        // line-comment form two cases above.
        code: '/* eslint-disable no-console */\nconsole.log(1);',
        errors: [{ messageId: 'missingDescription' }],
      },
      {
        // A separator with nothing after it is not a reason. (The trailing
        // space is load-bearing: without it ESLint reads the `--` as part of
        // the rule name, so this is the shape a half-written reason takes.)
        //
        // The `data` assertion is the point of this case: the suggested fix is
        // built from the rule list, and echoing the dangling hyphens back would
        // suggest `no-console -- -- <reason>`.
        code: '// eslint-disable-next-line no-console -- \nconsole.log(1);',
        errors: [
          { messageId: 'missingDescription', data: { example: 'no-console' } },
        ],
      },
    ],
  },
);
