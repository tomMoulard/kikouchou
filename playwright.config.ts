import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Kikoushou E2E tests.
 * @see https://playwright.dev/docs/test-configuration
 */
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
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  /* Run production build preview server and signaling relay before starting tests */
  webServer: [
    {
      // Signaling relay for P2P sync tests
      command: 'node relay/server.js',
      port: 4444,
      reuseExistingServer: false,
      timeout: 10_000,
    },
    {
      // Run the Vite app against the local signaling relay.
      // Using the dev server here is more reliable for end-to-end P2P checks.
      command: 'bun x vite --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: {
        VITE_SIGNALING_URL: 'ws://127.0.0.1:4444',
        // vite.config.ts sets base='/kikoushou/' when GITHUB_ACTIONS is set,
        // but baseURL and every page.goto('/...') here assume '/'. The plugin
        // spawns this command with the full ambient env, so CI's own
        // GITHUB_ACTIONS=true would 404 every non-root navigation. Clear it.
        GITHUB_ACTIONS: '',
      },
    },
  ],
});
