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
 * Dates come from `./fixture-dates`, never from a literal month. A seeded trip
 * whose dates have passed is rendered as a past trip — collapsed accordions,
 * greyed cards — and the assertions then hunt for rows that are real, rendered
 * and hidden.
 *
 * @example
 * ```ts
 * const { tripId } = await seedTrip(page, {
 *   name: 'Paris',
 *   startDate: fixtureDate(1),
 *   endDate: fixtureDate(10),
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
        const dbRequest = indexedDB.open('kikouchou');
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
 * The optional guest fields a seed can express beyond a name and a colour.
 *
 * Both are why they are here rather than in the caller: a spec that cannot say
 * `headcount` cannot tell "counts rows" apart from "counts people", and a spec
 * that cannot say `childSeat` cannot put a child in a car.
 */
export interface SeedPersonOptions {
  /** Real people this one guest row stands for. Omit for one. */
  readonly headcount?: number;
  /** The restraint this guest needs in a car, when they need one. */
  readonly childSeat?: 'rearFacing' | 'forwardFacing' | 'booster';
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
 * @param options - Headcount and child seat, when the spec needs them
 * @returns The new guest's id
 *
 * @example
 * ```ts
 * // A couple in one row: three of these do not fit a four-seat car.
 * const alice = await seedPerson(page, tripId, 'Alice', '#3b82f6', { headcount: 2 });
 * ```
 */
export async function seedPerson(
  page: Page,
  tripId: string,
  name: string,
  color = '#3b82f6',
  options: SeedPersonOptions = {},
): Promise<string> {
  return await page.evaluate(
    async ({ tripId, name, color, options }) => {
      const id = `seed-person-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

      return new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('kikouchou');
        request.onerror = () => reject(new Error('Failed to open database'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('persons', 'readwrite');
          tx.objectStore('persons').add({
            id,
            tripId,
            name,
            color,
            ...(options.headcount === undefined ? {} : { headcount: options.headcount }),
            ...(options.childSeat === undefined ? {} : { childSeat: options.childSeat }),
          });

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
    { tripId, name, color, options },
  );
}

/**
 * Tells this browser which guest is holding it, for one trip.
 *
 * Written through the share-link key in `localStorage`, which is the second of
 * the three sources `lib/identity/trip-identity` resolves — the one a device
 * can be given without a UI and without touching the settings singleton the app
 * writes itself. An explicit choice in Settings would outrank it; nothing in a
 * fresh profile makes one.
 *
 * The page must already be on the app's origin: `about:blank` has no storage.
 * Every trip-scoped seed above leaves it there.
 *
 * @param page - Playwright page object
 * @param identity - The trip, its share id, and the guest this device is
 *
 * @example
 * ```ts
 * await seedTripIdentity(page, { shareId, tripId, personId: alice });
 * ```
 */
