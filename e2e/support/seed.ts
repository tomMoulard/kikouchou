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

/**
 * Writes one guest into the `persons` store.
 *
 * Seed a trip's rows **before** anything makes that trip current.
 * `YjsTripSync` mounts a document per trip and projects it back over Dexie
 * through `syncDocToDexie`, so a row written raw once that document is already
 * loaded races the mirror: the document does not contain the row, and the next
 * projection can drop it. That is what made the map's ARIA test flaky in CI —
 * it created its trip through the form, which selects it, and only then wrote
 * the rows. It passed locally every time and failed on the slower runner.
 *
 * @param page - Playwright page object
 * @param tripId - The trip the guest belongs to
 * @param name - Guest name
 * @param color - Badge colour
 * @returns The new guest's id
 */
export async function seedPerson(
  page: Page,
  tripId: string,
  name: string,
  color = '#3b82f6',
): Promise<string> {
  return await page.evaluate(
    async ({ tripId, name, color }) => {
      const id = `seed-person-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      return new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('kikoushou');
        request.onerror = () => reject(new Error('Failed to open database'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('persons', 'readwrite');
          tx.objectStore('persons').add({ id, tripId, name, color });

          tx.oncomplete = () => {
            db.close();
            resolve(id);
          };
          tx.onerror = () => {
            db.close();
            reject(new Error('Failed to create person'));
          };
        };
      });
    },
    { tripId, name, color },
  );
}

/**
 * The fields a seeded room is given.
 */
export interface SeedRoomOptions {
  readonly tripId: string;
  readonly name: string;
  /** Beds in the room. Must be at least 1 for the capacity badge to make sense. */
  readonly capacity?: number;
  readonly description?: string;
  /** Sort position within the trip; part of the `[tripId+order]` index. */
  readonly order?: number;
}

/**
 * Writes one room into the `rooms` store.
 *
 * Same ordering rule as {@link seedPerson}: seed before the trip is current.
 *
 * @param page - Playwright page object
 * @param options - The room to write
 * @returns The new room's id
 */
export async function seedRoom(
  page: Page,
  options: SeedRoomOptions,
): Promise<string> {
  return await page.evaluate(async (options: SeedRoomOptions) => {
    const id = `seed-room-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    return new Promise<string>((resolve, reject) => {
      const request = indexedDB.open('kikoushou');
      request.onerror = () => reject(new Error('Failed to open database'));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('rooms', 'readwrite');
        tx.objectStore('rooms').add({
          id,
          tripId: options.tripId,
          name: options.name,
          capacity: options.capacity ?? 2,
          ...(options.description === undefined ? {} : { description: options.description }),
          order: options.order ?? 0,
        });

        tx.oncomplete = () => {
          db.close();
          resolve(id);
        };
        tx.onerror = () => {
          db.close();
          reject(new Error('Failed to create room'));
        };
      };
    });
  }, options);
}

/**
 * The fields a seeded transport is given.
 */
export interface SeedTransportOptions {
  readonly tripId: string;
  readonly personId: string;
  readonly type: 'arrival' | 'departure';
  /** ISO 8601 with a timezone. */
  readonly datetime: string;
  readonly mode?: 'plane' | 'train' | 'car' | 'bus' | 'other';
  /** Required on `Transport`; the transports page crashes without one. */
  readonly location?: string;
  /** Pin it on the map; `TransportMapPage` shows an empty state without this. */
  readonly coordinates?: { readonly lat: number; readonly lon: number };
}

/**
 * Writes one transport into the `transports` store.
 *
 * Same ordering rule as {@link seedPerson}: seed before the trip is current.
 *
 * @param page - Playwright page object
 * @param options - The transport to write
 * @returns The new transport's id
 */
export async function seedTransport(
  page: Page,
  options: SeedTransportOptions,
): Promise<string> {
  return await page.evaluate(async (options: SeedTransportOptions) => {
    const id = `seed-transport-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    return new Promise<string>((resolve, reject) => {
      const request = indexedDB.open('kikoushou');
      request.onerror = () => reject(new Error('Failed to open database'));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('transports', 'readwrite');
        tx.objectStore('transports').add({
          id,
          tripId: options.tripId,
          personId: options.personId,
          type: options.type,
          datetime: options.datetime,
          mode: options.mode ?? 'plane',
          location: options.location ?? 'Test Station',
          ...(options.coordinates === undefined ? {} : { coordinates: options.coordinates }),
          needsPickup: options.type === 'arrival',
        });

        tx.oncomplete = () => {
          db.close();
          resolve(id);
        };
        tx.onerror = () => {
          db.close();
          reject(new Error('Failed to create transport'));
        };
      };
    });
  }, options);
}
