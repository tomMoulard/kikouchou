/**
 * @fileoverview The Playwright web servers must never be handed a real backend.
 *
 * `vite build` and `vite dev` both read `.env.local`, which on a developer's
 * machine holds a real Supabase project and a real PostHog key, and `vite build`
 * *inlines* what it finds into the bundle the `production` project then serves.
 * `playwright.config.ts` defends against that by setting those variables empty in
 * every `webServer.env` block — a process variable beats `.env.local`, so an
 * empty one is what makes these servers local-only.
 *
 * That defence is four lines of configuration per server with nothing asserting
 * them. Deleting them breaks no build, no type-check and no test: the suite goes
 * on passing while it quietly runs against production. `env-isolation.test.ts`
 * pins the same blanking in `vitest.config.ts` for exactly this reason; this file
 * is its counterpart for the end-to-end servers.
 *
 * Two things have to hold, so both are checked here:
 *
 *   1. every server declares the blanks (the configuration), and
 *   2. a blank process variable really does beat `.env.local` (the mechanism the
 *      configuration relies on, which belongs to Vite and could change under an
 *      upgrade without anything here looking different).
 *
 * Deliberately says nothing about ports or commands beyond whether one builds,
 * so it constrains the environment blocks only.
 *
 * @module test/e2e-env-isolation.test
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import playwrightConfig from '../../playwright.config';

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Every variable `vite build` would inline, and that a leak would carry out.
 *
 * The two PostHog ones are here because they cost the project 19 phantom people
 * before anyone noticed the Supabase pair had a sibling.
 */
const CLIENT_VARIABLES = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_POSTHOG_KEY',
  'VITE_POSTHOG_HOST',
] as const;

const { webServer } = playwrightConfig;

const servers =
  webServer === undefined ? [] : Array.isArray(webServer) ? webServer : [webServer];

// ============================================================================
// Tests
// ============================================================================

describe('playwright web server environments', () => {
  /**
   * Without this the per-server checks below would pass by describing nothing at
   * all — the shape of test that cannot fail, which is what let the leak live.
   */
  it('finds the servers to check', () => {
    expect(servers.length).toBeGreaterThanOrEqual(3);
  });

  it('runs exactly one server from a build, and gives it no backend to inline', () => {
    const builders = servers.filter((server) => /\bbuild\b/.test(server.command));

    expect(builders).toHaveLength(1);

    // `?.` rather than a non-null assertion: if the filter found nothing, these
    // compare undefined against '' and fail, instead of throwing past the point.
    const [builder] = builders;
    expect(builder?.env?.VITE_SUPABASE_URL).toBe('');
    expect(builder?.env?.VITE_SUPABASE_PUBLISHABLE_KEY).toBe('');
    expect(builder?.env?.VITE_POSTHOG_KEY).toBe('');
    expect(builder?.env?.VITE_POSTHOG_HOST).toBe('');
  });

  for (const [index, server] of servers.entries()) {
    describe(`webServer[${String(index)}]: ${server.command}`, () => {
      it('declares an environment block of its own', () => {
        expect(server.env).toBeDefined();
      });

      it('sets every client variable explicitly rather than inheriting one', () => {
        const env = server.env ?? {};

        for (const name of CLIENT_VARIABLES) {
          // Presence, not value: an inherited variable is the failure mode, and
          // an absent key is exactly how `.env.local` gets through.
          expect(Object.hasOwn(env, name), `${name} is not declared`).toBe(true);
        }
      });

      it('configures no analytics', () => {
        const env = server.env ?? {};

        // No server here may ever have a key: `lib/posthog` also refuses to
        // init on a development host, and both halves are meant to stay.
        expect(env.VITE_POSTHOG_KEY).toBe('');
        expect(env.VITE_POSTHOG_HOST).toBe('');
      });

      it('never points at a Supabase host that could resolve', () => {
        const env = server.env ?? {};
        const url = String(env.VITE_SUPABASE_URL ?? '');
        const hostname = url === '' ? '' : new URL(url).hostname;

        // Empty is no backend; `.invalid` is the sharing stub's host, which
        // RFC 2606 guarantees never resolves. A real project matches neither.
        expect(hostname).toMatch(/^$|\.invalid$/);
      });

      it('sets the Supabase URL and key together', () => {
        const env = server.env ?? {};

        // Half-blanking configures a client with a key and no host, or a host
        // and no key — neither is a state any project here means to be in.
        expect(env.VITE_SUPABASE_URL === '').toBe(env.VITE_SUPABASE_PUBLISHABLE_KEY === '');
      });
    });
  }
});

describe('a blank process variable beats .env.local', () => {
  /**
   * A name of its own, so neither half can pass for the wrong reason: the four
   * real variables are already blanked for this suite by `vitest.config.ts`, and
   * the first reading below has to see a file value win.
   */
  const PROBE = 'VITE_ENV_PRECEDENCE_PROBE';
  const FROM_FILE = 'https://a-developers-real-project.supabase.co';

  /**
   * Asks Vite's own loader, in a child process, what `import.meta.env` would
   * hold — once with nothing set, then with the variable set to the empty
   * string, which is how Playwright passes an `env` entry to a spawned command.
   *
   * A child rather than a plain import because `vite` loads esbuild, and esbuild
   * refuses to initialise under jsdom: it asserts
   * `new TextEncoder().encode('') instanceof Uint8Array`, which is false when
   * the encoder and the global `Uint8Array` come from different realms. A clean
   * node process is also closer to what `vite build` actually runs in.
   */
  const readBothWays = (envDir: string): { unset: unknown; blank: unknown } => {
    const source = `
      const { loadEnv } = await import('vite');
      const dir = process.env.PROBE_ENV_DIR;
      const unset = loadEnv('production', dir)[${JSON.stringify(PROBE)}];
      process.env[${JSON.stringify(PROBE)}] = '';
      const blank = loadEnv('production', dir)[${JSON.stringify(PROBE)}];
      process.stdout.write(JSON.stringify({ unset, blank }));
    `;

    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      // `-e` resolves bare specifiers from the working directory, so `vite` has
      // to be looked up from the repo root rather than from wherever the suite
      // happens to have been started.
      cwd: resolve(import.meta.dirname, '../..'),
      env: { ...process.env, PROBE_ENV_DIR: envDir },
      encoding: 'utf8',
    });

    return JSON.parse(stdout) as { unset: unknown; blank: unknown };
  };

  it('overrides the file value, and would read it without the override', () => {
    const envDir = mkdtempSync(join(tmpdir(), 'kikouchou-env-precedence-'));

    try {
      writeFileSync(join(envDir, '.env.local'), `${PROBE}=${FROM_FILE}\n`);

      const { unset, blank } = readBothWays(envDir);

      // The leak itself, reproduced: this is what a developer's credentials did
      // to the production build before its env block blanked them. It is
      // asserted so that the second expectation cannot pass because the loader
      // silently stopped reading `.env.local` at all.
      expect(unset).toBe(FROM_FILE);

      // And the defence: an empty string wins, which is the entire reason the
      // env blocks in `playwright.config.ts` and `vitest.config.ts` work.
      expect(blank).toBe('');
    } finally {
      rmSync(envDir, { recursive: true, force: true });
    }
  });
});
