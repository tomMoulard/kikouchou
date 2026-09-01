/**
 * @fileoverview Seeds records straight into the app's IndexedDB.
 *
 * Creating a trip through the form is a dozen interactions and cannot express
 * every field: the location autocomplete geocodes against Nominatim, which the
 * specs stub out, so a trip created through the UI never carries coordinates.
 * Writing the row directly is the only way to put a trip on the map.
 *
 * @module e2e/support/seed
 */

import { expect, type Page } from '@playwright/test';

// ============================================================================
// Types
// ============================================================================

/**
 * The fields a seeded trip is given. Everything else the row needs — its id,
 * share id and timestamps — is generated.
 */
export interface SeedTripOptions {
  /** Trip name, as shown on the card. */
  readonly name: string;
  /** Free-text location. */
  readonly location?: string;
  /** ISO `yyyy-MM-dd`. */
  readonly startDate: string;
  /** ISO `yyyy-MM-dd`. */
  readonly endDate: string;
  /** Pin the trip on the map; without it no map preview renders. */
  readonly coordinates?: { readonly lat: number; readonly lon: number };
}

/**
 * Identifiers of a seeded trip, for the assertions that need them.
 */
export interface SeededTrip {
  readonly tripId: string;
  readonly shareId: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Writes one trip into the `trips` store of the app's IndexedDB.
 *
 * Navigates to `/trips` first: the database is created by the app, so there is
 * nothing to open until a page has run.
 *
 * @param page - Playwright page object
 * @param options - The trip to write
 * @returns The new trip's id and share id
 *
 * @example
 * ```ts
 * const { tripId } = await seedTrip(page, {
 *   name: 'Paris',
 *   startDate: '2026-06-01',
 *   endDate: '2026-06-10',
 *   coordinates: { lat: 48.8566, lon: 2.3522 },
 * });
 * ```
 */
export async function seedTrip(
  page: Page,
  options: SeedTripOptions,
): Promise<SeededTrip> {
  await page.goto('/trips');
  await page.waitForLoadState('load');

  const seeded = await page.evaluate(
    async ({ name, location, startDate, endDate, coordinates }: SeedTripOptions) => {
      const id = `seed-trip-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const shareId = `share-${Math.random().toString(36).slice(2, 12)}`;
      const now = Date.now();

      return new Promise<{ tripId: string; shareId: string }>((resolve, reject) => {
        const dbRequest = indexedDB.open('kikoushou');
        dbRequest.onerror = () => reject(new Error('Failed to open database'));
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('trips', 'readwrite');

          tx.objectStore('trips').add({
            id,
            shareId,
            name,
            ...(location === undefined ? {} : { location }),
            startDate,
            endDate,
            ...(coordinates === undefined ? {} : { coordinates }),
            createdAt: now,
            updatedAt: now,
          });

          tx.oncomplete = () => {
            db.close();
            resolve({ tripId: id, shareId });
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Failed to create trip'));
          };
        };
      });
    },
    options,
  );

  expect(seeded.tripId).toBeTruthy();
  expect(seeded.shareId).toBeTruthy();

  return seeded;
}
