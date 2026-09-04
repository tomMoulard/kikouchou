/**
 * Throwaway config for unit 21's e2e runs. Private ports and
 * `reuseExistingServer: false`, so a run in this worktree cannot silently test
 * another worktree's dev server on the shared 4173. Deleted before commit.
 */
import { defineConfig, devices } from '@playwright/test';

const channel = process.env.PW_CHANNEL === 'chrome' ? 'chrome' : undefined;
const PORT = 4283;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    ...(channel === undefined ? {} : { channel }),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore:
        /offline-first\.spec\.ts|pwa\.spec\.ts|maps-offline\.spec\.ts|trip-sharing-sync\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: `bun x vite --host 127.0.0.1 --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: false,
      timeout: 120 * 1000,
      env: {
        GITHUB_ACTIONS: '',
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_PUBLISHABLE_KEY: '',
        VITE_POSTHOG_KEY: '',
        VITE_POSTHOG_HOST: '',
      },
    },
  ],
});
