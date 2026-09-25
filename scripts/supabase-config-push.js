#!/usr/bin/env node

/**
 * `supabase config push`, refusing to run when it would destroy a credential.
 *
 * Usage:
 *   bun run db:config-push          # or: node scripts/supabase-config-push.js
 *
 * Any flags are passed through to the CLI (`--project-ref`, `--debug`, …).
 *
 * ## Why this exists
 *
 * `client_id` and `secret` under `[auth.external.*]` are `env(...)` references,
 * resolved from wherever the command runs. An unresolved one is not skipped and
 * is not blanked: the CLI pushes the literal string
 * `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)` as the client ID, overwriting
 * whatever the hosted project held — and the project was the only place that
 * value existed.
 *
 * On 2026-09-04 a bare `supabase config push` did exactly that to Google and
 * Spotify at once. `/auth/v1/authorize?provider=google` redirected to
 * `accounts.google.com/…?client_id=env%28SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID%29`,
 * Google returned `401 invalid_client`, and both sign-in buttons dead-ended —
 * while `/auth/v1/settings` went on advertising both providers as enabled, so
 * the app kept offering them. Recovery meant re-fetching the credentials from
 * the Google and Spotify consoles; nothing on disk or in git had them.
 *
 * There is deliberately no `--force`. A push always sends the whole auth block,
 * so an unresolved reference always overwrites — there is no such thing as a
 * push where skipping this check is safe.
 *
 * @module scripts/supabase-config-push
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const ROOT = resolve(import.meta.dirname, '..');
const CONFIG_PATH = resolve(ROOT, 'supabase', 'config.toml');
const ENV_FILE = resolve(ROOT, '.env.local');

/** `[a.b.c]` on a line of its own. */
const BLOCK_HEADER = /^\[([^\]]+)\]$/;
/** `key = "env(NAME)"` — the only form the CLI substitutes. */
const ENV_REFERENCE = /^([\w-]+)\s*=\s*"env\(([^)]+)\)"/;
/** `enabled = true|false`. */
const ENABLED = /^enabled\s*=\s*(true|false)\b/;
/** `KEY=value` in a dotenv file, `export` prefix and quotes both optional. */
const DOTENV_LINE = /^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/;

/**
 * Whether a block's settings are among those `config push` sends.
 *
 * Only auth is. `[studio]` and `[experimental]` also hold `env(...)`
 * references, but they configure the local stack — demanding an OpenAI key
 * before pushing auth settings would be a lie about what the command does.
 * A `[remotes.<name>.auth…]` override is auth once the prefix is off.
 *
 * @param {string} block Dotted block name, without the brackets.
 * @returns {boolean}
 */
function isPushedAuthBlock(block) {
  const path = block.replace(/^remotes\.[^.]+\./, '');
  return path === 'auth' || path.startsWith('auth.');
}

/**
 * Every `env(...)` reference that `config push` would send unresolved.
 *
 * A block counts as live unless it says `enabled = false`, so a disabled
 * provider is skipped: `[auth.external.apple]` ships disabled and still carries
 * an `env(...)` secret, and a guard that refused every push over it would be
 * bypassed within the week. An exported-but-empty variable counts as missing —
 * that is what an unset one looks like after a shell expands it, and it
 * overwrites the credential just the same.
 *
 * @param {string} toml Contents of `supabase/config.toml`.
 * @param {Record<string, string | undefined>} env Environment to resolve against.
 * @returns {Array<{name: string, block: string, key: string}>} In file order.
 */
export function missingAuthEnvVars(toml, env) {
  /** @type {Array<{block: string, enabled: boolean, refs: Array<{name: string, key: string}>}>} */
  const blocks = [];
  let current = null;

  for (const line of toml.split('\n')) {
    const trimmed = line.trim();
    // A commented-out reference is documentation, not configuration.
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const header = BLOCK_HEADER.exec(trimmed);
    if (header) {
      current = { block: header[1].trim(), enabled: true, refs: [] };
      blocks.push(current);
      continue;
    }
    if (!current) continue;

    const enabled = ENABLED.exec(trimmed);
    if (enabled) {
      current.enabled = enabled[1] === 'true';
      continue;
    }

    const reference = ENV_REFERENCE.exec(trimmed);
    if (reference) current.refs.push({ key: reference[1], name: reference[2].trim() });
  }

  return blocks
    .filter((b) => b.enabled && isPushedAuthBlock(b.block))
    .flatMap((b) => b.refs.map((r) => ({ name: r.name, block: b.block, key: r.key })))
    .filter(({ name }) => !env[name]);
}

/**
 * Parse a dotenv file into a plain object.
 *
 * Enough of the format for credentials: `KEY=value`, optional `export`, optional
 * surrounding quotes, `#` comments on their own line. No interpolation — a `$`
 * in a client secret is a literal `$`.
 *
 * @param {string} contents
 * @returns {Record<string, string>}
 */
export function parseDotEnv(contents) {
  /** @type {Record<string, string>} */
  const parsed = {};

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const match = DOTENV_LINE.exec(trimmed);
    if (!match) continue;

    parsed[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }

  return parsed;
}

/**
 * The environment the push runs under: `.env.local` underneath, the real
 * environment on top.
 *
 * Reading `.env.local` is what makes this wrapper worth reaching for rather
 * than routing around — the credentials can sit in the file the repo already
 * gitignores instead of being re-exported into every new shell. A variable
 * already set in the environment wins, so a one-off override still works.
 *
 * Vite does not expose these to the browser: only `VITE_`-prefixed names reach
 * `import.meta.env`, so a client secret in this file stays out of the bundle.
 *
 * @returns {Record<string, string | undefined>}
 */
function resolveEnv() {
  const fromFile = existsSync(ENV_FILE) ? parseDotEnv(readFileSync(ENV_FILE, 'utf8')) : {};
  return { ...fromFile, ...process.env };
}

/** Refuse the push, saying which credentials would have been destroyed. */
function refuse(missing) {
  const blockWidth = Math.max(...missing.map((m) => m.block.length));
  const keyWidth = Math.max(...missing.map((m) => m.key.length));
  const rows = missing.map((m) => `  ${m.block.padEnd(blockWidth)}  ${m.key.padEnd(keyWidth)}  <- ${m.name}`);

  console.error(
    [
      `Refusing to push: ${missing.length} credential${missing.length === 1 ? '' : 's'} would be overwritten.`,
      '',
      ...rows,
      '',
      'These are unset, and the CLI does not skip an unresolved env(...) — it pushes',
      'the reference verbatim as the credential, replacing what the project holds.',
      'That is what took Google and Spotify sign-in down on 2026-09-04 with',
      '401 invalid_client, and the project was the only copy of those values.',
      '',
      `Put them in ${ENV_FILE.replace(`${ROOT}/`, '')} (gitignored) or export them, then retry.`,
      'They come from the provider consoles — Google Cloud → APIs & Services →',
      'Credentials, and the Spotify developer dashboard — never from this repo.',
    ].join('\n'),
  );
}

if (process.argv[1] === import.meta.filename) {
  const env = resolveEnv();
  const missing = missingAuthEnvVars(readFileSync(CONFIG_PATH, 'utf8'), env);

  if (missing.length > 0) {
    refuse(missing);
    process.exit(1);
  }

  const child = spawn('bunx', ['supabase', 'config', 'push', ...process.argv.slice(2)], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error(`Could not run the Supabase CLI: ${error.message}`);
    process.exit(1);
  });
  // A CLI killed by a signal reports a null code; treat that as a failure too.
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}
