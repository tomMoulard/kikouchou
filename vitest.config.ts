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

      // Coverage thresholds (Story 1.1 AC#4: raised from 70% to 80%)
      // NOTE: Actual coverage is ~34%. Enforcement is intentionally deferred to Epic 3
      // (Story 3-4: Test Coverage and CI Quality Gates). The threshold documents the
      // target goal. CI should NOT run `bun run test:coverage` until Epic 3 raises
      // actual coverage to meet this threshold.
      thresholds: {
        statements: 80,
        branches: 80,
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
