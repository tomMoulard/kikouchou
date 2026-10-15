/**
 * @fileoverview Writes the sample trip on a device's very first open, once.
 *
 * "First open" is read from the settings row, not from the trip count. Every
 * boot creates that row (`ensureSettings` in `main.tsx`), so its absence means
 * this browser has never run the app; an organiser who deleted every trip still
 * has one, and must not get the sample back. The decision is recorded in the
 * same row and in the same transaction as the rows it writes, so two tabs
 * opening at once cannot seed twice, and neither can a reload that lands
 * between the trip and the flag.
 *
 * The sample is device-local by decision: `settings.sampleTripId` names it, the
 * account sweep and `ensureRemoteTrip` refuse to upload it, and the first-run
 * redirect does not count it as a trip of the user's own.
 *
 * @module features/trips/utils/seed-sample-trip
 */

import { buildSampleTrip } from '@/features/trips/utils/sample-trip';

import { db } from '@/lib/db/database';

import { DEFAULT_SETTINGS, type Language } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * What the seed did.
 *
 * - `seeded` - first open: the sample was written
 * - `already-decided` - an earlier boot already seeded or declined
 * - `returning-device` - the app has run here before; declined, and recorded
 */
export type SeedSampleTripOutcome = 'seeded' | 'already-decided' | 'returning-device';

// ============================================================================
// Constants
// ============================================================================

/**
 * `on` forces the seed under automation, which otherwise skips it. The e2e
 * spec of the sample sets it; every other spec gets the empty app it expects.
 */
export const SAMPLE_TRIP_FORCE_STORAGE_KEY = 'kikouchou-sample-trip';

const SETTINGS_ID = 'settings' as const;

// ============================================================================
// Functions
// ============================================================================

/**
 * Whether this boot should offer the sample trip at all.
 *
 * Under automation (`navigator.webdriver`, which Playwright sets) it is off:
 * each test starts in a fresh browser, so every spec would otherwise open on a
 * sample trip it did not seed, and that includes the live run against the
 * deployed app. The force key turns it back on for the one spec about it.
 *
 * @param nav - The navigator to read; a parameter so a test can pass its own
 * @param storage - Where the force key lives
 * @returns True when the seed should run
 */
export function shouldOfferSampleTrip(
  nav: Pick<Navigator, 'webdriver'> | undefined = globalThis.navigator,
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): boolean {
  if (nav?.webdriver !== true) {
    return true;
  }
  try {
    return storage?.getItem(SAMPLE_TRIP_FORCE_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/**
 * Writes the sample trip if, and only if, this is the device's first open.
 *
 * Must run before `ensureSettings()`, which creates the row this reads.
 *
 * @param language - The language the sample is written in
 * @param today - The day the sample's dates are counted from
 * @returns What it did
 */
export async function seedSampleTripOnce(
  language: Language,
  today: Date = new Date(),
): Promise<SeedSampleTripOutcome> {
  const rows = buildSampleTrip(language, today);

  return db.transaction(
    'rw',
    [
      db.settings,
      db.trips,
      db.rooms,
      db.persons,
      db.roomAssignments,
      db.vehicles,
      db.rides,
      db.transports,
      db.activities,
      db.expenses,
    ],
    async (): Promise<SeedSampleTripOutcome> => {
      const settings = await db.settings.get(SETTINGS_ID);

      if (settings?.sampleTripSeeded === true) {
        return 'already-decided';
      }

      if (settings !== undefined || (await db.trips.count()) > 0) {
        await db.settings.put({
          ...(settings ?? { ...DEFAULT_SETTINGS, language }),
          sampleTripSeeded: true,
        });
        return 'returning-device';
      }

      await db.trips.add(rows.trip);
      await db.rooms.bulkAdd([...rows.rooms]);
      await db.persons.bulkAdd([...rows.persons]);
      await db.roomAssignments.bulkAdd([...rows.roomAssignments]);
      await db.vehicles.bulkAdd([...rows.vehicles]);
      await db.rides.bulkAdd([...rows.rides]);
      await db.transports.bulkAdd([...rows.transports]);
      await db.activities.bulkAdd([...rows.activities]);
      await db.expenses.bulkAdd([...rows.expenses]);
      await db.settings.add({
        ...DEFAULT_SETTINGS,
        language,
        sampleTripSeeded: true,
        sampleTripId: rows.trip.id,
      });
      return 'seeded';
    },
  );
}