export async function seedTripIdentity(
  page: Page,
  identity: {
    readonly shareId: string;
    readonly tripId: string;
    readonly personId: string;
  },
): Promise<void> {
  await page.evaluate((identity) => {
    localStorage.setItem(
      `kikouchou_guest_${identity.shareId}`,
      JSON.stringify({ personId: identity.personId, tripId: identity.tripId }),
    );
  }, identity);
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
      const request = indexedDB.open('kikouchou');
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
  /**
   * The car journey carrying this leg, from {@link seedRide}.
   *
   * Membership lives on the leg, so a shared ride is seeded by giving several
   * transports the same `rideId` — never by listing passengers on the ride.
   */
  readonly rideId?: string;
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
      const request = indexedDB.open('kikouchou');
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
          ...(options.rideId === undefined ? {} : { rideId: options.rideId }),
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

/**
 * A car to seed into the `vehicles` store.
 */
export interface SeedVehicleOptions {
  readonly tripId: string;
  readonly name: string;
  /** People it carries, driver included. Omit for "not measured". */
  readonly seatCount?: number;
  /** One entry per installed seat, so two boosters appear twice. */
  readonly childSeats?: readonly ('rearFacing' | 'forwardFacing' | 'booster')[];
  readonly ownerId?: string;
  readonly isRental?: boolean;
}

/**
 * Writes one vehicle into the `vehicles` store.
 *
 * Same ordering rule as {@link seedPerson}: seed before the trip is current, or
 * `YjsTripSync` races the raw write with its own projection.
 *
 * @param page - Playwright page object
 * @param options - The vehicle to write
 * @returns The new vehicle's id
 */
export async function seedVehicle(
  page: Page,
  options: SeedVehicleOptions,
): Promise<string> {
  return await page.evaluate(async (options: SeedVehicleOptions) => {
    const id = `seed-vehicle-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    return new Promise<string>((resolve, reject) => {
      const request = indexedDB.open('kikouchou');
      request.onerror = () => reject(new Error('Failed to open database'));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('vehicles', 'readwrite');
        tx.objectStore('vehicles').add({
          id,
          tripId: options.tripId,
          name: options.name,
          ...(options.seatCount === undefined ? {} : { seatCount: options.seatCount }),
          ...(options.childSeats === undefined
            ? {}
            : { childSeats: [...options.childSeats] }),
          ...(options.ownerId === undefined ? {} : { ownerId: options.ownerId }),
          ...(options.isRental === undefined ? {} : { isRental: options.isRental }),
        });

        tx.oncomplete = () => {
          db.close();
          resolve(id);
        };
        tx.onerror = () => {
          db.close();
          reject(new Error('Failed to create vehicle'));
        };
      };
    });
  }, options);
}

/**
 * A car journey to seed into the `rides` store.
 */
export interface SeedRideOptions {
  readonly tripId: string;
  /** ISO 8601 with a timezone, from `fixtureDatetime` — never a literal month. */
  readonly meetDatetime: string;
  readonly location: string;
  readonly direction?: 'pickup' | 'dropoff';
  /** Minutes before the meeting time the driver sets off. Omit for 30. */
  readonly leadTimeMinutes?: number;
  /** The guest driving. Omit to seed a ride nobody has volunteered for. */
  readonly driverId?: string;
  readonly vehicleId?: string;
}

/**
 * Writes one ride into the `rides` store.
 *
 * Passengers are **not** an argument, because they are not a field: attach legs
 * by passing this ride's id as `rideId` to {@link seedTransport}. Seeding a
 * shared car is therefore one `seedRide` and several `seedTransport` calls.
 *
 * Same ordering rule as {@link seedPerson}: seed before the trip is current.
 *
 * @param page - Playwright page object
 * @param options - The ride to write
 * @returns The new ride's id
 */
export async function seedRide(
  page: Page,
  options: SeedRideOptions,
): Promise<string> {
  return await page.evaluate(async (options: SeedRideOptions) => {
    const id = `seed-ride-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    return new Promise<string>((resolve, reject) => {
      const request = indexedDB.open('kikouchou');
      request.onerror = () => reject(new Error('Failed to open database'));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('rides', 'readwrite');
        tx.objectStore('rides').add({
          id,
          tripId: options.tripId,
          direction: options.direction ?? 'pickup',
          meetDatetime: options.meetDatetime,
          location: options.location,
          ...(options.leadTimeMinutes === undefined
            ? {}
            : { leadTimeMinutes: options.leadTimeMinutes }),
          ...(options.driverId === undefined ? {} : { driverId: options.driverId }),
          ...(options.vehicleId === undefined ? {} : { vehicleId: options.vehicleId }),
        });

        tx.oncomplete = () => {
          db.close();
          resolve(id);
        };
        tx.onerror = () => {
          db.close();
          reject(new Error('Failed to create ride'));
        };
      };
    });
  }, options);
}

/**
 * One member of a seeded guest group.
 */
export interface SeedGuestGroupMember {
  readonly name: string;
  /** Badge colour; the picker shows a swatch per member. */
  readonly color?: string;
  /** People this one entry stands for, for the "counts as 2" case. */
  readonly headcount?: number;
}

/**
 * The fields a seeded guest group is given.
 */
export interface SeedGuestGroupOptions {
  readonly name: string;
  readonly members: readonly SeedGuestGroupMember[];
}

/**
 * Writes one guest group into the `guestGroups` store.
 *
 * Unlike the trip-scoped seeds above, this one has no ordering rule to respect:
 * a guest group belongs to the account rather than to a trip, so no Yjs
 * document mirrors it and nothing can project over it.
 *
 * Prefer it whenever the group is *setup* rather than the thing under test —
 * most of all before visiting `/trips/new`. Building a group through its dialog
 * first leaves something behind that eats the next route's first click: the
 * button takes focus, React's handler never runs, and only a second click gets
 * through. Measured, not guessed, and it reproduces with the trip form's own
 * "Add guest" button, so it is not this feature's to fix.
 *
 * @param page - Playwright page object
 * @param options - The group to write
 * @returns The new group's id
 *
 * @example
 * ```ts
 * await seedGuestGroup(page, { name: 'Family', members: [{ name: 'Alice' }] });
 * ```
 */
export async function seedGuestGroup(
  page: Page,
  options: SeedGuestGroupOptions,
): Promise<string> {
  // The database is created by the app, so there is nothing to open until a
  // page has run — and `about:blank` refuses IndexedDB outright. `seedTrip`
  // navigates for the same reason; the trip-scoped seeds below it do not,
  // because a trip had to exist before them and that navigation already
  // happened.
  await page.goto('/trips');
  await page.waitForLoadState('load');

  return await page.evaluate(async (options: SeedGuestGroupOptions) => {
    const id = `seed-group-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const now = Date.now();

    return new Promise<string>((resolve, reject) => {
      const request = indexedDB.open('kikouchou');
      request.onerror = () => reject(new Error('Failed to open database'));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('guestGroups', 'readwrite');

        tx.objectStore('guestGroups').add({
          id,
          name: options.name,
          members: options.members.map((member, index) => ({
            id: `${id}-member-${index}`,
            name: member.name,
            color: member.color ?? '#3b82f6',
            ...(member.headcount === undefined ? {} : { headcount: member.headcount }),
          })),
          createdAt: now,
          updatedAt: now,
        });

        tx.oncomplete = () => {
          db.close();
          resolve(id);
        };
        tx.onerror = () => {
          db.close();
          reject(new Error('Failed to create guest group'));
        };
      };
    });
  }, options);
}
