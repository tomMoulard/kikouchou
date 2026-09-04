import { createHash } from 'node:crypto';

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Kikouchou E2E tests.
 * @see https://playwright.dev/docs/test-configuration
 */

/**
 * Which Chromium build to drive.
 *
 * Playwright speaks CDP to Chromium either way — the only question is whose
 * binary is on the other end.
 *
 * Unset, the default, uses Playwright's own pinned build. That is what CI wants:
 * the version moves with the dependency, so a Chrome auto-update cannot change a
 * test result underneath you.
 *
 * `PW_CHANNEL=chrome` drives the machine's installed Google Chrome instead,
 * which is how to run this suite on a machine where `playwright install` has not
 * finished — no multi-hundred-megabyte download, and the browser is already
 * there. Expect small rendering and timing differences from the pinned build;
 * treat a failure that only appears under one of them as information about the
 * environment, not a verdict on the code.
 *
 * That escape hatch existed because `playwright install` used to hang forever on
 * a current Node, and the reason is worth pinning down so nobody reintroduces it.
 * Node 26.1.0 changed something in streams that deadlocks the `extract-zip`
 * yauzl extractor Playwright bundles: the download finishes fine, then
 * extraction stops dead partway through the first entry big enough to hit
 * backpressure — for chromium v1208 that was `Localizable.strings`, frozen at
 * 225,666 of 346,939 bytes with the process idle and no error, ever. Measured,
 * not assumed: system `unzip` did the same archive in 2.2 s, Node 25.7/26.0
 * extracted it, and every Node from 26.1.0 up hung at the identical byte.
 *
 * Playwright fixed their side in 1.60.0, so the dependency floor below is load
 * bearing on any machine running Node >= 26.1: 1.58.2 and 1.59.1 hang, 1.60.0
 * and up install in ~11 s. Do not pin this back under 1.60 for stability — CI
 * would not notice, because it runs Node 20, and the breakage would land only on
 * developer machines.
 */
const channel = ((): 'chrome' | 'msedge' | undefined => {
  const requested = process.env.PW_CHANNEL;
  if (requested === undefined || requested === '') {
    return undefined;
  }
  if (requested === 'chrome' || requested === 'msedge') {
    return requested;
  }
  // Loud rather than silently ignored: a typo here would quietly run the whole
  // suite against a different browser than the one asked for.
  throw new Error(
    `PW_CHANNEL must be 'chrome' or 'msedge' (or unset for Playwright's own Chromium), got '${requested}'`,
  );
})();

/**
 * The first of the three ports this config serves on, derived from where the
 * checkout lives.
 *
 * The three ports used to be the literals 4173/4174/4175 in every checkout,
 * which is fine with one of them and actively dangerous with several. This
 * machine carries 20-plus agent worktrees of this repo; `reuseExistingServer`
 * (below) treats *anything already answering* on the URL as "my server is
 * already up", so a second run would find another worktree's dev server, skip
 * starting its own, and drive **that checkout's code** to a full sheet of
 * results. It produced false failures for three workers in one batch and at
 * least one false pass, and nothing in the output said so — the reused server
 * is only mentioned in a line Playwright prints before the run.
 *
 * Hashing the config's own directory gives a base that is stable across reruns
 * in one worktree (so `reuseExistingServer` still earns its keep) and disjoint
 * across worktrees (so the reuse can only ever find *our* server).
 *
 * Under CI the literals come back: one checkout, one runner, no collision to
 * avoid, and a workflow that can name a port in a log or a firewall rule.
 *
 * The range is 4173-5072 (300 slots of 3). Checked against everything this
 * repo and its toolchain bind: Vite's dev default 5173 and its preview default
 * 4173, the Docker/nginx image on 3000, and the local Supabase stack on
 * 54321-54323 — the top of the range stops 101 ports below 5173, the nearest
 * of them. A derived port can still land on some unrelated process; see
 * `PW_PORT_BASE` below for the way out.
 */
const PORT_BASE = ((): number => {
  const override = process.env.PW_PORT_BASE;
  if (override !== undefined && override !== '') {
    const parsed = Number(override);
    // Loud rather than silently ignored, as with PW_CHANNEL above: a typo would
    // otherwise send the whole suite at a port nobody meant. Three consecutive
    // ports are needed, and the top of the ephemeral range is not ours to take.
    if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_532) {
      throw new Error(
        `PW_PORT_BASE must be an integer between 1024 and 65532, got '${override}'`,
      );
    }
    return parsed;
  }
  if (process.env.CI) {
    return 4173;
  }
  const digest = createHash('sha256').update(import.meta.dirname).digest('hex').slice(0, 8);
  return 4173 + (parseInt(digest, 16) % 300) * 3;
})();

