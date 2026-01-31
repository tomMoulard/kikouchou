/**
 * Integration tests for Settings Repository
 *
 * Tests singleton settings operations, lazy initialization,
 * and persistence for the settings-repository module.
 *
 * @module lib/db/repositories/__tests__/settings-repository.test
 */
import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db/database';
import {
  getSettings,
  ensureSettings,
  updateSettings,
  setCurrentTrip,
  setLanguage,
  getCurrentTripId,
  getLanguage,
  resetSettings,
} from '@/lib/db/repositories/settings-repository';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import type { TripId } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates a test trip and returns its ID.
 */
async function createTestTrip(name = 'Test Trip'): Promise<TripId> {
  const trip = await createTrip({
    name,
    startDate: '2024-07-15',
    endDate: '2024-07-22',
  });
  return trip.id;
}

// ============================================================================
// Test Setup
// ============================================================================

// Note: Database clearing and mock restoration are handled by global setup.ts
// - beforeEach clears all 6 tables (trips, rooms, persons, roomAssignments, transports, settings)
// - afterEach calls cleanup() and vi.clearAllMocks()

// ============================================================================
// getSettings Tests
// ============================================================================

describe('getSettings', () => {
  it('returns default settings when no settings exist', async () => {
    const settings = await getSettings();

    expect(settings.id).toBe('settings');
    expect(settings.language).toBe('fr');
    expect(settings.currentTripId).toBeUndefined();
  });

  it('returns existing settings from database', async () => {
    // Manually add settings to database
    await db.settings.add({
      id: 'settings',
      language: 'en',
      currentTripId: 'some-trip-id' as TripId,
    });

    const settings = await getSettings();

    expect(settings.language).toBe('en');
    expect(settings.currentTripId).toBe('some-trip-id');
  });

  it('does not create settings in database', async () => {
    await getSettings();

    const stored = await db.settings.get('settings');
    expect(stored).toBeUndefined();
  });

  it('returns same default settings on multiple calls', async () => {
    const settings1 = await getSettings();
    const settings2 = await getSettings();

    expect(settings1).toEqual(settings2);
    expect(settings1).toEqual(DEFAULT_SETTINGS);
  });
});

// ============================================================================
// ensureSettings Tests
// ============================================================================

describe('ensureSettings', () => {
  it('creates default settings if not exist', async () => {
    const settings = await ensureSettings();

    expect(settings.id).toBe('settings');
    expect(settings.language).toBe('fr');
    expect(settings.currentTripId).toBeUndefined();

    // Verify persisted to database
    const stored = await db.settings.get('settings');
    expect(stored).toEqual(settings);
  });

  it('returns existing settings without modifying', async () => {
    // Add settings first
    const existing = {
      id: 'settings' as const,
      language: 'en' as const,
      currentTripId: 'some-trip' as TripId,
    };
    await db.settings.add(existing);

    const settings = await ensureSettings();

    expect(settings).toEqual(existing);
  });

  it('is idempotent - multiple calls return same settings', async () => {
    const settings1 = await ensureSettings();
    const settings2 = await ensureSettings();

    expect(settings1).toEqual(settings2);
  });
});

// ============================================================================
// updateSettings Tests
// ============================================================================

describe('updateSettings', () => {
  it('updates single field when settings exist', async () => {
    await ensureSettings();

    await updateSettings({ language: 'en' });

    const settings = await getSettings();
    expect(settings.language).toBe('en');
  });

  it('creates settings with defaults and update when not exist', async () => {
    await updateSettings({ language: 'en' });

    const settings = await getSettings();
    expect(settings.id).toBe('settings');
    expect(settings.language).toBe('en');
    // currentTripId should be from defaults (undefined)
    expect(settings.currentTripId).toBeUndefined();
  });

  it('updates multiple fields', async () => {
    const tripId = await createTestTrip();
    await ensureSettings();

    await updateSettings({
      language: 'en',
      currentTripId: tripId,
    });

    const settings = await getSettings();
    expect(settings.language).toBe('en');
    expect(settings.currentTripId).toBe(tripId);
  });

  it('preserves unchanged fields', async () => {
    const tripId = await createTestTrip();
    await db.settings.add({
      id: 'settings',
      language: 'en',
      currentTripId: tripId,
    });

    await updateSettings({ language: 'fr' });

    const settings = await getSettings();
    expect(settings.language).toBe('fr');
    expect(settings.currentTripId).toBe(tripId); // Preserved
  });

  it('can set currentTripId to undefined', async () => {
    const tripId = await createTestTrip();
    await db.settings.add({
      id: 'settings',
      language: 'en',
      currentTripId: tripId,
    });

    await updateSettings({ currentTripId: undefined });

    const settings = await getSettings();
    expect(settings.currentTripId).toBeUndefined();
  });
});

// ============================================================================
// setCurrentTrip Tests
// ============================================================================

describe('setCurrentTrip', () => {
  it('sets current trip ID', async () => {
    const tripId = await createTestTrip();

    await setCurrentTrip(tripId);

    const settings = await getSettings();
    expect(settings.currentTripId).toBe(tripId);
  });

  it('clears current trip when undefined', async () => {
    const tripId = await createTestTrip();
    await setCurrentTrip(tripId);

    await setCurrentTrip(undefined);

    const settings = await getSettings();
    expect(settings.currentTripId).toBeUndefined();
  });

  it('updates existing trip ID', async () => {
    const trip1 = await createTestTrip('Trip 1');
    const trip2 = await createTestTrip('Trip 2');
    await setCurrentTrip(trip1);

    await setCurrentTrip(trip2);

    const settings = await getSettings();
    expect(settings.currentTripId).toBe(trip2);
  });

  it('creates settings if they do not exist', async () => {
    const tripId = await createTestTrip();

    await setCurrentTrip(tripId);

    const stored = await db.settings.get('settings');
    expect(stored).toBeDefined();
    expect(stored?.currentTripId).toBe(tripId);
  });
});

