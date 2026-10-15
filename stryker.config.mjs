/**
 * @fileoverview Stryker configuration: mutation testing for the Vitest suite.
 *
 * Coverage says a line ran under a test. Mutation testing says whether a test
 * would notice if that line were wrong: Stryker changes the source one small
 * edit at a time (a `<` to `<=`, a `true` to `false`, a removed call) and runs
 * the tests that cover it. A mutant no test fails on ("survived") is code the
 * suite executes without checking.
 *
 * Local only, and report only. Nothing in CI runs this, and `thresholds.break`
 * is null, so a low score never fails a command. Set a break threshold after
 * the first full run gives a real number, the way the coverage gate was set.
 *
 * @module stryker.config
 */

// ============================================================================
// Configuration
// ============================================================================

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },

  /**
   * The same files `vitest.config.ts` measures for coverage, so the two
   * reports talk about one set of code. Generated code is left out as well:
   * a surviving mutant in `src/gen` is a fact about buf, not about this repo.
   */
  mutate: [
    'src/**/*.{ts,tsx}',
    '!src/**/__tests__/**',
    '!src/**/*.{test,spec}.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/test/**',
    '!src/components/ui/**',
    '!src/main.tsx',
    '!src/gen/**',
    '!src/lib/supabase/database.types.ts',
  ],

  /**
   * `perTest` records which tests reach each mutant during the first run, and
   * then runs only those tests against it. Without it every mutant pays for the
   * whole suite, and with 400-odd test files that is the difference between
   * hours and days.
   */
  coverageAnalysis: 'perTest',

  /**
   * A static mutant sits in code that runs only while a module loads: a
   * module-level constant such as `ACTION_SCHEMAS`. Stryker cannot tell which
   * tests reach it, so each one costs a fresh process and the whole suite,
   * about a minute apiece. They are skipped and reported as `Ignored`.
   * Pass `--ignoreStatic false` to test them on purpose, on a narrow `--mutate`.
   */
  ignoreStatic: true,

  /**
   * Keep the results of the last run and test only the mutants whose code or
   * tests changed since. The first full run is slow; the next one is not.
   * Pass `--force` to ignore the file and test everything again.
   */
  incremental: true,
  incrementalFile: 'reports/mutation/stryker-incremental.json',

  reporters: ['html', 'json', 'clear-text', 'progress'],
  /**
   * The terminal gets the score table and the surviving mutants. The test
   * tree would print all 400-odd test files after every run, and files at a
   * full score add a row each to a table that is about the other ones.
   */
  clearTextReporter: { reportTests: false, skipFull: true },
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },

  /** Report only. Colours the report, never fails the run. */
  thresholds: { high: 80, low: 60, break: null },

  /**
   * The first run executes the whole suite once to record coverage. That takes
   * about a minute on an idle machine and much longer on a loaded one, which
   * `vitest.config.ts` measured at 750s; the default five minutes is too short
   * for the second case.
   */
  dryRunTimeoutMinutes: 20,

  tempDirName: '.stryker-tmp',
};
