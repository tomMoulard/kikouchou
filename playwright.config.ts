import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Kikoushou E2E tests.
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
    baseURL: 'http://127.0.0.1:4173',

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
       * Two specs belong to projects of their own and must not also run here.
       *
       * Offline behaviour cannot be observed against the dev server at all — see
       * the `offline` project. The sharing journey needs `VITE_SUPABASE_*`
       * pointing at the stub host, which this project deliberately does not have;
       * running it here failed every one of its tests against a server with no
       * backend configured.
       */
      testIgnore: /offline-first\.spec\.ts|trip-sharing-sync\.spec\.ts/,
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
      testIgnore: /offline-first\.spec\.ts|trip-sharing-sync\.spec\.ts/,
    },
    {
      /**
       * The offline contract, against the production build.
       *
       * These tests cannot run on the dev server, and running them there was
       * silently testing nothing. Two reasons, both measured:
       *
       *   - vite-plugin-pwa registers no service worker in dev, so a reload with
       *     the network off fails with ERR_INTERNET_DISCONNECTED rather than
       *     being served from the precache;
       *   - route chunks are lazy, so navigating to a page whose chunk has not
       *     loaded yet needs the network — offline that fails too.
       *
       * Both are exactly what the service worker exists to solve, so the only
       * honest way to assert rule 1 is to serve the built output.
       */
      name: 'offline',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://127.0.0.1:4175',
      },
      testMatch: /offline-first\.spec\.ts/,
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
        baseURL: 'http://127.0.0.1:4174',
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

  /* Servers started before the tests run */
  webServer: [
    {
      /**
       * Production build for the `offline` project: a real service worker and
       * real precached chunks, which is the only configuration where the
       * offline-first claims mean anything.
       *
       * GITHUB_ACTIONS is cleared for the same reason as the dev server below —
       * vite.config.ts would otherwise set base to '/kikoushou/' and every
       * navigation would 404.
       */
      command: 'bun run build && bun x vite preview --host 127.0.0.1 --port 4175',
      url: 'http://127.0.0.1:4175',
      reuseExistingServer: !process.env.CI,
      timeout: 180 * 1000,
      env: {
        GITHUB_ACTIONS: '',
      },
    },
    {
      // The dev server, for every project except `offline` — which needs a real
      // service worker and so runs against the production build above — and
      // `sync`, which needs a stubbed backend.
      command: 'bun x vite --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: {
        // vite.config.ts sets base='/kikoushou/' when GITHUB_ACTIONS is set,
        // but baseURL and every page.goto('/...') here assume '/'. The plugin
        // spawns this command with the full ambient env, so CI's own
        // GITHUB_ACTIONS=true would 404 every non-root navigation. Clear it.
        GITHUB_ACTIONS: '',

        /**
         * Blanked deliberately, and this is a safety measure rather than tidiness.
         *
         * Vite loads `.env.local`, which on a developer's machine holds the real
         * project URL and key — so without these two lines every test in these
         * projects ran against production, and any that reached a share would
         * have written to it. A process env var beats `.env.local` (verified
         * against Vite's own `loadEnv`), so setting them empty is what makes
         * these projects local-only.
         */
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_PUBLISHABLE_KEY: '',
      },
    },

    {
      /**
       * The dev server for the `sync` project: configured for a backend, but one
       * at a host that resolves nowhere. `supabase-stub` intercepts it, so a
       * request escaping interception fails loudly instead of reaching anything
       * real.
       */
      command: 'bun x vite --host 127.0.0.1 --port 4174',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: {
        GITHUB_ACTIONS: '',
        VITE_SUPABASE_URL: 'http://stub.invalid',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_stub',
      },
    },
  ],
});
