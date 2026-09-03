/**
 * @fileoverview Vitest configuration for the Kikoushou test suite.
 * Provides test environment setup, coverage configuration, and path alias resolution.
 *
 * @module vitest.config
 */

import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// ============================================================================
// Configuration
// ============================================================================

export default defineConfig({
  plugins: [react()],
  test: {
    // Use jsdom for DOM testing environment
    environment: 'jsdom',

    // Enable global test APIs (describe, it, expect, etc.)
    globals: true,

    // Setup files to run before each test file
    setupFiles: ['./src/test/setup.ts'],

    /**
     * Blank the Supabase and PostHog configuration for the whole suite.
     *
     * Vite loads `.env.local` in tests too, so without this the developer's real
     * project URL and key reach `import.meta.env`. `isSupabaseConfigured()` then
     * returns true, `AuthProvider` constructs a live client against
     * **production** on every test that mounts `AppProviders`, and each one reads
     * localStorage, runs `detectSessionInUrl` and starts a token-refresh timer.
     * That was the source of an intermittent failure in the assistant prompt
     * tests.
     *
     * PostHog is blanked for the same reason and a worse symptom: `lib/posthog`
     * is imported at module scope by anything that mounts the app, so a key in
     * `.env.local` had every test run call `posthog.init()` against the real
     * project. jsdom reports `window.location.hostname` as `localhost`, which
     * posthog-js's dated defaults treat as an internal user — and that path
     * forces a person profile, so each run minted anonymous people in a project
     * that has three real accounts. `lib/posthog` now refuses to init on
     * localhost as well; both belong here.
     *
     * Local-only is also the right default to test: it is the mode a first
     * launch runs in. The few tests that need a configured backend stub the env
     * themselves with `vi.stubEnv`.
     */
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
      VITE_POSTHOG_KEY: '',
      VITE_POSTHOG_HOST: '',
    },

    // Test file patterns
    include: ['src/**/*.{test,spec}.{ts,tsx}'],

    // Exclude patterns
    exclude: [
      'node_modules',
      'dist',
      '.idea',
      '.git',
      '.cache',
    ],

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',

      // Files to include in coverage
      include: ['src/**/*.{ts,tsx}'],

      // Files to exclude from coverage
      exclude: [
        'node_modules/',
        'src/test/',
        'src/components/ui/**', // shadcn/ui generated components
        '**/*.d.ts',
        'src/vite-env.d.ts',
        'src/main.tsx', // Entry point
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
      ],

      /**
       * Coverage thresholds — enforced by CI, which runs `test:coverage`.
       *
       * Until that CI change these numbers were decoration: nothing in
       * `package.json` or the workflow ever passed `--coverage`, so no run had
       * ever compared them against reality. The first run that did showed the
       * branches figure had been wrong the whole time — 75.35%, not the 79% the
       * old comment argued for.
       *
       * Measured 2026-09-03 on 186 files / 3528 tests:
       *   statements 81.67 · branches 75.35 · functions 82.45 · lines 82.63
       *
       * Each number is set below its measured value, so a green suite stays
       * green and a real regression goes red. Raise them as coverage grows;
       * never lower one to make a red build pass without saying what dropped.
       *
       * The branches gap is concentrated in code a jsdom unit test cannot
       * reach: `router.tsx` and `sw/register.ts` (0%), the camera-dependent
       * `QRScanner.tsx` (0%), the WebLLM worker and `useWebLLM.ts` (0% / 9%),
       * and the sync providers `YjsProvider.tsx` (25%) and `useTripSync.ts`
       * (36%).
       */
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },

    // Reporter configuration
    reporters: ['default'],

    // Pool configuration - use threads for better performance
    // Threads have lower startup overhead than forks and work well with jsdom
    pool: 'threads',

    /**
     * Cap the worker count instead of taking one per core.
     *
     * A full run spends far more time importing than running assertions —
     * `import 178.85s` against `tests 99.01s`, summed across workers, for a
     * 53.8s wall clock. That import cost is Vite transforming the same heavy
     * module graph (React, Radix, date-fns, Yjs) in every worker at once, and
     * it is charged against `testTimeout`, not `hookTimeout`. Uncapped, a
     * developer machine runs one worker per core plus whatever else it is
     * doing, and the heaviest files — TripForm, SupabaseYjsProvider, TripCard —
     * drift toward the 10s budget and start reading as flaky. They are not
     * flaky; they are the files closest to the limit when the box is busy.
     *
     * Four is deliberately an absolute, not a percentage: a GitHub runner has
     * 4 vCPUs, so CI keeps the parallelism it already had, and only oversized
     * dev machines are held back. Cheap insurance against a failure mode whose
     * symptom is a timeout somewhere unrelated to the change under test.
     *
     * This is `maxWorkers`, not `poolOptions.threads.maxThreads`: Vitest 4
     * removed the per-pool block and promoted the setting to the top level.
     * The nested form is not an error — it prints a deprecation notice and is
     * then ignored, which is the worst of both.
     */
    maxWorkers: 4,

    // Timeout for async operations
    testTimeout: 10000,

    // Hook timeout
    hookTimeout: 10000,
  },

  // Path alias resolution (must match vite.config.ts and tsconfig.app.json)
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
});
