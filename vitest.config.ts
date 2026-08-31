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
     * Blank the Supabase configuration for the whole suite.
     *
     * Vite loads `.env.local` in tests too, so without this the developer's real
     * project URL and key reach `import.meta.env`. `isSupabaseConfigured()` then
     * returns true, `AuthProvider` constructs a live client against
     * **production** on every test that mounts `AppProviders`, and each one reads
     * localStorage, runs `detectSessionInUrl` and starts a token-refresh timer.
     * That was the source of an intermittent failure in the assistant prompt
     * tests.
     *
     * Local-only is also the right default to test: it is the mode a first
     * launch runs in. The few tests that need a configured backend stub the env
     * themselves with `vi.stubEnv`.
     */
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
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

      // Coverage thresholds
      // Statements, functions, and lines comfortably exceed 80%.
      // Branches threshold set to 79% — the remaining gap is in hardware-dependent code
      // (QRScanner), Leaflet integration (MapView), DnD interactions (DroppableRoom),
      // and Radix UI internal portal branches that are unreachable in unit tests.
      thresholds: {
        statements: 80,
        branches: 79,
        functions: 80,
        lines: 80,
      },
    },

    // Reporter configuration
    reporters: ['default'],

    // Pool configuration - use threads for better performance
    // Threads have lower startup overhead than forks and work well with jsdom
    pool: 'threads',

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