const DEV_PORT = PORT_BASE;
const SYNC_PORT = PORT_BASE + 1;
const PREVIEW_PORT = PORT_BASE + 2;

const DEV_URL = `http://127.0.0.1:${DEV_PORT}`;
const SYNC_URL = `http://127.0.0.1:${SYNC_PORT}`;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

/**
 * The specs that only mean anything against the built output, served by `vite
 * preview` on {@link PREVIEW_PORT} — see the `production` project below. Named
 * once so the projects that must run them and the projects that must skip them
 * cannot drift apart, which is how `pwa.spec.ts` ended up running against the
 * dev server and failing all 23 of its tests.
 */
const PRODUCTION_BUILD_SPECS_PATTERN =
  /offline-first\.spec\.ts|pwa\.spec\.ts|maps-offline\.spec\.ts/;

/**
 * Everything the two dev-server projects must not pick up: the production-build
 * specs above, plus the sharing journey, which needs the stubbed backend of the
 * `sync` project.
 */
const DEV_SERVER_IGNORE_PATTERN =
  /offline-first\.spec\.ts|pwa\.spec\.ts|maps-offline\.spec\.ts|trip-sharing-sync\.spec\.ts/;

export default defineConfig({
  testDir: './e2e',

  /* Global test timeout — prevents any single test from hanging CI */
  timeout: 60_000,

  /* Expect timeout for assertions */
  expect: { timeout: 10_000 },

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter to use */
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: DEV_URL,

    /* Timeout for user actions (click, fill, etc.) */
    actionTimeout: 10_000,

    /* Timeout for page navigations */
    navigationTimeout: 15_000,

    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',

    /* Take screenshot on failure */
    screenshot: 'only-on-failure',

    // Applied to every project below, none of which sets its own channel.
    ...(channel === undefined ? {} : { channel }),
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      /**
       * Three specs belong to projects of their own and must not also run here.
       *
       * Offline and PWA behaviour cannot be observed against the dev server at
       * all — see the `production` project. The sharing journey needs
       * `VITE_SUPABASE_*` pointing at the stub host, which this project
       * deliberately does not have; running it here failed every one of its
       * tests against a server with no backend configured.
       */
      testIgnore: DEV_SERVER_IGNORE_PATTERN,
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
      testIgnore: DEV_SERVER_IGNORE_PATTERN,
    },
    {
      /**
       * The offline and PWA contracts, against the production build.
       *
       * These tests cannot run on the dev server, and running them there was
       * silently testing nothing. Three reasons, all measured:
       *
       *   - vite-plugin-pwa registers no service worker in dev, so a reload with
       *     the network off fails with ERR_INTERNET_DISCONNECTED rather than
       *     being served from the precache;
       *   - route chunks are lazy, so navigating to a page whose chunk has not
       *     loaded yet needs the network — offline that fails too;
       *   - the manifest and the workbox precache are build outputs. On the dev
       *     server `/manifest.webmanifest` falls through to the SPA handler and
       *     comes back as `text/html`, so every assertion in `pwa.spec.ts` that
       *     parsed it died on `Unexpected token '<'`.
       *
       * All three are exactly what the service worker exists to solve, so the
       * only honest way to assert these rules is to serve the built output.
       */
      name: 'production',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: PREVIEW_URL,
      },
      testMatch: PRODUCTION_BUILD_SPECS_PATTERN,
      /**
       * Serial, unlike every other project here.
       *
       * Each test installs a service worker and precaches ~2.5 MB in its own
       * context. Six of those at once against one preview server contends badly
       * enough to make clicks miss their 10 s timeout: the same test passed alone
       * in 1.6 s and failed in parallel at 11.5 s. That is a property of the
       * environment, not of the tests, so it is fixed here rather than by
       * inflating every timeout in the spec.
       */
      fullyParallel: false,
    },

    {
      /**
       * The server-backed sharing journey.
       *
       * Its own dev server because it needs `VITE_SUPABASE_*` pointing at a host
       * that resolves nowhere, which `e2e/support/supabase-stub` then intercepts.
       * The other projects must not have a backend configured at all — they
       * assert local-only behaviour.
       */
      name: 'sync',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: SYNC_URL,
      },
      testMatch: /trip-sharing-sync\.spec\.ts/,
      /**
       * Serial. Several tests drive two browser contexts against one stub, and
       * the stub is a single in-process object — parallel workers would share
       * nothing but the port and interleave their assertions on `counts`.
       */
      fullyParallel: false,
    },
  ],

  /**
   * Servers started before the tests run, on the three ports derived from this
   * checkout's path — see {@link PORT_BASE}.
   *
   * Every one of them passes `--strictPort`. Vite's default is to walk to the
   * next free port when the one asked for is taken, which would put the server
   * somewhere `url` below is not looking; Playwright would then sit out its
   * whole timeout waiting for a server that is already up one port over. Fail
   * on the bind instead, and say which port.
   */
  webServer: [
    {
      /**
       * Production build for the `production` project: a real service worker and
       * real precached chunks, which is the only configuration where the
       * offline-first claims mean anything.
       */
      command: `bun run build && bun x vite preview --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
      url: PREVIEW_URL,
      /**
       * Kept on, now that it is safe: {@link PORT_BASE} is derived from this
       * checkout's path, so the only thing that can already be answering here
       * is this worktree's own server. It saves the ~40 s rebuild on every
       * rerun while iterating on a spec, which is most of the reason to run
       * this project locally at all.
       */
      reuseExistingServer: !process.env.CI,
      timeout: 180 * 1000,
      env: {
        /**
         * Same blanking as the dev server below, and it matters more here
         * because this command runs `bun run build`: whatever `.env.local`
         * holds is *inlined into the bundle* that the offline and PWA specs
         * then exercise. A developer's real Supabase project and real PostHog
         * key would ship into that build, and the specs in this project assert
         * local-only behaviour anyway.
         *
         * Measured, not assumed: with dummy values under these four names in
         * `.env.local`, all four appear in `dist/assets/index-*.js` when these
         * lines are absent and none of them when they are present.
         * `src/test/e2e-env-isolation.test.ts` pins that for every server here,
         * so deleting a line now fails the suite instead of quietly restoring
         * the leak.
         */
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_PUBLISHABLE_KEY: '',
        VITE_POSTHOG_KEY: '',
        VITE_POSTHOG_HOST: '',
      },
    },
    {
      // The dev server, for every project except `production` — which needs a real
      // service worker and so runs against the production build above — and
      // `sync`, which needs a stubbed backend.
      command: `bun x vite --host 127.0.0.1 --port ${DEV_PORT} --strictPort`,
      url: DEV_URL,
      // Safe to reuse, and worth it — see the production server above.
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: {
        /**
         * Blanked deliberately, and this is a safety measure rather than tidiness.
         *
         * Vite loads `.env.local`, which on a developer's machine holds the real
         * project URL and key — so without these lines every test in these
         * projects ran against production, and any that reached a share would
         * have written to it. A process env var beats `.env.local` (verified
         * against Vite's own `loadEnv`), so setting them empty is what makes
         * these projects local-only.
         *
         * PostHog was the half that was missed, and it cost the project 19
         * phantom people: every fresh browser context on a server that had a
         * key created a Person, against three real Supabase accounts. The
         * localhost guard in `lib/posthog` now refuses to init here too, so
         * this is belt and braces — keep both.
         */
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_PUBLISHABLE_KEY: '',
        VITE_POSTHOG_KEY: '',
        VITE_POSTHOG_HOST: '',
      },
    },

    {
      /**
       * The dev server for the `sync` project: configured for a backend, but one
       * at a host that resolves nowhere. `supabase-stub` intercepts it, so a
       * request escaping interception fails loudly instead of reaching anything
       * real.
       */
      command: `bun x vite --host 127.0.0.1 --port ${SYNC_PORT} --strictPort`,
      url: SYNC_URL,
      // Safe to reuse, and worth it — see the production server above.
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: {
        VITE_SUPABASE_URL: 'http://stub.invalid',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_stub',
        // A backend is configured here, analytics still is not: this project
        // signs a stub user in, and an `identify()` against the real project
        // would put a fake account in it. See the dev server above.
        VITE_POSTHOG_KEY: '',
        VITE_POSTHOG_HOST: '',
      },
    },
  ],
});