// ============================================================================
// setLanguage Tests
// ============================================================================

describe('setLanguage', () => {
  it('sets language to English', async () => {
    await setLanguage('en');

    const settings = await getSettings();
    expect(settings.language).toBe('en');
  });

  it('sets language to French', async () => {
    await ensureSettings();
    // Default is 'fr', set to 'en' first
    await setLanguage('en');

    await setLanguage('fr');

    const settings = await getSettings();
    expect(settings.language).toBe('fr');
  });

  it('persists language across getSettings calls', async () => {
    await setLanguage('en');

    const settings1 = await getSettings();
    const settings2 = await getSettings();

    expect(settings1.language).toBe('en');
    expect(settings2.language).toBe('en');
  });

  it('creates settings if they do not exist', async () => {
    await setLanguage('en');

    const stored = await db.settings.get('settings');
    expect(stored).toBeDefined();
    expect(stored?.language).toBe('en');
  });

  it('preserves other settings when changing language', async () => {
    const tripId = await createTestTrip();
    await db.settings.add({
      id: 'settings',
      language: 'fr',
      currentTripId: tripId,
    });

    await setLanguage('en');

    const settings = await getSettings();
    expect(settings.language).toBe('en');
    expect(settings.currentTripId).toBe(tripId); // Preserved
  });
});

// ============================================================================
// getCurrentTripId Tests
// ============================================================================

describe('getCurrentTripId', () => {
  it('returns undefined when no trip set', async () => {
    const tripId = await getCurrentTripId();

    expect(tripId).toBeUndefined();
  });

  it('returns current trip ID when set', async () => {
    const tripId = await createTestTrip();
    await setCurrentTrip(tripId);

    const currentTripId = await getCurrentTripId();

    expect(currentTripId).toBe(tripId);
  });

  it('returns undefined when settings exist but trip not set', async () => {
    await ensureSettings();

    const tripId = await getCurrentTripId();

    expect(tripId).toBeUndefined();
  });
});

// ============================================================================
// getLanguage Tests
// ============================================================================

describe('getLanguage', () => {
  it('returns default language when settings not exist', async () => {
    const language = await getLanguage();

    expect(language).toBe('fr');
  });

  it('returns current language when set', async () => {
    await setLanguage('en');

    const language = await getLanguage();

    expect(language).toBe('en');
  });

  it('returns persisted language', async () => {
    await db.settings.add({
      id: 'settings',
      language: 'en',
      currentTripId: undefined,
    });

    const language = await getLanguage();

    expect(language).toBe('en');
  });
});

// ============================================================================
// resetSettings Tests
// ============================================================================

describe('resetSettings', () => {
  it('resets settings to defaults', async () => {
    const tripId = await createTestTrip();
    await db.settings.add({
      id: 'settings',
      language: 'en',
      currentTripId: tripId,
    });

    await resetSettings();

    const settings = await getSettings();
    expect(settings.language).toBe('fr');
    expect(settings.currentTripId).toBeUndefined();
  });

  it('creates default settings if none exist', async () => {
    await resetSettings();

    const stored = await db.settings.get('settings');
    expect(stored).toEqual(DEFAULT_SETTINGS);
  });

  it('is idempotent', async () => {
    await resetSettings();
    await resetSettings();

    const settings = await getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('persists reset settings to database', async () => {
    await setLanguage('en');
    await resetSettings();

    // Verify stored in database (not just returned from memory)
    const stored = await db.settings.get('settings');
    expect(stored?.language).toBe('fr');
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Settings Integration', () => {
  it('full workflow: create, update, reset', async () => {
    // Step 1: Initial state - no settings
    const initial = await getSettings();
    expect(initial).toEqual(DEFAULT_SETTINGS);

    // Step 2: Ensure settings exist
    await ensureSettings();
    const stored = await db.settings.get('settings');
    expect(stored).toBeDefined();

    // Step 3: Update language
    await setLanguage('en');
    expect(await getLanguage()).toBe('en');

    // Step 4: Set current trip
    const tripId = await createTestTrip();
    await setCurrentTrip(tripId);
    expect(await getCurrentTripId()).toBe(tripId);

    // Step 5: Reset
    await resetSettings();
    expect(await getLanguage()).toBe('fr');
    expect(await getCurrentTripId()).toBeUndefined();
  });

  it('settings persist across multiple function calls', async () => {
    const tripId = await createTestTrip();

    await setLanguage('en');
    await setCurrentTrip(tripId);

    // Multiple reads should return consistent data
    const read1 = await getSettings();
    const read2 = await getSettings();
    const lang = await getLanguage();
    const trip = await getCurrentTripId();

    expect(read1.language).toBe('en');
    expect(read2.language).toBe('en');
    expect(lang).toBe('en');
    expect(trip).toBe(tripId);
  });

  it('updating via different functions is consistent', async () => {
    const tripId = await createTestTrip();

    // Update via updateSettings
    await updateSettings({ language: 'en' });

    // Update via setCurrentTrip
    await setCurrentTrip(tripId);

    // Verify both updates applied
    const settings = await getSettings();
    expect(settings.language).toBe('en');
    expect(settings.currentTripId).toBe(tripId);
  });
});
