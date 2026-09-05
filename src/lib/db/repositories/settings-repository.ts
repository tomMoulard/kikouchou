/**
 * Settings Repository
 *
 * Provides operations for the singleton AppSettings record.
 * Creates default settings if they don't exist.
 *
 * @module lib/db/repositories/settings-repository
 */

import { db } from '@/lib/db/database';
import type { AppSettings, Language, TripId } from '@/types';
import { DEFAULT_SETTINGS } from '@/types';

/**
 * Settings singleton ID - always 'settings'.
 */
const SETTINGS_ID = 'settings' as const;

/**
 * Retrieves the application settings (read-only).
 *
 * Returns default settings if none exist in the database.
 * Does NOT create settings in the database - use ensureSettings() for that.
 *
 * This function is safe to use inside Dexie liveQuery contexts because
 * it only performs read operations.
 *
 * @returns The application settings (from DB or defaults)
 *
 * @example
 * ```typescript
 * const settings = await getSettings();
 * console.log(settings.language); // 'fr' (default)
 * ```
 */
export async function getSettings(): Promise<AppSettings> {
  const settings = await db.settings.get(SETTINGS_ID);
  // Return existing settings or defaults (no write operation)
  return settings ?? DEFAULT_SETTINGS;
}

/**
 * Ensures settings exist in the database by creating defaults if needed.
 *
 * Call this during app initialization to ensure settings are persisted.
 * This is a write operation and should NOT be used inside liveQuery contexts.
 *
 * @returns The application settings (newly created or existing)
 *
 * @example
 * ```typescript
 * // In app initialization
 * await ensureSettings();
 * ```
 */
export async function ensureSettings(): Promise<AppSettings> {
  const settings = await db.settings.get(SETTINGS_ID);

  if (settings) {
    return settings;
  }

  // Create default settings if not found
  await db.settings.add(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

/**
 * Updates application settings with partial data.
 *
 * Creates default settings first if they don't exist.
 *
 * @param data - Partial settings data to update (excluding id)
 *
 * @example
 * ```typescript
 * await updateSettings({ language: 'en' });
 * ```
 */
export async function updateSettings(
  data: Partial<Omit<AppSettings, 'id'>>,
): Promise<void> {
  // Ensure settings exist before updating
  const existing = await db.settings.get(SETTINGS_ID);

  if (existing) {
    await db.settings.update(SETTINGS_ID, data);
  } else {
    // Create with defaults merged with provided data
    await db.settings.add({
      ...DEFAULT_SETTINGS,
      ...data,
    });
  }
}

/**
 * Sets the current trip ID for session restoration.
 *
 * @param tripId - The trip ID to set as current, or undefined to clear
 *
 * @example
 * ```typescript
 * // Set current trip
 * await setCurrentTrip(tripId);
 *
 * // Clear current trip
 * await setCurrentTrip(undefined);
 * ```
 */
export async function setCurrentTrip(tripId: TripId | undefined): Promise<void> {
  await updateSettings({ currentTripId: tripId });
}

/**
 * Sets the application language.
 *
 * @param language - The language code ('en' or 'fr')
 *
 * @example
 * ```typescript
 * await setLanguage('en');
 * ```
 */
export async function setLanguage(language: Language): Promise<void> {
  await updateSettings({ language });
}

/**
 * Gets the current trip ID from settings.
 *
 * @returns The current trip ID, or undefined if not set
 *
 * @example
 * ```typescript
 * const currentTripId = await getCurrentTripId();
 * if (currentTripId) {
 *   // Load the trip
 * }
 * ```
 */
export async function getCurrentTripId(): Promise<TripId | undefined> {
  const settings = await getSettings();
  return settings.currentTripId;
}

/**
 * Gets the current language from settings.
 *
 * @returns The current language code
 *
 * @example
 * ```typescript
 * const language = await getLanguage();
 * // 'fr' or 'en'
 * ```
 */
export async function getLanguage(): Promise<Language> {
  const settings = await getSettings();
  return settings.language;
}

/**
 * Resets settings to default values.
 *
 * Useful for testing or when user wants to clear preferences.
 *
 * @example
 * ```typescript
 * await resetSettings();
 * ```
 */
export async function resetSettings(): Promise<void> {
  await db.settings.put(DEFAULT_SETTINGS);
}
