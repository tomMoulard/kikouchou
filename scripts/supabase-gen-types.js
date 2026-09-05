#!/usr/bin/env node

/**
 * `supabase gen types typescript --linked`, with its own docblock preserved and
 * its failures made audible.
 *
 * Usage:
 *   bun run db:types          # or: node scripts/supabase-gen-types.js
 *
 * Any flags are passed through to the CLI (`--project-id`, `--debug`, …).
 *
 * ## Why this exists
 *
 * This replaces a shell one-liner that redirected the CLI's stdout straight
 * into a temp file. That is fine while the command works and actively harmful
 * when it does not: `supabase gen types` reports its errors on **stdout**, as
 * JSON, so the redirect swallowed them. A developer whose link had lapsed saw
 * an empty terminal and `exited with code 1`, with nothing naming the cause —
 *
 *     {"_tag":"Error","error":{"code":"LegacyProjectNotLinkedError",
 *      "message":"Cannot find project ref. Have you run supabase link?"}}
 *
 * — sitting unread in `/tmp`. The `&&` chain did at least stop before
 * overwriting the real file, so the damage was confusion rather than a
 * clobbered `database.types.ts`.
 *
 * Two guards, both cheap:
 *
 * 1. **The output is checked before it replaces anything.** Generated types
 *    start with the `export type Json` declaration; a JSON error object does
 *    not. Whatever fails the check is printed in full and nothing is written.
 * 2. **The docblock survives.** `database.types.ts` opens with a hand-written
 *    comment explaining that the file is generated from the *linked* project
 *    rather than from the migrations in this repo. The CLI does not emit it, so
 *    it is carried over from the file being replaced.
 *
 * @module scripts/supabase-gen-types
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const ROOT = resolve(import.meta.dirname, '..');
const TYPES_PATH = resolve(ROOT, 'src', 'lib', 'supabase', 'database.types.ts');

/** The first declaration of a real generated file. */
const GENERATED_MARKER = 'export type Json';

/** The end of the hand-written docblock: a comment terminator on its own line. */
const DOCBLOCK_END = /^ \*\/$/m;

/**
 * The hand-written header of the current file, with the blank line that follows
 * it.
 *
 * The blank line is not decoration: the CLI's output starts straight at
 * `export type Json`, so joining without it puts the declaration hard against
 * the comment and every regeneration shows a one-line diff nobody asked for.
 * The first run of this script did exactly that.
 *
 * @param source - The existing `database.types.ts`
 * @returns The docblock, or an empty string when the file has none
 */
function readDocblock(source) {
  const match = DOCBLOCK_END.exec(source);
  return match === null ? '' : `${source.slice(0, match.index + match[0].length)}\n\n`;
}

const result = spawnSync(
  'supabase',
  ['gen', 'types', 'typescript', '--linked', ...process.argv.slice(2)],
  { cwd: ROOT, encoding: 'utf8' },
);

if (result.error) {
  console.error(`Could not run the Supabase CLI: ${result.error.message}`);
  process.exit(1);
}

const stdout = result.stdout ?? '';

// The CLI reports failure on stdout as often as on stderr, and sometimes exits
// non-zero with nothing on either — so neither the code nor the streams alone
// is enough to tell a good run from a bad one. The shape of the output is.
if (result.status !== 0 || !stdout.includes(GENERATED_MARKER)) {
  console.error('supabase gen types did not return TypeScript. It said:\n');
  console.error(stdout.trim() || '(nothing on stdout)');
  if (result.stderr?.trim()) {
    console.error(result.stderr.trim());
  }
  console.error(
    '\nIf this is "Cannot find project ref", the CLI is not linked to a project:\n' +
      '  bunx supabase link --project-ref <ref>    # `supabase projects list` shows it\n' +
      '\nNote that --linked reads the *deployed* schema, so a migration that has not\n' +
      'been pushed will not appear here however many times this is run.',
  );
  process.exit(1);
}

const existing = readFileSync(TYPES_PATH, 'utf8');
writeFileSync(TYPES_PATH, `${readDocblock(existing)}${stdout}`);

console.log(`Wrote ${TYPES_PATH}`);
