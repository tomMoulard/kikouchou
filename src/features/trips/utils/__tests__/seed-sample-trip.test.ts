/**
 * Tests for seedSampleTripOnce and shouldOfferSampleTrip.
 *
 * @module features/trips/utils/__tests__/seed-sample-trip.test
 */
import { describe, expect, it } from 'vitest';

import {
  SAMPLE_TRIP_FORCE_STORAGE_KEY,
  seedSampleTripOnce,
  shouldOfferSampleTrip,
} from '../seed-sample-trip';

import { db } from '@/lib/db/database';
import { createTrip, ensureSettings, getSettings } from '@/lib/db';
import { toISODateStringFromString } from '@/lib/db/utils';

// ============================================================================
// Helpers
// ============================================================================

function storageWith(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: (key) => (key === SAMPLE_TRIP_FORCE_STORAGE_KEY ? value : null) };
}

// ============================================================================
// Tests
// ============================================================================

describe('seedSampleTripOnce', () => {
  it('writes the whole sample on a first open, in the given language', async () => {
    await expect(seedSampleTripOnce('fr')).resolves.toBe('seeded');

    const trips = await db.trips.toArray();
    const settings = await getSettings();

    expect(trips).toHaveLength(1);
    expect(trips[0]?.name).toMatch(/Voyage exemple/);
    expect(settings.sampleTripId).toBe(trips[0]?.id);
    expect(settings.sampleTripSeeded).toBe(true);
    expect(settings.language).toBe('fr');
    expect(settings.currentTripId).toBeUndefined();

    for (const table of [
      db.rooms,
      db.persons,
      db.roomAssignments,
      db.vehicles,
      db.rides,
      db.transports,
      db.activities,
      db.expenses,
    ]) {
      expect(await table.where('tripId').equals(trips[0]!.id).count(), table.name).toBeGreaterThan(0);
    }
    expect(await db.guestGroups.count()).toBe(0);
  });

  it('seeds only once, even after the sample is deleted', async () => {
    await seedSampleTripOnce('en');
    await db.trips.clear();

    await expect(seedSampleTripOnce('en')).resolves.toBe('already-decided');
    expect(await db.trips.count()).toBe(0);
  });

  it('seeds once when two tabs open at the same time', async () => {
    const outcomes = await Promise.all([seedSampleTripOnce('en'), seedSampleTripOnce('en')]);

    expect([...outcomes].sort()).toEqual(['already-decided', 'seeded']);
    expect(await db.trips.count()).toBe(1);
  });

  it('declines on a device that has run the app before, and remembers it', async () => {
    await ensureSettings();

    await expect(seedSampleTripOnce('en')).resolves.toBe('returning-device');
    expect(await db.trips.count()).toBe(0);
    expect((await getSettings()).sampleTripSeeded).toBe(true);
    expect((await getSettings()).sampleTripId).toBeUndefined();

    await expect(seedSampleTripOnce('en')).resolves.toBe('already-decided');
  });

  it('declines when trips exist without a settings row', async () => {
    await createTrip({
      name: 'Mine',
      startDate: toISODateStringFromString('2026-07-01'),
      endDate: toISODateStringFromString('2026-07-03'),
    });

    await expect(seedSampleTripOnce('en')).resolves.toBe('returning-device');
    expect(await db.trips.count()).toBe(1);
    expect((await getSettings()).language).toBe('en');
  });
});

describe('shouldOfferSampleTrip', () => {
  it('offers the sample to a person', () => {
    expect(shouldOfferSampleTrip({ webdriver: false }, storageWith(null))).toBe(true);
  });

  it('skips it under automation', () => {
    expect(shouldOfferSampleTrip({ webdriver: true }, storageWith(null))).toBe(false);
  });

  it('lets automation force it with the storage key', () => {
    expect(shouldOfferSampleTrip({ webdriver: true }, storageWith('on'))).toBe(true);
  });

  it('skips it under automation when storage throws', () => {
    const throwing: Pick<Storage, 'getItem'> = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };

    expect(shouldOfferSampleTrip({ webdriver: true }, throwing)).toBe(false);
  });
});
