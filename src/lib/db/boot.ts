/**
 * @fileoverview The database half of the boot sequence.
 *
 * Before the app renders, `main.tsx` seeds the sample trip on a first open and
 * makes sure the settings row exists (liveQuery reads must not write). Both
 * open IndexedDB, and this module says how that went, so that `main.tsx` can
 * choose what to render.
 *
 * A full disk is the one failure the user has to fix, and the app cannot start
 * without the fix. It comes back as `storage-full`: logged once as a warning
 * and reported as `database_open_failed` with a reason, the way
 * `lib/native/live-update` reports its own failures. Not `console.error`,
 * which PostHog records as an unhandled exception (`capture_console_errors`).
 * The boot used to log it twice that way, once from the seed and once from the
 * settings row, then render an app whose every page said "Failed to load"
 * (PostHog, 2026-10-26, Android Chrome 138).
 *
 * @module lib/db/boot
 */

import { captureEvent } from '@/lib/posthog';

import { retryAfterReopen } from './reopen';
import { isStorageFullError } from './storage-full';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * How the database came up.
 *
 * - `ready`: the settings row exists.
 * - `storage-full`: the device has no space left for IndexedDB to open in, or
 *   to write the settings row of a first open. Render the storage-full screen,
 *   not the app.
 * - `failed`: anything else. Already logged; the app renders on defaults.
 * - `timed-out`: still blocked after the timeout, usually behind another tab
 *   on an older schema. The app renders on defaults.
 */
export type DatabaseBootOutcome = 'ready' | 'storage-full' | 'failed' | 'timed-out';

/** What the boot sequence runs, so a test can run it without `main.tsx`. */
export interface DatabaseBootSteps {
  /** Seeds the sample trip; absent when this device is not offered one. */
  readonly seed?: () => Promise<void>;
  /** Creates the settings row when it is missing. */
  readonly ensureSettings: () => Promise<unknown>;
  /** How long to wait before rendering anyway. */
  readonly timeoutMs: number;
}

// ============================================================================
// Boot
// ============================================================================

/**
 * Seeds the sample trip, then ensures the settings row, against a timeout.
 *
 * Raced against the timeout on purpose: `db.open()` can block indefinitely
 * behind another tab holding an older schema version, and a promise that never
 * settles would leave the user on a blank page. Rendering slightly early is
 * safe, because `getSettings()` falls back to defaults.
 *
 * The sample trip goes first: it tells a first open from a returning one by
 * the settings row that `ensureSettings` is about to create. A failed seed
 * costs the sample and nothing else. That holds for a full disk too, since the
 * sample's photos can run past a quota the settings row fits in; the settings
 * call decides whether the app can start.
 *
 * @param steps - The seed, the settings call and the timeout
 * @returns How the database came up; never rejects
 */
export async function prepareDatabase(steps: DatabaseBootSteps): Promise<DatabaseBootOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const work = (async (): Promise<DatabaseBootOutcome> => {
    let seedStorageFull: unknown;
    if (steps.seed) {
      try {
        await steps.seed();
      } catch (error) {
        if (isStorageFullError(error)) {
          // Said once, below, whichever way the settings call goes.
          seedStorageFull = error;
        } else {
          console.error('Failed to seed the sample trip:', error);
        }
      }
    }
    // iOS Safari can hand the page a dead IndexedDB connection; one reopen
    // cures it (PostHog issue 01a13061).
    await retryAfterReopen(steps.ensureSettings);
    if (seedStorageFull !== undefined) {
      console.warn('[db] No space left for the sample trip, skipped:', seedStorageFull);
    }
    return 'ready';
  })();

  const timeout = new Promise<DatabaseBootOutcome>((resolve) => {
    timer = setTimeout(() => {
      resolve('timed-out');
    }, steps.timeoutMs);
  });

  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    if (isStorageFullError(error)) {
      console.warn('[db] Device storage is full, the database cannot start:', error);
      captureEvent('database_open_failed', { reason: 'storage_full' });
      return 'storage-full';
    }
    // Logged, and the app renders anyway: getSettings() returns defaults when
    // the database is unavailable.
    console.error('Database initialization failed:', error);
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}
